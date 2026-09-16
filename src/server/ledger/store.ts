import { Effect } from "effect";
import { SqlClient } from "effect/unstable/sql";

import { hashKey } from "#/server/ledger/clients";
import type { Credential } from "#/server/management/credential";
import type { UsageRecord } from "#/server/management/schema";

// Persistence for the ledger. Every function is a plain Effect over SqlClient
// so the collector and the ledger UI share one owner of the table shapes.

const RAW_RETENTION_DAYS = 90;
const CHUNK = 200;

const iso = (value: string): string => {
	const parsed = Date.parse(value);
	return Number.isFinite(parsed) ? new Date(parsed).toISOString() : value;
};

export type RequestRow = {
	readonly request_id: string;
	readonly timestamp: string;
	readonly client_hash: string;
	readonly provider: string;
	readonly model: string;
	readonly auth_index: string | null;
	readonly source: string | null;
	readonly stream: number;
	readonly failed: number;
	readonly latency_ms: number | null;
	readonly ttft_ms: number | null;
	readonly tokens_input: number;
	readonly tokens_cached: number;
	readonly tokens_output: number;
	readonly tokens_reasoning: number;
	readonly reasoning_effort: string | null;
	readonly service_tier: string | null;
	readonly user_agent: string | null;
	readonly raw: string;
	readonly received_at: string;
};

/** Shapes a popped record for storage. The raw key is hashed and never kept. */
export const toRow = (record: UsageRecord, receivedAt: string): RequestRow | null => {
	if (!record.request_id) return null;
	const { api_key: _key, ...rest } = record;
	const breakdown = record.token_breakdown;
	return {
		request_id: record.request_id,
		timestamp: iso(record.timestamp),
		client_hash: hashKey(record.api_key ?? ""),
		provider: record.provider,
		model: record.model,
		auth_index: record.auth_index ?? null,
		source: record.source ?? null,
		stream: record.stream ? 1 : 0,
		failed: record.failed ? 1 : 0,
		latency_ms: record.latency_ms ?? null,
		ttft_ms: record.ttft_ms ?? null,
		tokens_input: breakdown?.input?.uncached_tokens ?? 0,
		tokens_cached: breakdown?.input?.cache_read_tokens ?? 0,
		tokens_output: breakdown?.output?.total_tokens ?? 0,
		tokens_reasoning: breakdown?.output?.reasoning_tokens ?? 0,
		reasoning_effort: record.reasoning_effort ?? null,
		service_tier: record.service_tier ?? null,
		user_agent: record.user_agent ?? null,
		raw: JSON.stringify(rest),
		received_at: receivedAt,
	};
};

/** Inserts a popped batch in one transaction; re-pops of the same ids are no-ops. Returns rows written. */
export const insertRequests = (
	rows: ReadonlyArray<RequestRow>,
	registry: ReadonlyMap<string, string>,
) =>
	Effect.gen(function* () {
		const sql = yield* SqlClient.SqlClient;
		if (rows.length === 0) return 0;
		let written = 0;
		yield* sql.withTransaction(
			Effect.gen(function* () {
				for (let index = 0; index < rows.length; index += CHUNK) {
					const chunk = rows.slice(index, index + CHUNK);
					yield* sql`INSERT OR IGNORE INTO requests ${sql.insert(chunk)}`;
					const [count] = yield* sql<{ n: number }>`SELECT changes() AS n`;
					written += count?.n ?? 0;
				}
				const seen = new Map<string, string>();
				for (const row of rows) {
					const last = seen.get(row.client_hash);
					if (!last || row.timestamp > last) seen.set(row.client_hash, row.timestamp);
				}
				for (const [hash, lastSeen] of seen) {
					const label = registry.get(hash) ?? null;
					yield* sql`INSERT INTO client_keys ${sql.insert({ hash, label, first_seen: lastSeen, last_seen: lastSeen })}
						ON CONFLICT (hash) DO UPDATE SET
							last_seen = max(last_seen, excluded.last_seen),
							label = coalesce(excluded.label, client_keys.label)`;
				}
			}),
		);
		return written;
	});

export const upsertCredentials = (credentials: ReadonlyArray<Credential>, seenAt: string) =>
	Effect.gen(function* () {
		const sql = yield* SqlClient.SqlClient;
		for (const credential of credentials) {
			yield* sql`INSERT INTO credentials ${sql.insert({
				name: credential.name,
				provider: credential.provider,
				label: credential.label,
				first_seen: seenAt,
				last_seen: seenAt,
			})} ON CONFLICT (name) DO UPDATE SET
				provider = excluded.provider, label = excluded.label, last_seen = excluded.last_seen`;
		}
	});

/** Records a credential's quota when it differs from the last recorded one. Returns true when a row was written. */
export const recordQuotaSnapshot = (credential: Credential, recordedAt: string) =>
	Effect.gen(function* () {
		const sql = yield* SqlClient.SqlClient;
		const quota = JSON.stringify({
			windows: credential.quota.windows,
			credits: credential.quota.credits,
			plan: credential.quota.plan,
			overage: credential.quota.overage,
		});
		const [last] = yield* sql<{ quota: string }>`SELECT quota FROM quota_snapshots
			WHERE credential = ${credential.name} ORDER BY id DESC LIMIT 1`;
		if (last?.quota === quota) return false;
		yield* sql`INSERT INTO quota_snapshots ${sql.insert({
			credential: credential.name,
			observed_at: credential.quota.observedAt ? iso(credential.quota.observedAt) : recordedAt,
			recorded_at: recordedAt,
			quota,
		})}`;
		return true;
	});

/** Recomputes hourly rollups for every hour touched since `since` (idempotent). */
export const rollupSince = (since: string) =>
	Effect.gen(function* () {
		const sql = yield* SqlClient.SqlClient;
		const floor = `${since.slice(0, 13)}:00:00.000Z`;
		yield* sql.withTransaction(
			Effect.gen(function* () {
				yield* sql`DELETE FROM request_rollups WHERE hour >= ${floor}`;
				yield* sql`INSERT INTO request_rollups
					SELECT substr(timestamp, 1, 13) || ':00:00.000Z' AS hour, client_hash, provider, model,
						coalesce(auth_index, '') AS auth_index,
						count(*), sum(failed), sum(tokens_input), sum(tokens_cached), sum(tokens_output),
						sum(tokens_reasoning), sum(coalesce(latency_ms, 0)), sum(coalesce(ttft_ms, 0))
					FROM requests WHERE timestamp >= ${floor}
					GROUP BY hour, client_hash, provider, model, coalesce(auth_index, '')`;
			}),
		);
	});

/** Drops raw rows older than the retention window; rollups keep the history. */
export const pruneRequests = (now: string) =>
	Effect.gen(function* () {
		const sql = yield* SqlClient.SqlClient;
		const cutoff = new Date(Date.parse(now) - RAW_RETENTION_DAYS * 86_400_000).toISOString();
		yield* sql`DELETE FROM requests WHERE timestamp < ${cutoff}`;
		const [count] = yield* sql<{ n: number }>`SELECT changes() AS n`;
		return count?.n ?? 0;
	});

export const readCollectorState = Effect.gen(function* () {
	const sql = yield* SqlClient.SqlClient;
	const rows = yield* sql<{ key: string; value: string }>`SELECT key, value FROM collector_state`;
	const map = new Map(rows.map((row) => [row.key, row.value]));
	return {
		lastPopAt: map.get("last_pop_at") ?? null,
		lastPopCount: Number(map.get("last_pop_count") ?? 0),
		rowsWritten: Number(map.get("rows_written") ?? 0),
		lastSnapshotAt: map.get("last_snapshot_at") ?? null,
		lastError: map.get("last_error") ?? null,
		lastErrorAt: map.get("last_error_at") ?? null,
	};
});

export const writeCollectorState = (entries: Record<string, string | number | null>) =>
	Effect.gen(function* () {
		const sql = yield* SqlClient.SqlClient;
		for (const [key, value] of Object.entries(entries)) {
			if (value === null) {
				yield* sql`DELETE FROM collector_state WHERE key = ${key}`;
			} else {
				yield* sql`INSERT INTO collector_state ${sql.insert({ key, value: String(value) })}
					ON CONFLICT (key) DO UPDATE SET value = excluded.value`;
			}
		}
	});

export const incrementRowsWritten = (by: number) =>
	Effect.gen(function* () {
		const sql = yield* SqlClient.SqlClient;
		yield* sql`INSERT INTO collector_state (key, value) VALUES ('rows_written', ${String(by)})
			ON CONFLICT (key) DO UPDATE SET
				value = CAST(CAST(value AS INTEGER) + CAST(${by} AS INTEGER) AS TEXT)`;
	});

import { Effect } from "effect";
import { SqlClient } from "effect/unstable/sql";

// Read side of the ledger. Everything here returns aggregates; raw rows never
// leave the server. Percentiles are computed in process from sorted latencies,
// which at gateway scale (thousands of rows a day) stays well under budget.

export type Dimension = "client" | "model" | "provider" | "credential";

export interface Range {
	readonly from: string;
	readonly to: string;
}

export interface Summary {
	readonly requests: number;
	readonly failed: number;
	readonly tokens: number;
	readonly cached: number;
}

export interface BreakdownRow {
	readonly key: string;
	readonly label: string;
	/** The credential file name behind an auth_index row, the key the pools card carries. */
	readonly name?: string;
	readonly requests: number;
	readonly previousRequests: number;
	readonly errorRate: number;
	readonly tokens: number;
	readonly previousTokens: number;
	readonly tokensInput: number;
	readonly cached: number;
	readonly tokensCacheWrite: number;
	readonly tokensOutput: number;
	readonly tokensReasoning: number;
	readonly p50: number | null;
	readonly p95: number | null;
	readonly ttftP50: number | null;
	readonly ttftP95: number | null;
	readonly share: ReadonlyArray<{
		readonly model: string;
		readonly provider: string;
		readonly share: number;
	}>;
}

export interface QuotaPoint {
	readonly at: string;
	readonly label: string;
	readonly usedPercent: number;
	/** True when this point dropped from the previous one: the window reset. */
	readonly reset: boolean;
}

const column: Record<Dimension, string> = {
	client: "client_hash",
	model: "model",
	provider: "provider",
	credential: "coalesce(auth_index, '')",
};

// Raw rows live 90 days; older ranges read the hourly rollups, which carry the
// same sums but no per-request latencies, so percentiles come back null there.
const RAW_RETENTION_MS = 90 * 86_400_000;
const usesRollups = (range: Range, now: number = Date.now()): boolean =>
	Date.parse(range.from) < now - RAW_RETENTION_MS;

const percentile = (sorted: ReadonlyArray<number>, p: number): number | null => {
	if (sorted.length === 0) return null;
	const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
	return sorted[index] ?? null;
};

export const previousRange = (range: Range): Range => {
	const span = Date.parse(range.to) - Date.parse(range.from);
	return { from: new Date(Date.parse(range.from) - span).toISOString(), to: range.from };
};

export const summary = (range: Range, now: number = Date.now()) =>
	Effect.gen(function* () {
		const sql = yield* SqlClient.SqlClient;
		const [row] = usesRollups(range, now)
			? yield* sql<{ requests: number; failed: number; tokens: number; cached: number }>`
			SELECT coalesce(sum(requests), 0) AS requests, coalesce(sum(failed), 0) AS failed,
				coalesce(sum(tokens_input + tokens_cached + tokens_cache_write + tokens_output), 0) AS tokens,
				coalesce(sum(tokens_cached), 0) AS cached
			FROM request_rollups WHERE hour >= ${range.from} AND hour < ${range.to}`
			: yield* sql<{ requests: number; failed: number; tokens: number; cached: number }>`
			SELECT count(*) AS requests, coalesce(sum(failed), 0) AS failed,
				coalesce(sum(tokens_input + tokens_cached + tokens_cache_write + tokens_output), 0) AS tokens,
				coalesce(sum(tokens_cached), 0) AS cached
			FROM requests WHERE timestamp >= ${range.from} AND timestamp < ${range.to}`;
		return {
			requests: row?.requests ?? 0,
			failed: row?.failed ?? 0,
			tokens: row?.tokens ?? 0,
			cached: row?.cached ?? 0,
		} satisfies Summary;
	});

interface Totals {
	readonly key: string;
	readonly requests: number;
	readonly failed: number;
	readonly tokens: number;
	readonly tokens_input: number;
	readonly cached: number;
	readonly tokens_cache_write: number;
	readonly tokens_output: number;
	readonly tokens_reasoning: number;
}

const rolledBreakdown = (by: Dimension, range: Range, labels: ReadonlyMap<string, string>) =>
	Effect.gen(function* () {
		const sql = yield* SqlClient.SqlClient;
		const previous = previousRange(range);
		const key = sql.literal(by === "credential" ? "auth_index" : column[by]);
		const current = yield* sql<Totals>`
			SELECT ${key} AS key, sum(requests) AS requests, sum(failed) AS failed,
				sum(tokens_input + tokens_cached + tokens_cache_write + tokens_output) AS tokens,
				sum(tokens_input) AS tokens_input, sum(tokens_cached) AS cached,
				sum(tokens_cache_write) AS tokens_cache_write, sum(tokens_output) AS tokens_output,
				sum(tokens_reasoning) AS tokens_reasoning
			FROM request_rollups WHERE hour >= ${range.from} AND hour < ${range.to}
			GROUP BY ${key} ORDER BY requests DESC`;
		const before = yield* sql<{ key: string; requests: number; tokens: number }>`
			SELECT ${key} AS key, sum(requests) AS requests,
				sum(tokens_input + tokens_cached + tokens_cache_write + tokens_output) AS tokens
			FROM request_rollups WHERE hour >= ${previous.from} AND hour < ${previous.to} GROUP BY ${key}`;
		const models = yield* sql<{ key: string; model: string; provider: string; requests: number }>`
			SELECT ${key} AS key, model, provider, sum(requests) AS requests FROM request_rollups
			WHERE hour >= ${range.from} AND hour < ${range.to} GROUP BY ${key}, model, provider ORDER BY requests DESC`;
		const beforeByKey = new Map(before.map((row) => [row.key, row]));
		return current.map((row): BreakdownRow => {
			const prev = beforeByKey.get(row.key);
			return {
				key: row.key,
				label:
					labels.get(row.key) ?? (by === "client" ? row.key.slice(0, 16) : row.key || "unknown"),
				requests: row.requests,
				previousRequests: prev?.requests ?? 0,
				errorRate: row.requests === 0 ? 0 : row.failed / row.requests,
				tokens: row.tokens,
				previousTokens: prev?.tokens ?? 0,
				tokensInput: row.tokens_input,
				cached: row.cached,
				tokensCacheWrite: row.tokens_cache_write,
				tokensOutput: row.tokens_output,
				tokensReasoning: row.tokens_reasoning,
				p50: null,
				p95: null,
				ttftP50: null,
				ttftP95: null,
				share: models
					.filter((m) => m.key === row.key)
					.map((m) => ({
						model: m.model,
						provider: m.provider,
						share: row.requests === 0 ? 0 : m.requests / row.requests,
					})),
			};
		});
	});

export const breakdown = (
	by: Dimension,
	range: Range,
	labels: ReadonlyMap<string, string>,
	now: number = Date.now(),
) =>
	Effect.gen(function* () {
		if (usesRollups(range, now)) return yield* rolledBreakdown(by, range, labels);
		const sql = yield* SqlClient.SqlClient;
		const previous = previousRange(range);
		const key = sql.literal(column[by]);
		const current =
			yield* sql<Totals>`SELECT ${key} AS key, count(*) AS requests, coalesce(sum(failed), 0) AS failed,
				coalesce(sum(tokens_input + tokens_cached + tokens_cache_write + tokens_output), 0) AS tokens,
				coalesce(sum(tokens_input), 0) AS tokens_input, coalesce(sum(tokens_cached), 0) AS cached,
				coalesce(sum(tokens_cache_write), 0) AS tokens_cache_write,
				coalesce(sum(tokens_output), 0) AS tokens_output, coalesce(sum(tokens_reasoning), 0) AS tokens_reasoning
			FROM requests WHERE timestamp >= ${range.from} AND timestamp < ${range.to}
			GROUP BY ${key} ORDER BY requests DESC`;
		const before = yield* sql<{ key: string; requests: number; tokens: number }>`
			SELECT ${key} AS key, count(*) AS requests,
				coalesce(sum(tokens_input + tokens_cached + tokens_cache_write + tokens_output), 0) AS tokens
			FROM requests WHERE timestamp >= ${previous.from} AND timestamp < ${previous.to}
			GROUP BY ${key}`;
		const latencies = yield* sql<{
			key: string;
			latency_ms: number | null;
			ttft_ms: number | null;
		}>`
			SELECT ${key} AS key, latency_ms, ttft_ms FROM requests
			WHERE timestamp >= ${range.from} AND timestamp < ${range.to} AND failed = 0
			ORDER BY ${key}, latency_ms`;
		const models = yield* sql<{ key: string; model: string; provider: string; requests: number }>`
			SELECT ${key} AS key, model, provider, count(*) AS requests FROM requests
			WHERE timestamp >= ${range.from} AND timestamp < ${range.to}
			GROUP BY ${key}, model, provider ORDER BY requests DESC`;

		const beforeByKey = new Map(before.map((row) => [row.key, row]));
		const latencyByKey = new Map<string, { latency: Array<number>; ttft: Array<number> }>();
		for (const row of latencies) {
			const bucket = latencyByKey.get(row.key) ?? { latency: [], ttft: [] };
			if (row.latency_ms !== null) bucket.latency.push(row.latency_ms);
			if (row.ttft_ms !== null) bucket.ttft.push(row.ttft_ms);
			latencyByKey.set(row.key, bucket);
		}
		const modelsByKey = new Map<
			string,
			Array<{ model: string; provider: string; requests: number }>
		>();
		for (const row of models) modelsByKey.set(row.key, [...(modelsByKey.get(row.key) ?? []), row]);

		return current.map((row): BreakdownRow => {
			const prev = beforeByKey.get(row.key);
			const bucket = latencyByKey.get(row.key) ?? { latency: [], ttft: [] };
			const ttft = [...bucket.ttft].sort((a, b) => a - b);
			const share = (modelsByKey.get(row.key) ?? []).map((m) => ({
				model: m.model,
				provider: m.provider,
				share: row.requests === 0 ? 0 : m.requests / row.requests,
			}));
			return {
				key: row.key,
				label:
					labels.get(row.key) ?? (by === "client" ? row.key.slice(0, 16) : row.key || "unknown"),
				requests: row.requests,
				previousRequests: prev?.requests ?? 0,
				errorRate: row.requests === 0 ? 0 : row.failed / row.requests,
				tokens: row.tokens,
				previousTokens: prev?.tokens ?? 0,
				tokensInput: row.tokens_input,
				cached: row.cached,
				tokensCacheWrite: row.tokens_cache_write,
				tokensOutput: row.tokens_output,
				tokensReasoning: row.tokens_reasoning,
				p50: percentile(bucket.latency, 0.5),
				p95: percentile(bucket.latency, 0.95),
				ttftP50: percentile(ttft, 0.5),
				ttftP95: percentile(ttft, 0.95),
				share,
			};
		});
	});

/** Labels for the client dimension: registry label, else the stored label, else nothing (fingerprint). */
export const clientLabels = Effect.gen(function* () {
	const sql = yield* SqlClient.SqlClient;
	const rows = yield* sql<{
		hash: string;
		label: string | null;
	}>`SELECT hash, label FROM client_keys`;
	return new Map(rows.flatMap((row) => (row.label ? [[row.hash, row.label] as const] : [])));
});

/** Labels for the credential dimension: requests carry auth_index, credentials map it to a label. */
export const credentialLabels = Effect.gen(function* () {
	const sql = yield* SqlClient.SqlClient;
	const rows = yield* sql<{ auth_index: string | null; label: string }>`
		SELECT auth_index, label FROM credentials WHERE auth_index IS NOT NULL`;
	return new Map(
		rows.flatMap((row) => (row.auth_index ? [[row.auth_index, row.label] as const] : [])),
	);
});

/** The credential dimension joins back to a card by name: auth_index → name. */
export const credentialNamesByAuthIndex = Effect.gen(function* () {
	const sql = yield* SqlClient.SqlClient;
	const rows = yield* sql<{ auth_index: string | null; name: string }>`
		SELECT auth_index, name FROM credentials WHERE auth_index IS NOT NULL`;
	return new Map(
		rows.flatMap((row) => (row.auth_index ? [[row.auth_index, row.name] as const] : [])),
	);
});

export const credentialNames = Effect.gen(function* () {
	const sql = yield* SqlClient.SqlClient;
	const rows = yield* sql<{ name: string; label: string; provider: string }>`
		SELECT name, label, provider FROM credentials ORDER BY provider, label`;
	return rows;
});

interface StoredQuota {
	readonly windows: ReadonlyArray<{ label: string; usedPercent: number }>;
}

export const quotaHistory = (credential: string, range: Range) =>
	Effect.gen(function* () {
		const sql = yield* SqlClient.SqlClient;
		// One point before the range so the first segment has a start.
		const rows = yield* sql<{ observed_at: string; quota: string }>`
			SELECT observed_at, quota FROM quota_snapshots
			WHERE credential = ${credential} AND observed_at < ${range.to}
				AND id >= coalesce((SELECT max(id) FROM quota_snapshots
					WHERE credential = ${credential} AND observed_at < ${range.from}), 0)
			ORDER BY id`;
		const last = new Map<string, number>();
		const points: Array<QuotaPoint> = [];
		for (const row of rows) {
			const quota = JSON.parse(row.quota) as StoredQuota;
			for (const window of quota.windows) {
				const previous = last.get(window.label);
				// One point per observed change per window; a snapshot repeats unchanged windows.
				if (previous === window.usedPercent) continue;
				points.push({
					at: row.observed_at,
					label: window.label,
					usedPercent: window.usedPercent,
					reset: previous !== undefined && window.usedPercent < previous,
				});
				last.set(window.label, window.usedPercent);
			}
		}
		return points;
	});

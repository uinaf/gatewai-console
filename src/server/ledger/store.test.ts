import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ConfigProvider, Effect, Layer, Schema } from "effect";
import { SqlClient } from "effect/unstable/sql";
import { expect, test } from "vitest";

import { Database } from "#/server/database";
import { hashKey } from "#/server/ledger/clients";
import {
	insertRequests,
	pruneRequests,
	readCollectorState,
	recordQuotaSnapshot,
	rollupSince,
	toRow,
	upsertCredentials,
} from "#/server/ledger/store";
import { poolsOf } from "#/server/management/credential";
import authFiles from "#/server/management/fixtures/auth-files.json";
import usageQueue from "#/server/management/fixtures/usage-queue.json";
import { AuthFiles, UsageRecord } from "#/server/management/schema";

const layer = () =>
	Database.pipe(
		Layer.provide(
			ConfigProvider.layer(
				ConfigProvider.fromUnknown({
					GATEWAI_DB_PATH: join(mkdtempSync(join(tmpdir(), "gatewai-ledger-")), "l.sqlite"),
				}),
			),
		),
	);
const run = <A, E>(effect: Effect.Effect<A, E, SqlClient.SqlClient>) =>
	effect.pipe(Effect.provide(layer()), Effect.runPromise);

const records = usageQueue.map((record) => Schema.decodeUnknownSync(UsageRecord)(record));
const at = "2026-09-16T15:10:00.000Z";

test("a popped batch stores once, hashes the key, and re-pops are no-ops", async () => {
	const rows = records.map((record) => toRow(record, at));
	const registry = new Map([[hashKey(records[0]?.api_key ?? ""), "macbook"]]);
	const result = await run(
		Effect.gen(function* () {
			const sql = yield* SqlClient.SqlClient;
			const first = yield* insertRequests(rows, registry);
			const second = yield* insertRequests(rows, registry);
			const stored = yield* sql<{
				request_id: string;
				client_hash: string;
				raw: string;
				timestamp: string;
			}>`
				SELECT request_id, client_hash, raw, timestamp FROM requests ORDER BY request_id`;
			const keys = yield* sql<{
				hash: string;
				label: string | null;
			}>`SELECT hash, label FROM client_keys`;
			return { first, second, stored, keys };
		}),
	);
	expect(result.first).toBe(rows.length);
	expect(result.second).toBe(0);
	expect(result.stored).toHaveLength(rows.length);
	for (const row of result.stored) {
		expect(row.client_hash).toMatch(/^[a-f0-9]{64}$/);
		expect(row.raw).not.toContain(records[0]?.api_key ?? "never");
		expect(row.timestamp.endsWith("Z")).toBe(true);
	}
	expect(result.keys.map((key) => key.label)).toContain("macbook");
});

test("a record without request_id gets a stable content hash id and cache writes are kept", async () => {
	const base = records[0];
	if (!base) throw new Error("fixture missing record");
	const { request_id: _id, ...anonymous } = base;
	const first = toRow(anonymous, at);
	const again = toRow(anonymous, "2026-09-16T15:11:00.000Z");
	expect(first.request_id).toMatch(/^hash:[a-f0-9]{32}$/);
	expect(again.request_id).toBe(first.request_id);
	expect(first.tokens_cache_write).toBe(base.token_breakdown?.input?.cache_write_tokens ?? -1);
});

test("a label removed from the registry reverts to a fingerprint", async () => {
	const rows = records.map((record) => toRow(record, at));
	const hash = rows[0]?.client_hash ?? "";
	const labels = await run(
		Effect.gen(function* () {
			const sql = yield* SqlClient.SqlClient;
			yield* insertRequests(rows, new Map([[hash, "macbook"]]));
			yield* insertRequests(rows, new Map());
			return yield* sql<{
				label: string | null;
			}>`SELECT label FROM client_keys WHERE hash = ${hash}`;
		}),
	);
	expect(labels[0]?.label).toBeNull();
});

test("quota snapshots record only changes; credentials upsert", async () => {
	const { credentials } = poolsOf(Schema.decodeUnknownSync(AuthFiles)(authFiles));
	const codex = credentials.find((credential) => credential.provider === "codex");
	if (!codex) throw new Error("fixture missing codex");
	const drained = {
		...codex,
		quota: {
			...codex.quota,
			windows: codex.quota.windows.map((window) => ({ ...window, usedPercent: 100 })),
		},
	};
	const result = await run(
		Effect.gen(function* () {
			const sql = yield* SqlClient.SqlClient;
			yield* upsertCredentials(credentials, at);
			yield* upsertCredentials(credentials, "2026-09-16T16:00:00.000Z");
			const a = yield* recordQuotaSnapshot(codex, at);
			const b = yield* recordQuotaSnapshot(codex, at);
			const c = yield* recordQuotaSnapshot(drained, at);
			const rows = yield* sql<{
				n: number;
			}>`SELECT count(*) AS n FROM quota_snapshots WHERE credential = ${codex.name}`;
			const creds = yield* sql<{
				name: string;
				last_seen: string;
			}>`SELECT name, last_seen FROM credentials ORDER BY name`;
			return { a, b, c, n: rows[0]?.n, creds };
		}),
	);
	expect([result.a, result.b, result.c]).toEqual([true, false, true]);
	expect(result.n).toBe(2);
	expect(result.creds).toHaveLength(credentials.length);
	expect(result.creds[0]?.last_seen).toBe("2026-09-16T16:00:00.000Z");
});

test("rollups aggregate per hour and pruning keeps the window", async () => {
	const base = records[0];
	if (!base) throw new Error("fixture missing record");
	const make = (id: string, timestamp: string, failed: boolean) =>
		toRow({ ...base, request_id: id, timestamp, failed }, at);
	const rows = [
		make("a", "2026-09-16T14:05:00Z", false),
		make("b", "2026-09-16T14:50:00Z", true),
		make("c", "2026-09-16T15:01:00Z", false),
		make("old", "2026-06-01T00:00:00Z", false),
	];
	const result = await run(
		Effect.gen(function* () {
			const sql = yield* SqlClient.SqlClient;
			yield* insertRequests(rows, new Map());
			yield* rollupSince("2026-09-16T14:00:00.000Z");
			yield* rollupSince("2026-09-16T14:00:00.000Z");
			const rollups = yield* sql<{ hour: string; requests: number; failed: number }>`
				SELECT hour, requests, failed FROM request_rollups ORDER BY hour`;
			const pruned = yield* pruneRequests(at);
			const left = yield* sql<{ n: number }>`SELECT count(*) AS n FROM requests`;
			const state = yield* readCollectorState;
			return { rollups, pruned, left: left[0]?.n, state };
		}),
	);
	expect(result.rollups).toEqual([
		{ hour: "2026-09-16T14:00:00.000Z", requests: 2, failed: 1 },
		{ hour: "2026-09-16T15:00:00.000Z", requests: 1, failed: 0 },
	]);
	expect(result.pruned).toBe(1);
	expect(result.left).toBe(3);
	expect(result.state.rowsWritten).toBe(0);
});

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ConfigProvider, Effect, Layer, Schema } from "effect";
import { ClientRegistry } from "#/server/ledger/clients";
import { SqlClient } from "effect/unstable/sql";
import { expect, test } from "vitest";

import { Database } from "#/server/database";
import { maintainOnce, popOnce, snapshotOnce } from "#/server/ledger/collector";
import { readCollectorState } from "#/server/ledger/store";
import { ManagementApi, ManagementError } from "#/server/management/api";
import { poolsOf } from "#/server/management/credential";
import authFiles from "#/server/management/fixtures/auth-files.json";
import usageQueue from "#/server/management/fixtures/usage-queue.json";
import { AuthFiles, UsageRecord } from "#/server/management/schema";

const records = usageQueue.map((record) => Schema.decodeUnknownSync(UsageRecord)(record));
const pools = poolsOf(Schema.decodeUnknownSync(AuthFiles)(authFiles));

// A gateway that hands out its queue once, then fails.
const fakeApi = (queue: Array<typeof records>) =>
	Layer.succeed(
		ManagementApi,
		ManagementApi.of({
			authFiles: Effect.die("unused"),
			pools: Effect.succeed(pools),
			popUsage: () => {
				const batch = queue.shift();
				return batch
					? Effect.succeed(batch)
					: Effect.fail(
							new ManagementError({ reason: "unreachable", message: "gateway gone", cause: null }),
						);
			},
			apiKeys: Effect.die("unused"),
			config: Effect.die("unused"),
			latestVersion: Effect.die("unused"),
			resetQuota: () => Effect.die("unused"),
			refresh: () => Effect.die("unused"),
			patchFields: () => Effect.die("unused"),
		}),
	);

const layer = (queue: Array<typeof records>) =>
	Layer.mergeAll(Database, fakeApi(queue)).pipe(
		Layer.provide(
			ConfigProvider.layer(
				ConfigProvider.fromUnknown({
					GATEWAI_DB_PATH: join(mkdtempSync(join(tmpdir(), "gatewai-collector-")), "c.sqlite"),
				}),
			),
		),
	);

test("popOnce stores the batch and records state; a re-pop of the same ids writes nothing", async () => {
	const result = await Effect.gen(function* () {
		const sql = yield* SqlClient.SqlClient;
		const first = yield* popOnce;
		const second = yield* popOnce;
		const state = yield* readCollectorState;
		const rows = yield* sql<{ n: number }>`SELECT count(*) AS n FROM requests`;
		return { first, second, state, n: rows[0]?.n };
	}).pipe(Effect.provide(layer([records, records])), Effect.runPromise);
	expect(result.first).toEqual({ popped: records.length, written: records.length });
	expect(result.second).toEqual({ popped: records.length, written: 0 });
	expect(result.n).toBe(records.length);
	expect(result.state.rowsWritten).toBe(records.length);
	expect(result.state.lastError).toBeNull();
	expect(result.state.lastPopAt).not.toBeNull();
});

test("a failed pop surfaces as a ManagementError for the loop to record", async () => {
	const exit = await popOnce.pipe(Effect.provide(layer([])), Effect.exit, Effect.runPromise);
	expect(exit._tag).toBe("Failure");
});

test("snapshotOnce upserts credentials and records one snapshot per credential, then none", async () => {
	const result = await Effect.gen(function* () {
		const first = yield* snapshotOnce;
		const second = yield* snapshotOnce;
		const state = yield* readCollectorState;
		return { first, second, state };
	}).pipe(Effect.provide(layer([])), Effect.runPromise);
	expect(result.first).toBe(pools.credentials.length);
	expect(result.second).toBe(0);
	expect(result.state.lastSnapshotAt).not.toBeNull();
});

test("maintainOnce rolls up stored hours and records the run", async () => {
	const result = await Effect.gen(function* () {
		const sql = yield* SqlClient.SqlClient;
		yield* popOnce;
		const pruned = yield* maintainOnce;
		const rollups = yield* sql<{ n: number }>`SELECT count(*) AS n FROM request_rollups`;
		const state = yield* sql<{
			value: string;
		}>`SELECT value FROM collector_state WHERE key = 'last_maintenance_at'`;
		const written = yield* sql<{
			value: string;
		}>`SELECT value FROM collector_state WHERE key = 'rows_written'`;
		return {
			pruned,
			rollups: rollups[0]?.n,
			maintained: state[0]?.value,
			written: written[0]?.value,
		};
	}).pipe(Effect.provide(layer([records])), Effect.runPromise);
	expect(result.pruned).toBe(0);
	expect(result.written).toBe(String(records.length));
	// Both fixture records fall in the same hour; the horizon is relative to the newest stored row.
	expect(result.rollups).toBe(1);
	expect(result.maintained).not.toBeUndefined();
});

test("a missing or malformed clients file is an empty registry, not a defect", async () => {
	const missing = await ClientRegistry.pipe(
		Effect.provide(
			ConfigProvider.layer(
				ConfigProvider.fromUnknown({ GATEWAI_CLIENTS_FILE: "/nonexistent/clients.json" }),
			),
		),
		Effect.runPromise,
	);
	expect(missing.size).toBe(0);
});

test("a pop error is kept per stage and cleared only by that stage", async () => {
	const result = await Effect.gen(function* () {
		const sql = yield* SqlClient.SqlClient;
		yield* sql`INSERT INTO collector_state (key, value) VALUES ('error:snapshot', 'boom'), ('error_at:snapshot', '2026-09-16T00:00:00.000Z')`;
		yield* popOnce;
		return yield* readCollectorState;
	}).pipe(Effect.provide(layer([records])), Effect.runPromise);
	expect(result.lastError).toBe("snapshot: boom");
});

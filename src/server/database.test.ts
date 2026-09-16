import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { ConfigProvider, Effect, Layer } from "effect";
import { SqlClient } from "effect/unstable/sql";
import { expect, test } from "vitest";

import { Database, makeDatabase } from "#/server/database";
import { health } from "#/server/health";

const configured = <A, E, R>(layer: Layer.Layer<A, E, R>, path: string) =>
	layer.pipe(
		Layer.provide(ConfigProvider.layer(ConfigProvider.fromUnknown({ GATEWAI_DB_PATH: path }))),
	);

test("migrations create the meta table and health reports the db reachable", async () => {
	const dir = mkdtempSync(join(tmpdir(), "gatewai-console-"));
	const result = await Effect.gen(function* () {
		const sql = yield* SqlClient.SqlClient;
		yield* sql`insert into meta ${sql.insert({ key: "schema", value: "v1" })}`;
		const rows = yield* sql<{ key: string; value: string }>`select key, value from meta`;
		const mode = yield* sql<{ journal_mode: string }>`pragma journal_mode`;
		const fk = yield* sql<{ foreign_keys: number }>`pragma foreign_keys`;
		const report = yield* health;
		return { rows, mode, fk, report };
	}).pipe(Effect.provide(configured(Database, join(dir, "test.sqlite"))), Effect.runPromise);

	expect(result.rows).toEqual([{ key: "schema", value: "v1" }]);
	expect(result.mode).toEqual([{ journal_mode: "wal" }]);
	expect(result.fk).toEqual([{ foreign_keys: 1 }]);
	expect(result.report).toMatchObject({ ok: true, db: "reachable", version: __APP_VERSION__ });
});

test("a failing migration rolls back and leaves no partial schema", async () => {
	const path = join(mkdtempSync(join(tmpdir(), "gatewai-console-migration-")), "test.sqlite");
	const broken = makeDatabase({
		"0001_broken": Effect.gen(function* () {
			const sql = yield* SqlClient.SqlClient;
			yield* sql`CREATE TABLE partial (id integer)`;
			yield* sql`CREATE TABLE partial (id integer)`;
		}),
	});

	const exit = await Effect.void.pipe(
		Effect.provide(configured(broken, path)),
		Effect.exit,
		Effect.runPromise,
	);
	expect(exit._tag).toBe("Failure");

	const sqlite = new DatabaseSync(path);
	const tables = sqlite
		.prepare("select name from sqlite_master where type = 'table' and name = 'partial'")
		.all();
	const records = sqlite.prepare("select count(*) as n from effect_sql_migrations").get() as {
		n: number;
	};
	sqlite.close();
	expect(tables).toEqual([]);
	expect(records.n).toBe(0);
});

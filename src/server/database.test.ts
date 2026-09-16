import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { sql } from "drizzle-orm";
import { ConfigProvider, Effect, Layer } from "effect";
import { expect, test } from "vitest";

import { meta } from "#/db/schema";
import { Database } from "#/server/database";
import { health } from "#/server/health";

const dir = mkdtempSync(join(tmpdir(), "gatewai-console-"));

const layer = Database.layer.pipe(
	Layer.provide(
		ConfigProvider.layer(ConfigProvider.fromUnknown({ GATEWAI_DB_PATH: join(dir, "test.sqlite") })),
	),
);

test("migrations create the meta table and health reports the db reachable", async () => {
	const result = await Effect.gen(function* () {
		const { db } = yield* Database;
		yield* Effect.promise(() => db.insert(meta).values({ key: "schema", value: "v1" }));
		const rows = yield* Effect.promise(() => db.select().from(meta));
		const mode = yield* Effect.promise(() => db.get<[string]>(sql`pragma journal_mode`));
		const report = yield* health;
		return { rows, mode, report };
	}).pipe(Effect.provide(layer), Effect.runPromise);

	expect(result.rows).toEqual([{ key: "schema", value: "v1" }]);
	expect(result.mode).toEqual(["wal"]);
	expect(result.report).toMatchObject({ ok: true, db: "reachable", version: __APP_VERSION__ });
});

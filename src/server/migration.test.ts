import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { ConfigProvider, Effect, Layer } from "effect";
import { expect, test } from "vitest";

import { Database } from "#/server/database";

test("a failing migration batch rolls back and leaves no partial schema", async () => {
	const dir = mkdtempSync(join(tmpdir(), "gatewai-console-migration-"));
	const migrations = join(dir, "drizzle");
	mkdirSync(join(migrations, "meta"), { recursive: true });
	writeFileSync(
		join(migrations, "meta", "_journal.json"),
		JSON.stringify({
			version: "7",
			dialect: "sqlite",
			entries: [{ idx: 0, version: "6", when: 1, tag: "0000_broken", breakpoints: true }],
		}),
	);
	writeFileSync(
		join(migrations, "0000_broken.sql"),
		"CREATE TABLE partial (id integer);\n--> statement-breakpoint\nCREATE TABLE partial (id integer);\n",
	);
	const path = join(dir, "test.sqlite");
	const layer = Database.layer.pipe(
		Layer.provide(
			ConfigProvider.layer(
				ConfigProvider.fromUnknown({ GATEWAI_DB_PATH: path, GATEWAI_MIGRATIONS_DIR: migrations }),
			),
		),
	);

	const exit = await Effect.void.pipe(Effect.provide(layer), Effect.exit, Effect.runPromise);
	expect(exit._tag).toBe("Failure");

	const sqlite = new DatabaseSync(path);
	const tables = sqlite
		.prepare("select name from sqlite_master where type = 'table' and name = 'partial'")
		.all();
	const records = sqlite.prepare("select count(*) as n from __drizzle_migrations").get() as {
		n: number;
	};
	sqlite.close();
	expect(tables).toEqual([]);
	expect(records.n).toBe(0);
});

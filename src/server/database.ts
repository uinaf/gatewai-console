import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

import { SqliteClient, SqliteMigrator } from "@effect/sql-sqlite-node";
import { Config, Effect, Layer } from "effect";
import { SqlClient } from "effect/unstable/sql";

import { migrations } from "#/db/migrations";

const DbPath = Config.String("GATEWAI_DB_PATH").pipe(Config.withDefault("data/console.sqlite"));

// WAL and a 5s busy timeout are the driver defaults; foreign keys are per connection
// and the client holds exactly one.
const pragmas = Layer.effectDiscard(
	Effect.gen(function* () {
		const sql = yield* SqlClient.SqlClient;
		yield* sql`PRAGMA foreign_keys = ON`;
	}),
);

const client = Layer.unwrap(
	Effect.gen(function* () {
		const filename = yield* DbPath;
		if (filename !== ":memory:") mkdirSync(dirname(filename), { recursive: true });
		return SqliteClient.layer({ filename });
	}),
);

/** `SqlClient` over the console database, migrated and with pragmas applied. */
export const makeDatabase = (loader: Parameters<typeof SqliteMigrator.fromRecord>[0]) =>
	Layer.mergeAll(SqliteMigrator.layer({ loader: SqliteMigrator.fromRecord(loader) }), pragmas).pipe(
		Layer.provideMerge(client),
	);

export const Database = makeDatabase(migrations);

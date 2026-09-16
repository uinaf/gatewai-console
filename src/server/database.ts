import { DatabaseSync } from "node:sqlite";
import { dirname, resolve } from "node:path";
import { mkdirSync } from "node:fs";

import { drizzle } from "drizzle-orm/sqlite-proxy";
import { migrate } from "drizzle-orm/sqlite-proxy/migrator";
import { sql } from "drizzle-orm";
import { Config, Context, Effect, Layer, Schema } from "effect";

import * as schema from "#/db/schema";

export class DatabaseError extends Schema.TaggedError<DatabaseError>()("DatabaseError", {
	cause: Schema.Defect(),
}) {}

export type Drizzle = ReturnType<typeof drizzle<typeof schema>>;

export class Database extends Context.Service<
	Database,
	{
		readonly db: Drizzle;
		readonly ping: Effect.Effect<void, DatabaseError>;
	}
>()("gatewai-console/server/Database") {
	static readonly layer = Layer.effect(
		Database,
		Effect.gen(function* () {
			const path = yield* Config.String("GATEWAI_DB_PATH").pipe(
				Config.withDefault("/data/console.sqlite"),
			);
			const migrationsFolder = yield* Config.String("GATEWAI_MIGRATIONS_DIR").pipe(
				Config.withDefault(resolve("drizzle")),
			);

			const sqlite = yield* Effect.acquireRelease(
				Effect.try({
					try: () => openSqlite(path),
					catch: (cause) => new DatabaseError({ cause }),
				}),
				(sqlite) => Effect.sync(() => sqlite.close()),
			);

			const db = drizzle<typeof schema>(
				async (query, params, method) => {
					const stmt = sqlite.prepare(query);
					const args = params as ReadonlyArray<null | number | bigint | string | Uint8Array>;
					if (method === "run") {
						stmt.run(...args);
						return { rows: [] };
					}
					const rows = stmt.all(...args).map((row) => Object.values(row));
					return { rows: method === "get" ? (rows[0] ?? []) : rows };
				},
				{ schema },
			);

			yield* Effect.tryPromise({
				try: () =>
					migrate(
						db,
						async (queries) => {
							// One transaction for the whole batch: a failing statement must not leave
							// earlier schema changes committed without their migration record.
							sqlite.exec("BEGIN");
							try {
								for (const query of queries) sqlite.exec(query);
								sqlite.exec("COMMIT");
							} catch (cause) {
								sqlite.exec("ROLLBACK");
								throw cause;
							}
						},
						{ migrationsFolder },
					),
				catch: (cause) => new DatabaseError({ cause }),
			});

			const ping = Effect.tryPromise({
				try: () => db.get(sql`select 1`),
				catch: (cause) => new DatabaseError({ cause }),
			}).pipe(Effect.asVoid);

			return Database.of({ db, ping });
		}),
	);
}

function openSqlite(path: string) {
	if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
	const sqlite = new DatabaseSync(path);
	sqlite.exec("PRAGMA journal_mode = WAL");
	sqlite.exec("PRAGMA busy_timeout = 5000");
	sqlite.exec("PRAGMA foreign_keys = ON");
	return sqlite;
}

import { Effect } from "effect";

import { Database } from "#/server/database";

export interface Health {
	readonly ok: boolean;
	readonly version: string;
	readonly uptimeSeconds: number;
	readonly db: "reachable" | "unreachable";
}

export const health: Effect.Effect<Health, never, Database> = Effect.gen(function* () {
	const database = yield* Database;
	const db = yield* database.ping.pipe(
		Effect.as("reachable" as const),
		Effect.catchTag("DatabaseError", (error) =>
			Effect.logError("healthz: database unreachable", error.cause).pipe(
				Effect.as("unreachable" as const),
			),
		),
	);
	return {
		ok: db === "reachable",
		version: __APP_VERSION__,
		uptimeSeconds: Math.round(process.uptime()),
		db,
	};
});

import { Effect } from "effect";
import { SqlClient } from "effect/unstable/sql";

export interface Health {
	readonly ok: boolean;
	readonly version: string;
	readonly uptimeSeconds: number;
	readonly db: "reachable" | "unreachable";
}

export const health: Effect.Effect<Health, never, SqlClient.SqlClient> = Effect.gen(function* () {
	const sql = yield* SqlClient.SqlClient;
	const db = yield* sql`select 1`.pipe(
		Effect.as("reachable" as const),
		Effect.catchTag("SqlError", (error) =>
			Effect.logError("healthz: database unreachable", error).pipe(
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

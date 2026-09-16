import { Effect } from "effect";
import { SqlClient } from "effect/unstable/sql";

import { readCollectorState } from "#/server/ledger/store";

export interface Health {
	readonly ok: boolean;
	readonly version: string;
	readonly uptimeSeconds: number;
	readonly db: "reachable" | "unreachable";
	readonly collector: {
		readonly lastPopAt: string | null;
		readonly lagSeconds: number | null;
		readonly rowsWritten: number;
		readonly lastSnapshotAt: string | null;
		readonly lastError: string | null;
	} | null;
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
	const state =
		db === "reachable"
			? yield* readCollectorState.pipe(Effect.catch(() => Effect.succeed(null)))
			: null;
	return {
		ok: db === "reachable",
		version: __APP_VERSION__,
		uptimeSeconds: Math.round(process.uptime()),
		db,
		collector: state
			? {
					lastPopAt: state.lastPopAt,
					lagSeconds: state.lastPopAt
						? Math.max(0, Math.round((Date.now() - Date.parse(state.lastPopAt)) / 1000))
						: null,
					rowsWritten: state.rowsWritten,
					lastSnapshotAt: state.lastSnapshotAt,
					lastError: state.lastError,
				}
			: null,
	};
});

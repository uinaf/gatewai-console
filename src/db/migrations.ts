import { Effect } from "effect";
import { SqlClient } from "effect/unstable/sql";

// Keyed `<id>_<name>`; the migrator runs pending ids in order inside one transaction.
export const migrations = {
	"0001_init": Effect.gen(function* () {
		const sql = yield* SqlClient.SqlClient;
		// IF NOT EXISTS: volumes booted by the 0.1.0 image already hold this table from Drizzle.
		yield* sql`CREATE TABLE IF NOT EXISTS meta (key text PRIMARY KEY NOT NULL, value text NOT NULL)`;
	}),
};

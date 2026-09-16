import { Effect } from "effect";
import { SqlClient } from "effect/unstable/sql";

// Keyed `<id>_<name>`; the migrator runs pending ids in order inside one transaction.
export const migrations = {
	"0001_init": Effect.gen(function* () {
		const sql = yield* SqlClient.SqlClient;
		// Key-value table that proves the migration path. Later layers add the ledger.
		yield* sql`CREATE TABLE meta (key text PRIMARY KEY NOT NULL, value text NOT NULL)`;
	}),
};

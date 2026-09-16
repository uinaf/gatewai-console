import { sqliteTable, text } from "drizzle-orm/sqlite-core";

// Key-value table that proves the migration path. Later layers add the ledger.
export const meta = sqliteTable("meta", {
	key: text("key").primaryKey(),
	value: text("value").notNull(),
});

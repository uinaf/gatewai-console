import { Effect } from "effect";
import { SqlClient } from "effect/unstable/sql";

// Keyed `<id>_<name>`; the migrator runs pending ids in order inside one transaction.
export const migrations = {
	"0001_init": Effect.gen(function* () {
		const sql = yield* SqlClient.SqlClient;
		// IF NOT EXISTS: volumes booted by the 0.1.0 image already hold this table from Drizzle.
		yield* sql`CREATE TABLE IF NOT EXISTS meta (key text PRIMARY KEY NOT NULL, value text NOT NULL)`;
	}),
	// The ledger: one row per proxied request (raw JSON kept beside the typed
	// columns), quota snapshots when they change, hourly rollups kept forever.
	"0002_ledger": Effect.gen(function* () {
		const sql = yield* SqlClient.SqlClient;
		yield* sql`CREATE TABLE requests (
			request_id text PRIMARY KEY NOT NULL,
			timestamp text NOT NULL,
			client_hash text NOT NULL,
			provider text NOT NULL,
			model text NOT NULL,
			auth_index text,
			source text,
			stream integer NOT NULL DEFAULT 0,
			failed integer NOT NULL DEFAULT 0,
			latency_ms integer,
			ttft_ms integer,
			tokens_input integer NOT NULL DEFAULT 0,
			tokens_cached integer NOT NULL DEFAULT 0,
			tokens_output integer NOT NULL DEFAULT 0,
			tokens_reasoning integer NOT NULL DEFAULT 0,
			reasoning_effort text,
			service_tier text,
			user_agent text,
			raw text NOT NULL,
			received_at text NOT NULL
		)`;
		yield* sql`CREATE INDEX requests_timestamp ON requests (timestamp)`;
		yield* sql`CREATE INDEX requests_client_timestamp ON requests (client_hash, timestamp)`;
		yield* sql`CREATE TABLE client_keys (
			hash text PRIMARY KEY NOT NULL,
			label text,
			first_seen text NOT NULL,
			last_seen text NOT NULL
		)`;
		yield* sql`CREATE TABLE credentials (
			name text PRIMARY KEY NOT NULL,
			provider text NOT NULL,
			label text NOT NULL,
			first_seen text NOT NULL,
			last_seen text NOT NULL
		)`;
		yield* sql`CREATE TABLE quota_snapshots (
			id integer PRIMARY KEY AUTOINCREMENT,
			credential text NOT NULL,
			observed_at text NOT NULL,
			recorded_at text NOT NULL,
			quota text NOT NULL
		)`;
		yield* sql`CREATE INDEX quota_snapshots_credential ON quota_snapshots (credential, recorded_at)`;
		yield* sql`CREATE TABLE request_rollups (
			hour text NOT NULL,
			client_hash text NOT NULL,
			provider text NOT NULL,
			model text NOT NULL,
			auth_index text NOT NULL,
			requests integer NOT NULL,
			failed integer NOT NULL,
			tokens_input integer NOT NULL,
			tokens_cached integer NOT NULL,
			tokens_output integer NOT NULL,
			tokens_reasoning integer NOT NULL,
			latency_ms_sum integer NOT NULL,
			ttft_ms_sum integer NOT NULL,
			PRIMARY KEY (hour, client_hash, provider, model, auth_index)
		)`;
		yield* sql`CREATE TABLE collector_state (key text PRIMARY KEY NOT NULL, value text NOT NULL)`;
	}),
};

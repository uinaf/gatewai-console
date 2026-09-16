import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { Config, Effect, Schema } from "effect";

// The proxy emits the raw client key on every usage record. The ledger only
// ever stores its sha256; the registry maps that hash to an operator-chosen
// label (`macbook`, `devbox`, ...). Unknown keys show as a 16-char fingerprint.
export const hashKey = (key: string): string => createHash("sha256").update(key).digest("hex");

const Registry = Schema.Record(Schema.String, Schema.String);

export const ClientRegistry = Config.String("GATEWAI_CLIENTS_FILE").pipe(
	// A missing or malformed file is an error, never a defect: the pop loop must not die on it.
	Effect.flatMap((file) =>
		Effect.try({
			try: () => JSON.parse(readFileSync(file, "utf8")) as unknown,
			catch: (cause) =>
				new Error(`cannot read ${file}: ${cause instanceof Error ? cause.message : cause}`),
		}),
	),
	Effect.flatMap(Schema.decodeUnknownEffect(Registry)),
	Effect.map((entries): ReadonlyMap<string, string> => new Map(Object.entries(entries))),
	// No registry configured or an unreadable one: every key is a fingerprint.
	Effect.catch((error) =>
		Effect.logWarning("clients: registry unavailable", String(error)).pipe(
			Effect.as<ReadonlyMap<string, string>>(new Map()),
		),
	),
);

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { Config, Effect, Schema } from "effect";

// The proxy emits the raw client key on every usage record. The ledger only
// ever stores its sha256; the registry maps that hash to an operator-chosen
// label (`macbook`, `devbox`, ...). Unknown keys show as a 16-char fingerprint.
export const hashKey = (key: string): string => createHash("sha256").update(key).digest("hex");

// Two shapes: a flat `{ "<sha256>": "label" }` map, or the inventory a
// deployment renders beside the proxy, `{ "clients": [{ "name", "fingerprint" }] }`,
// whose fingerprints are the first 16 hex characters of the same sha256.
const Registry = Schema.Union([
	Schema.Record(Schema.String, Schema.String),
	Schema.Struct({
		clients: Schema.Array(Schema.Struct({ name: Schema.String, fingerprint: Schema.String })),
	}),
]);

/** Labels keyed by full hash or by a 16-char fingerprint; `lookup` resolves either. */
export class ClientLabels {
	readonly #byHash: ReadonlyMap<string, string>;
	readonly #byPrefix: ReadonlyMap<string, string>;
	constructor(byHash: ReadonlyMap<string, string>, byPrefix: ReadonlyMap<string, string>) {
		this.#byHash = byHash;
		this.#byPrefix = byPrefix;
	}
	static empty(): ClientLabels {
		return new ClientLabels(new Map(), new Map());
	}
	get(hash: string): string | undefined {
		return this.#byHash.get(hash) ?? this.#byPrefix.get(hash.slice(0, 16));
	}
	get size(): number {
		return this.#byHash.size + this.#byPrefix.size;
	}
}

// Unset means "no registry" and is silent; only an unreadable or invalid file warns.
export const ClientRegistry = Config.String("GATEWAI_CLIENTS_FILE").pipe(
	Config.withDefault(""),
	Effect.filterOrFail(
		(file) => file !== "",
		() => new Error("unset"),
	),
	// A missing or malformed file is an error, never a defect: the pop loop must not die on it.
	Effect.flatMap((file) =>
		Effect.try({
			try: () => JSON.parse(readFileSync(file, "utf8")) as unknown,
			catch: (cause) =>
				new Error(`cannot read ${file}: ${cause instanceof Error ? cause.message : cause}`),
		}),
	),
	Effect.flatMap(Schema.decodeUnknownEffect(Registry)),
	Effect.map((entries): ClientLabels =>
		"clients" in entries && Array.isArray(entries.clients)
			? new ClientLabels(
					new Map(),
					new Map(entries.clients.map((c) => [c.fingerprint, c.name] as const)),
				)
			: new ClientLabels(new Map(Object.entries(entries as Record<string, string>)), new Map()),
	),
	// No registry configured or an unreadable one: every key is a fingerprint.
	Effect.catch((error) =>
		(error instanceof Error && error.message === "unset"
			? Effect.void
			: Effect.logWarning("clients: registry unavailable", String(error))
		).pipe(Effect.as(ClientLabels.empty())),
	),
);

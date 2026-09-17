import { createServerFn } from "@tanstack/react-start";
import { getRequestHeader } from "@tanstack/react-start/server";
import { Config, Effect } from "effect";

import {
	type BreakdownRow,
	type Dimension,
	type QuotaPoint,
	type Range,
	type Summary,
	breakdown,
	clientLabels,
	credentialLabels,
	credentialNames,
	previousRange,
	quotaHistory,
	summary,
} from "#/server/ledger/queries";
import { readCollectorState } from "#/server/ledger/store";
import { runtime } from "#/server/runtime";

type Preset = "24h" | "7d" | "30d" | "custom";

export interface LedgerQuery {
	readonly preset: Preset;
	readonly from?: string;
	readonly to?: string;
	readonly by: Dimension;
	readonly credential?: string;
}

export type LedgerView = LedgerLoaded | LedgerFault;

interface LedgerFault {
	readonly ok: false;
	readonly host: string;
	readonly operator: null;
	readonly fetchedAt: string;
	readonly message: string;
}

interface LedgerLoaded {
	readonly ok: true;
	readonly host: string;
	readonly operator: string | null;
	readonly fetchedAt: string;
	readonly observedAt: string | null;
	readonly range: Range;
	/** A submitted custom range was empty or inverted; the seven-day default was used. */
	readonly customRejected: boolean;
	readonly current: Summary;
	readonly previous: Summary;
	readonly by: Dimension;
	readonly rows: ReadonlyArray<BreakdownRow>;
	readonly credentials: ReadonlyArray<{ name: string; label: string; provider: string }>;
	readonly credential: string | null;
	readonly history: ReadonlyArray<QuotaPoint>;
	readonly error: string | null;
}

const HostLabel = Config.String("GATEWAI_HOST_LABEL").pipe(Config.withDefault("local"));

const PRESET_MS: Record<Exclude<Preset, "custom">, number> = {
	"24h": 24 * 3_600_000,
	"7d": 7 * 86_400_000,
	"30d": 30 * 86_400_000,
};

/** The range to query, and whether a submitted custom range was rejected for the seven-day default. */
export const resolveRange = (
	query: LedgerQuery,
	now: number,
): Range & { readonly customRejected: boolean } => {
	const custom = query.preset === "custom" && Boolean(query.from && query.to);
	if (custom && query.from && query.to) {
		const from = Date.parse(query.from);
		const to = Date.parse(query.to);
		// A date-only `to` means the whole day, so a single calendar day is a valid range.
		const end = query.to.length === 10 ? to + 86_400_000 : to;
		if (Number.isFinite(from) && Number.isFinite(end) && from < end) {
			return {
				from: new Date(from).toISOString(),
				to: new Date(end).toISOString(),
				customRejected: false,
			};
		}
	}
	const span = PRESET_MS[query.preset === "custom" ? "7d" : query.preset];
	return {
		from: new Date(now - span).toISOString(),
		to: new Date(now).toISOString(),
		customRejected: custom,
	};
};

const isQuery = (input: unknown): LedgerQuery => {
	const q = (typeof input === "object" && input !== null ? input : {}) as Record<string, unknown>;
	const preset = (["24h", "7d", "30d", "custom"] as const).find((p) => p === q.preset) ?? "7d";
	const by =
		(["client", "model", "provider", "credential"] as const).find((d) => d === q.by) ?? "client";
	return {
		preset,
		by,
		...(typeof q.from === "string" ? { from: q.from } : {}),
		...(typeof q.to === "string" ? { to: q.to } : {}),
		...(typeof q.credential === "string" ? { credential: q.credential } : {}),
	};
};

export const loadLedger = createServerFn({ method: "GET" })
	.validator(isQuery)
	.handler(({ data }): Promise<LedgerView> =>
		runtime
			.runPromise(
				Effect.gen(function* () {
					const host = yield* HostLabel;
					const fetchedAt = new Date();
					const { customRejected, ...range } = resolveRange(data, fetchedAt.getTime());
					const labels =
						data.by === "client"
							? yield* clientLabels
							: data.by === "credential"
								? yield* credentialLabels
								: new Map<string, string>();
					const credentials = yield* credentialNames;
					const credential = data.credential ?? credentials[0]?.name ?? null;
					const state = yield* readCollectorState;
					return {
						ok: true as const,
						host,
						operator: getRequestHeader("tailscale-user-login") ?? null,
						fetchedAt: fetchedAt.toISOString(),
						observedAt: state.lastSnapshotAt,
						range,
						customRejected,
						current: yield* summary(range),
						previous: yield* summary(previousRange(range)),
						by: data.by,
						rows: yield* breakdown(data.by, range, labels),
						credentials,
						credential,
						history: credential ? yield* quotaHistory(credential, range) : [],
						error: state.lastError,
					};
				}),
			)
			.catch((cause: unknown): LedgerView => {
				console.error("ledger: runtime failed", cause);
				return {
					ok: false,
					host: "unknown",
					operator: null,
					fetchedAt: new Date().toISOString(),
					message: "console failed before reading the ledger",
				};
			}),
	);

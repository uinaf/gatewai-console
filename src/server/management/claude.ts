import { Schema } from "effect";

import type { Credential, Pools } from "#/server/management/credential";
import type { Quota, QuotaWindow, WindowStatus } from "#/server/management/quota";

// Headers only exist after traffic, so an idle Claude credential shows nothing.
// The Management Center asks Anthropic's oauth usage endpoint through `api-call`
// instead; this does the same. Headers mirror that client's oauth identity.
export const CLAUDE_USAGE_URL = "https://api.anthropic.com/api/oauth/usage";
export const CLAUDE_HEADERS: Readonly<Record<string, string>> = {
	Authorization: "Bearer $TOKEN$",
	"Content-Type": "application/json",
	"anthropic-beta": "oauth-2025-04-20",
};

const ClaudeWindow = Schema.Struct({
	utilization: Schema.optional(Schema.Union([Schema.Number, Schema.String])),
	resets_at: Schema.optional(Schema.NullOr(Schema.String)),
});

const ClaudeLimit = Schema.Struct({
	kind: Schema.optional(Schema.NullOr(Schema.String)),
	percent: Schema.optional(Schema.NullOr(Schema.Union([Schema.Number, Schema.String]))),
	resets_at: Schema.optional(Schema.NullOr(Schema.String)),
	is_active: Schema.optional(Schema.NullOr(Schema.Boolean)),
	scope: Schema.optional(
		Schema.NullOr(
			Schema.Struct({
				model: Schema.optional(
					Schema.NullOr(
						Schema.Struct({
							display_name: Schema.optional(Schema.NullOr(Schema.String)),
						}),
					),
				),
			}),
		),
	),
});

const ExtraUsage = Schema.Struct({
	is_enabled: Schema.optional(Schema.Boolean),
	monthly_limit: Schema.optional(Schema.Number),
	used_credits: Schema.optional(Schema.Number),
});

export const ClaudeUsage = Schema.Struct({
	five_hour: Schema.optional(Schema.NullOr(ClaudeWindow)),
	seven_day: Schema.optional(Schema.NullOr(ClaudeWindow)),
	iguana_necktie: Schema.optional(Schema.NullOr(ClaudeWindow)),
	limits: Schema.optional(Schema.NullOr(Schema.Array(Schema.Unknown))),
	extra_usage: Schema.optional(Schema.NullOr(ExtraUsage)),
});
export type ClaudeUsage = typeof ClaudeUsage.Type;

const finite = (value: number | string | null | undefined): number | null => {
	if (value === undefined || value === null) return null;
	const n = typeof value === "string" ? Number(value) : value;
	return Number.isFinite(n) ? n : null;
};

const percent = (value: number): number => Math.min(100, Math.max(0, Math.round(value)));

const iso = (value: string | null | undefined): string | null => {
	if (!value) return null;
	const ms = Date.parse(value);
	return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
};

const status = (used: number): WindowStatus => (used >= 100 ? "limited" : "allowed");

const fromWindow = (
	label: string,
	window: typeof ClaudeWindow.Type | null | undefined,
): QuotaWindow | null => {
	const used = finite(window?.utilization);
	if (used === null) return null;
	const usedPercent = percent(used);
	return {
		label,
		usedPercent,
		resetsAt: iso(window?.resets_at),
		status: status(usedPercent),
	};
};

const decodeLimit = Schema.decodeUnknownOption(ClaudeLimit);

const fableLimit = (usage: ClaudeUsage): QuotaWindow | null => {
	const candidates = (usage.limits ?? []).flatMap((entry) => {
		const limit = decodeLimit(entry);
		if (limit._tag === "None") return [];
		const kind = (limit.value.kind ?? "").trim().toLowerCase();
		const model = (limit.value.scope?.model?.display_name ?? "").trim().toLowerCase();
		const used = finite(limit.value.percent);
		if (kind !== "weekly_scoped" || used === null) return [];
		if (model !== "fable" && model !== "fable 5") return [];
		return [{ limit: limit.value, used, active: limit.value.is_active === true }];
	});
	const chosen = candidates.find((candidate) => candidate.active) ?? candidates[0];
	if (!chosen) return null;
	const usedPercent = percent(chosen.used);
	return {
		label: "weekly fable",
		usedPercent,
		resetsAt: iso(chosen.limit.resets_at),
		status: status(usedPercent),
	};
};

const claudeWindows = (usage: ClaudeUsage | undefined): ReadonlyArray<QuotaWindow> => {
	if (!usage) return [];
	const fable = fableLimit(usage);
	return [
		fromWindow("5-hour", usage.five_hour),
		fromWindow("weekly", usage.seven_day),
		fable ?? fromWindow("weekly fable", usage.iguana_necktie),
	].filter((window): window is QuotaWindow => window !== null);
};

const onDemandOf = (usage: ClaudeUsage | undefined): Quota["onDemand"] => {
	const extra = usage?.extra_usage;
	const cap = extra?.monthly_limit;
	if (!extra?.is_enabled || cap === undefined || !Number.isFinite(cap) || cap <= 0) return null;
	const used = extra.used_credits;
	return {
		usedCents: used !== undefined && Number.isFinite(used) ? Math.max(0, used) : 0,
		capCents: cap,
	};
};

/** Replaces a Claude credential's header-derived windows with the usage read; a missing read keeps them. */
export const withClaudeUsage = (
	pools: Pools,
	usage: ReadonlyMap<string, ClaudeUsage | undefined>,
	observedAt: string,
): Pools => ({
	...pools,
	credentials: pools.credentials.map((credential): Credential => {
		if (credential.provider !== "claude") return credential;
		const read = usage.get(credential.authIndex);
		const windows = claudeWindows(read);
		if (windows.length === 0) return credential;
		return {
			...credential,
			quota: {
				...credential.quota,
				windows,
				onDemand: onDemandOf(read),
				observedAt,
			},
		};
	}),
});

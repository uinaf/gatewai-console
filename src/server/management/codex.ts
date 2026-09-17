import { Schema } from "effect";

import type { Credential, Pools } from "#/server/management/credential";
import type { QuotaWindow, WindowStatus } from "#/server/management/quota";

// The proxy only captures codex rate-limit headers from traffic, so an idle
// credential shows nothing. The Management Center asks the ChatGPT usage
// endpoint through `api-call` instead; this does the same. Headers mirror the
// Management Center's codex-cli identity, plus the account id the proxy
// exposes from the id_token claims.
export const CODEX_USAGE_URL = "https://chatgpt.com/backend-api/wham/usage";
export const codexHeaders = (accountId: string): Readonly<Record<string, string>> => ({
	Authorization: "Bearer $TOKEN$",
	"Content-Type": "application/json",
	"User-Agent": "codex_cli_rs/0.76.0 (Debian 13.0.0; x86_64) WindowsTerminal",
	"Chatgpt-Account-Id": accountId,
});

const Window = Schema.Struct({
	used_percent: Schema.optional(Schema.Number),
	limit_window_seconds: Schema.optional(Schema.Number),
	reset_at: Schema.optional(Schema.Number),
});

const RateLimit = Schema.Struct({
	allowed: Schema.optional(Schema.Boolean),
	limit_reached: Schema.optional(Schema.Boolean),
	primary_window: Schema.optional(Schema.NullOr(Window)),
	secondary_window: Schema.optional(Schema.NullOr(Window)),
});

// Only the account-wide limit; `additional_rate_limits` (per-family tiers such
// as Spark) are dropped, as the header path drops them.
export const CodexUsage = Schema.Struct({
	plan_type: Schema.optional(Schema.String),
	rate_limit: Schema.optional(Schema.NullOr(RateLimit)),
});
export type CodexUsage = typeof CodexUsage.Type;

const label = (seconds: number | undefined): string => {
	if (seconds === 18_000) return "5-hour";
	if (seconds === 604_800) return "weekly";
	if (seconds !== undefined && seconds >= 2_419_200 && seconds <= 2_678_400) return "monthly";
	return seconds ? `${Math.round(seconds / 60)}m` : "window";
};

const status = (used: number, limit: typeof RateLimit.Type): WindowStatus => {
	if (limit.allowed === false) return "rejected";
	return limit.limit_reached === true || used >= 100 ? "limited" : "allowed";
};

const codexWindows = (usage: CodexUsage | undefined): ReadonlyArray<QuotaWindow> => {
	const limit = usage?.rate_limit;
	if (!limit) return [];
	return [limit.primary_window, limit.secondary_window].flatMap((window) => {
		if (!window || window.used_percent === undefined) return [];
		const used = Math.min(100, Math.max(0, Math.round(window.used_percent)));
		return [
			{
				label: label(window.limit_window_seconds),
				usedPercent: used,
				resetsAt: window.reset_at ? new Date(window.reset_at * 1000).toISOString() : null,
				status: status(used, limit),
			},
		];
	});
};

/** Replaces a codex credential's header-derived windows with the usage read; a missing read keeps them. */
export const withCodexUsage = (
	pools: Pools,
	usage: ReadonlyMap<string, CodexUsage | undefined>,
	observedAt: string,
): Pools => ({
	...pools,
	credentials: pools.credentials.map((credential): Credential => {
		if (credential.provider !== "codex") return credential;
		const read = usage.get(credential.authIndex);
		const windows = codexWindows(read);
		if (windows.length === 0) return credential;
		return {
			...credential,
			plan: credential.plan ?? read?.plan_type ?? null,
			quota: { ...credential.quota, windows, observedAt },
		};
	}),
});

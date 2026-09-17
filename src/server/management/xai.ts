import { Schema } from "effect";

import type { Credential, Pools } from "#/server/management/credential";
import type { QuotaWindow } from "#/server/management/quota";

// xAI sends no rate-limit headers, so the proxy captures no quota signals for
// it. The Management Center instead asks the grok billing endpoint through the
// proxy's `api-call`, which substitutes the credential's own token; this does
// the same. Headers mirror the Management Center's grok-cli identity.
export const XAI_BILLING_URL = "https://cli-chat-proxy.grok.com/v1/billing?format=credits";
export const XAI_HEADERS: Readonly<Record<string, string>> = {
	Authorization: "Bearer $TOKEN$",
	"x-xai-token-auth": "xai-grok-cli",
	"x-grok-client-version": "0.2.91",
	accept: "*/*",
	"user-agent": "grok-pager/0.2.91 grok-shell/0.2.91 (macos; aarch64)",
};

const Cents = Schema.Struct({ val: Schema.optional(Schema.Number) });

// Zero-valued fields are omitted upstream (a fresh period carries no
// `creditUsagePercent`), so every field is optional and absence reads as zero.
const XaiBillingConfig = Schema.Struct({
	currentPeriod: Schema.optional(
		Schema.Struct({
			type: Schema.optional(Schema.String),
			start: Schema.optional(Schema.String),
			end: Schema.optional(Schema.String),
		}),
	),
	creditUsagePercent: Schema.optional(Schema.Union([Schema.Number, Schema.String])),
	onDemandCap: Schema.optional(Cents),
	onDemandUsed: Schema.optional(Cents),
});
export type XaiBillingConfig = typeof XaiBillingConfig.Type;

export const XaiBilling = Schema.Struct({ config: Schema.optional(XaiBillingConfig) });

const percent = (value: number | string | undefined): number => {
	const n = typeof value === "string" ? Number(value) : value;
	return n === undefined || !Number.isFinite(n) ? 0 : Math.min(100, Math.max(0, Math.round(n)));
};

/** The weekly window from a billing config; null when the payload carries no period. */
const xaiWindows = (config: XaiBillingConfig | undefined): ReadonlyArray<QuotaWindow> => {
	if (!config?.currentPeriod) return [];
	const used = percent(config.creditUsagePercent);
	const end = config.currentPeriod.end;
	return [
		{
			label: config.currentPeriod.type === "USAGE_PERIOD_TYPE_WEEKLY" ? "weekly" : "period",
			usedPercent: used,
			resetsAt: end && Number.isFinite(Date.parse(end)) ? new Date(end).toISOString() : null,
			status: used >= 100 ? "limited" : "allowed",
		},
	];
};

export const withXaiBilling = (
	pools: Pools,
	billing: ReadonlyMap<string, XaiBillingConfig | undefined>,
	observedAt: string,
): Pools => ({
	...pools,
	credentials: pools.credentials.map((credential): Credential => {
		if (credential.provider !== "xai" || !billing.has(credential.authIndex)) return credential;
		const windows = xaiWindows(billing.get(credential.authIndex));
		return {
			...credential,
			quota: { ...credential.quota, windows, observedAt: windows.length > 0 ? observedAt : null },
		};
	}),
});

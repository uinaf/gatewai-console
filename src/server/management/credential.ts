import { type Quota, quotaOf } from "#/server/management/quota";
import type { AuthFile, AuthFiles } from "#/server/management/schema";

// The shape the UI renders. Nothing in here comes straight from a header.

type CredentialStatus = "active" | "cooling" | "disabled" | "error";

interface Cooldown {
	readonly scope: string | null;
	readonly model: string | null;
	readonly reason: string | null;
	readonly until: string | null;
}

export interface Credential {
	readonly name: string;
	readonly authIndex: string;
	readonly provider: string;
	readonly label: string;
	readonly plan: string | null;
	readonly status: CredentialStatus;
	readonly statusMessage: string | null;
	readonly cooldowns: ReadonlyArray<Cooldown>;
	readonly success: number;
	readonly failed: number;
	readonly lastRefresh: string | null;
	readonly recentRequests: ReadonlyArray<{ time: string; success: number; failed: number }>;
	readonly websockets: boolean | null;
	readonly quota: Quota;
}

export interface Pools {
	readonly observedAt: string | null;
	readonly credentials: ReadonlyArray<Credential>;
}

const statusOf = (file: AuthFile, cooldowns: ReadonlyArray<Cooldown>): CredentialStatus => {
	if (file.disabled) return "disabled";
	if (cooldowns.length > 0) return "cooling";
	if (file.unavailable || file.status !== "active") return "error";
	return "active";
};

export const credentialOf = (file: AuthFile): Credential => {
	const cooldowns = (file.cooldowns ?? []).map((cooldown) => ({
		scope: cooldown.scope ?? null,
		model: cooldown.model_key ?? null,
		reason: cooldown.reason ?? null,
		until: cooldown.retry_at ?? null,
	}));
	const quota = quotaOf(file);
	return {
		name: file.name,
		authIndex: file.auth_index,
		provider: file.provider,
		label: file.label ?? file.email ?? file.name,
		plan: quota.plan ?? (file.account_type === "oauth" ? null : (file.account_type ?? null)),
		status: statusOf(file, cooldowns),
		statusMessage: file.status_message || null,
		cooldowns,
		success: file.success ?? 0,
		failed: file.failed ?? 0,
		lastRefresh: file.last_refresh ?? null,
		recentRequests: file.recent_requests ?? [],
		websockets: file.websockets ?? null,
		quota,
	};
};

export const poolsOf = (response: AuthFiles): Pools => ({
	observedAt: response.observed_at ?? null,
	credentials: response.files.map(credentialOf),
});

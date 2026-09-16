import type { AuthFile } from "#/server/management/schema";

// Folds raw provider rate-limit headers into windows so nothing downstream
// parses headers. Anthropic: Unified-{5h,7d,7d_oi}. Codex: Primary/Secondary
// on the top level and per named family (`Additional-<Name>`, `Bengalfox`).
// xAI sends none.

type WindowStatus = "allowed" | "limited" | "rejected" | "unknown";

interface QuotaWindow {
	readonly label: string;
	readonly usedPercent: number;
	readonly resetsAt: string | null;
	readonly status: WindowStatus;
}

export interface Quota {
	readonly observedAt: string | null;
	readonly windows: ReadonlyArray<QuotaWindow>;
	readonly credits: { readonly balance: number; readonly unlimited: boolean } | null;
	readonly plan: string | null;
	readonly overage: "allowed" | "rejected" | null;
}

type Signals = Readonly<Record<string, string>>;

const epochToIso = (value: string | undefined): string | null => {
	const seconds = Number(value);
	return Number.isFinite(seconds) && seconds > 0 ? new Date(seconds * 1000).toISOString() : null;
};

// Signals are strings on the wire; a blank or non-numeric value is not a zero.
const finite = (value: string | undefined): number | null => {
	if (value === undefined || value.trim() === "") return null;
	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : null;
};

const percent = (value: number): number => Math.min(100, Math.max(0, Math.round(value)));

const statusOf = (value: string | undefined, limitReached?: string): WindowStatus => {
	if (limitReached === "true") return "limited";
	if (value === "allowed" || value === "rejected") return value;
	if (value === "allowed_warning") return "allowed";
	return value === undefined ? "unknown" : "limited";
};

const windowLabel = (minutes: string | undefined): string | null => {
	switch (minutes) {
		case "300":
			return "5-hour";
		case "10080":
			return "weekly";
		default:
			return minutes ? `${minutes}m` : null;
	}
};

const anthropicWindows = (signals: Signals): ReadonlyArray<QuotaWindow> => {
	const spans: ReadonlyArray<readonly [string, string]> = [
		["5h", "5-hour"],
		["7d", "weekly"],
		["7d_oi", "weekly opus"],
	];
	return spans.flatMap(([span, label]) => {
		const utilization = finite(signals[`Anthropic-Ratelimit-Unified-${span}-Utilization`]);
		if (utilization === null) return [];
		return [
			{
				label,
				usedPercent: percent(utilization * 100),
				resetsAt: epochToIso(signals[`Anthropic-Ratelimit-Unified-${span}-Reset`]),
				status: statusOf(signals[`Anthropic-Ratelimit-Unified-${span}-Status`]),
			},
		];
	});
};

// `X-Codex-Primary-*` and `X-Codex-<Family>-Primary-*` share one shape.
const codexFamily = (
	signals: Signals,
	prefix: string,
	limitName: string | null,
	limitReached: string | undefined,
): ReadonlyArray<QuotaWindow> =>
	(["Primary", "Secondary"] as const).flatMap((tier) => {
		const used = finite(signals[`${prefix}${tier}-Used-Percent`]);
		const minutes = signals[`${prefix}${tier}-Window-Minutes`];
		// A zero-minute window is a placeholder tier the upstream sends on some models.
		if (used === null || minutes === "0") return [];
		const span = windowLabel(minutes);
		const label = limitName
			? span
				? `${limitName} ${span}`
				: limitName
			: (span ?? tier.toLowerCase());
		return [
			{
				label,
				usedPercent: percent(used),
				resetsAt: epochToIso(signals[`${prefix}${tier}-Reset-At`]),
				status: limitReached === "true" || used >= 100 ? "limited" : "allowed",
			},
		];
	});

const codexWindows = (signals: Signals): ReadonlyArray<QuotaWindow> => {
	const top = codexFamily(signals, "X-Codex-", null, signals["X-Codex-Limit-Reached"]);
	const families = new Set<string>();
	for (const key of Object.keys(signals)) {
		const match = /^X-Codex-(.+)-Primary-Used-Percent$/.exec(key);
		if (match?.[1] && match[1] !== "Primary") families.add(match[1]);
	}
	const named = [...families].flatMap((family) => {
		const prefix = `X-Codex-${family}-`;
		const name = signals[`${prefix}Limit-Name`] ?? family.replace(/^Additional-/, "");
		return codexFamily(signals, prefix, name.toLowerCase(), signals[`${prefix}Limit-Reached`]);
	});
	return [...top, ...named];
};

const windowsOf = (provider: string, signals: Signals): ReadonlyArray<QuotaWindow> => {
	switch (provider) {
		case "claude":
			return anthropicWindows(signals);
		case "codex":
			return codexWindows(signals);
		default:
			return [];
	}
};

const boolean = (value: string | undefined): boolean => value?.toLowerCase() === "true";

/** Merges the credential-level snapshot with every per-model snapshot; the latest observation per label wins. */
export const quotaOf = (file: AuthFile): Quota => {
	const snapshots = [file.quota, ...Object.values(file.model_quotas ?? {})].filter(
		(snapshot) => snapshot?.signals !== undefined,
	);
	// Offsets differ between snapshots (`+08:00` on the host, `Z` upstream), so
	// order by instant, not by string.
	const instant = (value: string | undefined) => (value ? Date.parse(value) : Number.NaN);
	const ordered = [...snapshots].sort((a, b) => {
		const left = instant(a?.observed_at);
		const right = instant(b?.observed_at);
		return (Number.isNaN(left) ? -Infinity : left) - (Number.isNaN(right) ? -Infinity : right);
	});
	const windows = new Map<string, QuotaWindow>();
	let observedAt: string | null = null;
	let credits: Quota["credits"] = null;
	let plan: string | null = null;
	let overage: Quota["overage"] = null;
	for (const snapshot of ordered) {
		const signals = snapshot?.signals ?? {};
		for (const window of windowsOf(file.provider, signals)) windows.set(window.label, window);
		if (snapshot?.observed_at) observedAt = snapshot.observed_at;
		const balance = signals["X-Codex-Credits-Balance"];
		if (balance !== undefined) {
			credits = {
				balance: Number(balance),
				unlimited: boolean(signals["X-Codex-Credits-Unlimited"]),
			};
		}
		plan = signals["X-Codex-Plan-Type"] ?? plan;
		const overageStatus = signals["Anthropic-Ratelimit-Unified-Overage-Status"];
		if (overageStatus === "allowed" || overageStatus === "rejected") overage = overageStatus;
	}
	return { observedAt, windows: [...windows.values()], credits, plan, overage };
};

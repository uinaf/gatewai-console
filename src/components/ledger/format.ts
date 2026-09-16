export const count = (n: number): string => n.toLocaleString("en-US");

/** 42.7M, 912K, 512 */
export const compact = (n: number): string => {
	if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
	if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
	if (n >= 1e4) return `${Math.round(n / 1e3)}K`;
	if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
	return String(n);
};

export const percent = (ratio: number, digits = 1): string => `${(ratio * 100).toFixed(digits)}%`;

/** 9.4s, 720ms, or a dash. */
export const millis = (ms: number | null): string => {
	if (ms === null) return "—";
	return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms)}ms`;
};

/** "↑ 23%", "↓ 6%", "new", or "" when both are zero. */
export const delta = (current: number, previous: number): string => {
	if (previous === 0) return current === 0 ? "" : "new";
	const change = (current - previous) / previous;
	if (Math.abs(change) < 0.005) return "→ 0%";
	return `${change > 0 ? "↑" : "↓"} ${Math.round(Math.abs(change) * 100)}%`;
};

/** Points delta for rates: "↑ 0.4pt". */
export const pointsDelta = (current: number, previous: number): string => {
	const diff = (current - previous) * 100;
	if (Math.abs(diff) < 0.05) return "→ 0pt";
	return `${diff > 0 ? "↑" : "↓"} ${Math.abs(diff).toFixed(1)}pt`;
};

const DAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
export const dayTick = (iso: string): string => {
	const date = new Date(iso);
	return `${DAYS[date.getUTCDay()]} ${String(date.getUTCDate()).padStart(2, "0")}`;
};
export const hourTick = (iso: string): string => {
	const date = new Date(iso);
	return `${String(date.getUTCHours()).padStart(2, "0")}:00`;
};

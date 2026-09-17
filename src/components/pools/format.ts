const pad = (n: number) => String(n).padStart(2, "0");

/** "in 41m", "in 1h 12m", "in 2d 21h", or "now" once passed. */
export const resetsIn = (iso: string | null, now: number): string => {
	if (!iso) return "";
	const ms = Date.parse(iso) - now;
	if (!Number.isFinite(ms)) return "";
	if (ms <= 0) return "now";
	const minutes = Math.floor(ms / 60_000);
	const hours = Math.floor(minutes / 60);
	const days = Math.floor(hours / 24);
	if (days > 0) return `in ${days}d ${pad(hours % 24)}h`;
	if (hours > 0) return `in ${hours}h ${pad(minutes % 60)}m`;
	return `in ${Math.max(1, minutes)}m`;
};

/** "12 s ago", "4m 12s ago", "2h ago". */
export const ago = (iso: string | null, now: number): string => {
	if (!iso) return "never";
	const seconds = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
	if (!Number.isFinite(seconds)) return "never";
	if (seconds < 60) return `${seconds} s ago`;
	const minutes = Math.floor(seconds / 60);
	if (minutes < 60) return `${minutes}m ${pad(seconds % 60)}s ago`;
	return `${Math.floor(minutes / 60)}h ago`;
};

export const credits = (value: number) => value.toFixed(2);

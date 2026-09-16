const pad = (n: number) => String(n).padStart(2, "0");
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/** "16 sep 09:12" in UTC, so server and client render the same text. */
export const stamp = (iso: string | null): string => {
	if (!iso) return "never";
	const d = new Date(iso);
	if (Number.isNaN(d.getTime())) return "never";
	return `${pad(d.getUTCDate())} ${MONTHS[d.getUTCMonth()]} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
};

/** "3h 27m", "2d 09h", "8m". */
export const span = (fromIso: string, toIso: string): string => {
	const minutes = Math.max(0, Math.round((Date.parse(toIso) - Date.parse(fromIso)) / 60_000));
	const hours = Math.floor(minutes / 60);
	const days = Math.floor(hours / 24);
	if (days > 0) return `${days}d ${pad(hours % 24)}h`;
	if (hours > 0) return `${hours}h ${pad(minutes % 60)}m`;
	return `${minutes}m`;
};

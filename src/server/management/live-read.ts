// Shared freshness for every provider usage read through `api-call`.
// Success is reused for a few minutes. 429s keep the last good value and
// back off exponentially so collector + pools polls cannot stampede.

export const SUCCESS_TTL_MS = 5 * 60 * 1000;
export const BACKOFF_BASE_MS = 60 * 1000;
export const BACKOFF_CAP_MS = 30 * 60 * 1000;

export type LiveEvent = "ok" | "limited" | "miss";

export interface LiveSlot<A> {
	readonly value: A | undefined;
	readonly until: number;
	readonly strikes: number;
}

export const backoffMs = (strikes: number): number => {
	const n = Math.max(1, Math.min(8, Math.trunc(strikes)));
	return Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * 2 ** (n - 1));
};

export const isFresh = <A>(slot: LiveSlot<A> | undefined, now: number): slot is LiveSlot<A> =>
	slot !== undefined && now < slot.until;

/** Parse RFC 9110 Retry-After (delta-seconds or HTTP-date). */
export const retryAfterMs = (raw: string | undefined, now: number): number | undefined => {
	if (!raw) return undefined;
	const trimmed = raw.trim();
	if (trimmed === "") return undefined;
	const seconds = Number(trimmed);
	if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1000);
	const at = Date.parse(trimmed);
	return Number.isFinite(at) ? Math.max(0, at - now) : undefined;
};

export const headerValue = (header: unknown, name: string): string | undefined => {
	if (header === null || header === undefined || typeof header !== "object") return undefined;
	const want = name.toLowerCase();
	for (const [key, value] of Object.entries(header as Record<string, unknown>)) {
		if (key.toLowerCase() !== want) continue;
		if (typeof value === "string") return value;
		if (Array.isArray(value) && typeof value[0] === "string") return value[0];
		return undefined;
	}
	return undefined;
};

export const remember = <A>(
	now: number,
	prev: LiveSlot<A> | undefined,
	event: LiveEvent,
	value: A | undefined,
	retryAfter?: number,
): LiveSlot<A> => {
	if (event === "ok") {
		return { value, until: now + SUCCESS_TTL_MS, strikes: 0 };
	}
	if (event === "limited") {
		const strikes = Math.min((prev?.strikes ?? 0) + 1, 8);
		const fromHeader = retryAfter !== undefined && retryAfter > 0 ? retryAfter : undefined;
		const wait = Math.min(BACKOFF_CAP_MS, fromHeader ?? backoffMs(strikes));
		return {
			value: prev?.value ?? value,
			until: now + wait,
			strikes,
		};
	}
	return { value: prev?.value, until: now, strikes: prev?.strikes ?? 0 };
};

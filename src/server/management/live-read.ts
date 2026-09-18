// Shared freshness for every provider usage read through `api-call`.
// Success is reused for a few minutes. 429s keep the last good value and
// back off exponentially so collector + pools polls cannot stampede.

export const SUCCESS_TTL_MS = 5 * 60 * 1000;
export const BACKOFF_BASE_MS = 60 * 1000;
export const BACKOFF_CAP_MS = 15 * 60 * 1000;

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

export const remember = <A>(
	now: number,
	prev: LiveSlot<A> | undefined,
	event: LiveEvent,
	value: A | undefined,
): LiveSlot<A> => {
	if (event === "ok") {
		return { value, until: now + SUCCESS_TTL_MS, strikes: 0 };
	}
	if (event === "limited") {
		const strikes = Math.min((prev?.strikes ?? 0) + 1, 8);
		return {
			value: prev?.value ?? value,
			until: now + backoffMs(strikes),
			strikes,
		};
	}
	return { value: prev?.value, until: now, strikes: prev?.strikes ?? 0 };
};

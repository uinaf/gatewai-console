import type { QuotaPoint } from "#/server/ledger/queries";

// Burn-rate extrapolation for one quota window: how long until used hits 100
// at the recent pace. Pure; the caller passes the points, the clock, and the
// window's reset time. Spike 015 decides whether this ever reaches a screen.

export interface Runway {
	/** When used reaches 100 at the current rate; null when the reset comes first. */
	readonly etaAt: string | null;
	readonly ratePerHour: number;
	/** "low" on a short or sparse sample: under 6 h of points or fewer than 4 of them. */
	readonly confidence: "low" | "ok";
}

const HOUR_MS = 3_600_000;
const RATE_WINDOW_MS = 24 * HOUR_MS;
const MIN_SPAN_MS = 2 * HOUR_MS;

/**
 * Points are one window's observations in time order. The sample starts at the
 * last reset (or the first point); it needs two points spanning two hours. The
 * rate is the rise over the last 24 h up to `now`, so a window nobody touched
 * since morning burns slower, not at yesterday's pace. Null when nothing can be
 * said: too few points, no rise.
 */
export const estimateRunway = (
	points: ReadonlyArray<QuotaPoint>,
	now: string,
	resetsAt: string | null,
): Runway | null => {
	let lastReset = points.length - 1;
	while (lastReset >= 0 && !points[lastReset]?.reset) lastReset -= 1;
	const segment = lastReset < 0 ? points : points.slice(lastReset);
	const first = segment[0];
	const last = segment.at(-1);
	if (segment.length < 2 || !first || !last) return null;
	const nowMs = Date.parse(now);
	const firstMs = Date.parse(first.at);
	const lastMs = Date.parse(last.at);
	if (lastMs - firstMs < MIN_SPAN_MS || nowMs <= firstMs) return null;
	// Used is a step function: the value at the window start is the last point at or before it.
	const windowStart = Math.max(firstMs, nowMs - RATE_WINDOW_MS);
	const usedAtStart =
		segment.filter((p) => Date.parse(p.at) <= windowStart).at(-1)?.usedPercent ?? first.usedPercent;
	const ratePerHour = ((last.usedPercent - usedAtStart) * HOUR_MS) / (nowMs - windowStart);
	if (ratePerHour <= 0) return null;
	const etaMs = nowMs + ((100 - last.usedPercent) / ratePerHour) * HOUR_MS;
	const survives = resetsAt !== null && etaMs > Date.parse(resetsAt);
	return {
		etaAt: survives ? null : new Date(etaMs).toISOString(),
		ratePerHour,
		confidence: lastMs - firstMs < 6 * HOUR_MS || segment.length < 4 ? "low" : "ok",
	};
};

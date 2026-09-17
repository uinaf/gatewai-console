import { expect, test } from "vitest";

import type { QuotaPoint } from "#/server/ledger/queries";
import { estimateRunway } from "#/server/ledger/runway";

const T0 = Date.parse("2026-09-15T00:00:00.000Z");
const at = (hours: number) => new Date(T0 + hours * 3_600_000).toISOString();
const point = (hours: number, usedPercent: number, reset = false): QuotaPoint => ({
	at: at(hours),
	label: "weekly",
	usedPercent,
	reset,
});

test("a linear drain extrapolates to 100 at the same rate", () => {
	const points = [point(0, 10), point(2, 20), point(4, 30), point(6, 40), point(8, 50)];
	const runway = estimateRunway(points, at(8), at(48));
	expect(runway).toEqual({ etaAt: at(18), ratePerHour: 5, confidence: "ok" });
});

test("the sample restarts at the last reset", () => {
	const points = [point(0, 60), point(4, 90), point(5, 0, true), point(7, 10), point(9, 20)];
	const runway = estimateRunway(points, at(9), null);
	// 20 points over 4 h since the reset, not 40 over 9 h.
	expect(runway).toMatchObject({ ratePerHour: 5, etaAt: at(25), confidence: "low" });
});

test("a flat or falling window has no runway", () => {
	expect(estimateRunway([point(0, 40), point(3, 40)], at(3), null)).toBeNull();
	expect(estimateRunway([point(0, 40), point(3, 30)], at(3), null)).toBeNull();
});

test("too few points or too little span yields nothing", () => {
	expect(estimateRunway([point(0, 40)], at(5), null)).toBeNull();
	expect(estimateRunway([point(0, 40), point(1, 50)], at(1), null)).toBeNull();
	expect(estimateRunway([], at(5), null)).toBeNull();
});

test("an eta after the reset means the window survives: no eta, rate kept", () => {
	const points = [point(0, 10), point(2, 12), point(4, 14)];
	const runway = estimateRunway(points, at(4), at(10));
	expect(runway).toEqual({ etaAt: null, ratePerHour: 1, confidence: "low" });
});

test("the rate reads the last 24 h up to now, so a quiet stretch slows it", () => {
	const points = [point(0, 0), point(10, 50)];
	// Busy morning, then nothing for 20 h: 50 points over 30 h, not over 10.
	const quiet = estimateRunway(points, at(30), null);
	expect(quiet?.ratePerHour).toBeCloseTo(50 / 24);
	// Two days on: the 24 h window starts after the last point, so the rise inside it is zero.
	expect(estimateRunway(points, at(48), null)).toBeNull();
});

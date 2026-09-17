import { expect, test } from "vitest";

import { resolveRange } from "#/functions/ledger";

const now = Date.parse("2026-09-16T12:00:00Z");

test("a single calendar day is a valid custom range covering the whole day", () => {
	expect(
		resolveRange({ preset: "custom", by: "client", from: "2026-09-10", to: "2026-09-10" }, now),
	).toEqual({
		from: "2026-09-10T00:00:00.000Z",
		to: "2026-09-11T00:00:00.000Z",
		customRejected: false,
	});
});

test("an inverted or unparsable custom range falls back to the 7d preset", () => {
	const rejected = resolveRange(
		{ preset: "custom", by: "client", from: "2026-09-12", to: "2026-09-10" },
		now,
	);
	expect(rejected.customRejected).toBe(true);
	expect(
		resolveRange({ preset: "custom", by: "client", from: "", to: "" }, now).customRejected,
	).toBe(true);
	expect(resolveRange({ preset: "custom", by: "client" }, now).customRejected).toBe(false);
	const fallback = resolveRange({ preset: "7d", by: "client" }, now);
	expect(fallback.customRejected).toBe(false);
	expect(rejected).toEqual({ ...fallback, customRejected: true });
	expect(resolveRange({ preset: "custom", by: "client", from: "x", to: "y" }, now)).toEqual({
		...fallback,
		customRejected: true,
	});
});

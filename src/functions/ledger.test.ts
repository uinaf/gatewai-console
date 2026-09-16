import { expect, test } from "vitest";

import { resolveRange } from "#/functions/ledger";

const now = Date.parse("2026-09-16T12:00:00Z");

test("a single calendar day is a valid custom range covering the whole day", () => {
	expect(
		resolveRange({ preset: "custom", by: "client", from: "2026-09-10", to: "2026-09-10" }, now),
	).toEqual({
		from: "2026-09-10T00:00:00.000Z",
		to: "2026-09-11T00:00:00.000Z",
	});
});

test("an inverted or unparsable custom range falls back to the 7d preset", () => {
	const fallback = resolveRange({ preset: "7d", by: "client" }, now);
	expect(
		resolveRange({ preset: "custom", by: "client", from: "2026-09-12", to: "2026-09-10" }, now),
	).toEqual(fallback);
	expect(resolveRange({ preset: "custom", by: "client", from: "x", to: "y" }, now)).toEqual(
		fallback,
	);
});

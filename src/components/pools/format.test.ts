import { expect, test } from "vitest";

import { ago, resetsIn } from "#/components/pools/format";

const now = Date.parse("2026-09-16T12:00:00Z");
const at = (offsetMs: number) => new Date(now + offsetMs).toISOString();

test("resetsIn picks the coarsest useful unit", () => {
	expect(resetsIn(at(41 * 60_000), now)).toBe("in 41m");
	expect(resetsIn(at((60 + 12) * 60_000), now)).toBe("in 1h 12m");
	expect(resetsIn(at((2 * 24 + 21) * 3_600_000), now)).toBe("in 2d 21h");
	expect(resetsIn(at(-1), now)).toBe("now");
	expect(resetsIn(null, now)).toBe("");
});

test("ago reads like the topbar stamp", () => {
	expect(ago(at(-12_000), now)).toBe("12 s ago");
	expect(ago(at(-(4 * 60 + 12) * 1000), now)).toBe("4m 12s ago");
	expect(ago(at(-2 * 3_600_000), now)).toBe("2h ago");
	expect(ago(null, now)).toBe("never");
});

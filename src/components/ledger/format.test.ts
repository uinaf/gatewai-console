import { expect, test } from "vitest";

import { compact, count } from "#/components/ledger/format";

test("compact keeps three significant digits and one unit", () => {
	expect(compact(512)).toBe("512");
	expect(compact(9_800)).toBe("9.8K");
	expect(compact(12_345)).toBe("12K");
	expect(compact(1_234_567)).toBe("1.2M");
	expect(compact(2_500_000_000)).toBe("2.5B");
});

test("count keeps the exact figure for the tooltip", () => {
	expect(count(1_234_567)).toBe("1,234,567");
});

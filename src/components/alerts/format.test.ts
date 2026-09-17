import { expect, test } from "vitest";

import { span, stamp } from "#/components/alerts/format";

test("stamp is UTC with a z suffix and a weekday", () => {
	expect(stamp("2026-09-19T08:00:00Z")).toBe("sat 19 sep 08:00z");
	expect(stamp("2026-09-19T08:00:00+03:00")).toBe("sat 19 sep 05:00z");
	expect(stamp(null)).toBe("never");
	expect(stamp("nope")).toBe("never");
});

test("span is relative", () => {
	expect(span("2026-09-19T08:00:00Z", "2026-09-19T11:27:00Z")).toBe("3h 27m");
});

import { expect, test } from "vitest";

import { pageWindow } from "#/routes/alerts";

test("pageWindow keeps the ends and two pages either side of the current one", () => {
	expect(pageWindow(1, 3)).toEqual([1, 2, 3]);
	expect(pageWindow(10, 30)).toEqual([1, null, 8, 9, 10, 11, 12, null, 30]);
	expect(pageWindow(2, 5)).toEqual([1, 2, 3, 4, 5]);
});

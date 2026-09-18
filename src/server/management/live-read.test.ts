import { expect, test } from "vitest";

import {
	BACKOFF_BASE_MS,
	BACKOFF_CAP_MS,
	SUCCESS_TTL_MS,
	backoffMs,
	isFresh,
	remember,
} from "#/server/management/live-read";

const now = 1_000_000;

test("success is reused for the ttl and clears strikes", () => {
	const slot = remember(now, remember(0, undefined, "limited", undefined), "ok", 12);
	expect(slot).toEqual({ value: 12, until: now + SUCCESS_TTL_MS, strikes: 0 });
	expect(isFresh(slot, now + SUCCESS_TTL_MS - 1)).toBe(true);
	expect(isFresh(slot, now + SUCCESS_TTL_MS)).toBe(false);
});

test("429s keep the last value and double the wait up to the cap", () => {
	const first = remember(now, undefined, "limited", undefined);
	expect(first).toEqual({ value: undefined, until: now + BACKOFF_BASE_MS, strikes: 1 });
	expect(backoffMs(1)).toBe(BACKOFF_BASE_MS);

	const held = remember(now, { value: 7, until: 0, strikes: 0 }, "limited", undefined);
	expect(held.value).toBe(7);
	expect(held.strikes).toBe(1);
	expect(held.until).toBe(now + BACKOFF_BASE_MS);

	const second = remember(now, held, "limited", undefined);
	expect(second.strikes).toBe(2);
	expect(second.until).toBe(now + BACKOFF_BASE_MS * 2);
	expect(second.value).toBe(7);

	expect(backoffMs(8)).toBe(BACKOFF_CAP_MS);
	const capped = remember(now, { value: 7, until: 0, strikes: 8 }, "limited", undefined);
	expect(capped.strikes).toBe(8);
	expect(capped.until).toBe(now + BACKOFF_CAP_MS);
});

test("a miss does not freeze the slot, so the next poll retries", () => {
	const prev = remember(now, undefined, "ok", 3);
	const missed = remember(now + 1, prev, "miss", undefined);
	expect(missed.value).toBe(3);
	expect(isFresh(missed, now + 1)).toBe(false);
	expect(missed.strikes).toBe(0);
});

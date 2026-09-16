import { Schema } from "effect";
import { expect, test } from "vitest";

import {
	poolsOf,
	primaryWindow,
	requestsLastHour,
	summarize,
} from "#/server/management/credential";
import fixture from "#/server/management/fixtures/auth-files.json";
import { AuthFiles } from "#/server/management/schema";

const { credentials } = poolsOf(Schema.decodeUnknownSync(AuthFiles)(fixture));

test("the stat strip summarises per provider without faking xai", () => {
	const byProvider = Object.fromEntries(summarize(credentials).map((s) => [s.provider, s]));
	expect(byProvider.codex).toMatchObject({ accounts: 2, cooling: 0, plan: "pro", unreported: 0 });
	expect(byProvider.codex?.remainingPercent).toBe(Math.round((11 + 23) / 2));
	expect(byProvider.claude).toMatchObject({ accounts: 3, cooling: 1, plan: null });
	expect(byProvider.xai).toMatchObject({ accounts: 2, remainingPercent: null, unreported: 2 });
});

test("the primary window is weekly, and last-hour requests sum six buckets", () => {
	const codex = credentials.find((c) => c.name === "codex-two@example.com.json");
	if (!codex) throw new Error("fixture missing codex");
	expect(primaryWindow(codex)?.label).toBe("weekly");
	expect(requestsLastHour(codex)).toBe(
		codex.recentRequests.slice(-6).reduce((n, b) => n + b.success + b.failed, 0),
	);
});

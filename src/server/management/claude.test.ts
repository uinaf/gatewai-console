import { Schema } from "effect";
import { expect, test } from "vitest";

import { withClaudeUsage } from "#/server/management/claude";
import { credentialOf } from "#/server/management/credential";
import fixture from "#/server/management/fixtures/auth-files.json";
import { AuthFiles } from "#/server/management/schema";

const files = Schema.decodeUnknownSync(AuthFiles)(fixture);
const byName = (name: string) => {
	const file = files.files.find((file) => file.name === name);
	if (!file) throw new Error(`fixture missing ${name}`);
	return credentialOf(file);
};

const observedAt = "2026-09-18T09:00:00.000Z";

test("live usage replaces header windows and prefers the active fable limit", () => {
	const credential = byName("claude-one@example.com.json");
	const next = withClaudeUsage(
		{ observedAt: null, credentials: [credential] },
		new Map([
			[
				credential.authIndex,
				{
					five_hour: { utilization: 12, resets_at: "2026-09-18T14:00:00+00:00" },
					seven_day: { utilization: "40", resets_at: "2026-09-22T08:00:00Z" },
					iguana_necktie: { utilization: 9, resets_at: "2026-09-21T00:00:00Z" },
					limits: [
						{
							kind: "weekly_scoped",
							percent: 3,
							is_active: false,
							resets_at: "2026-09-21T00:00:00Z",
							scope: { model: { display_name: "Fable" } },
						},
						{
							kind: "weekly_scoped",
							percent: 88,
							is_active: true,
							resets_at: "2026-09-22T08:00:00Z",
							scope: { model: { display_name: "Fable 5" } },
						},
					],
				},
			],
		]),
		observedAt,
	);
	expect(next.credentials[0]?.quota).toMatchObject({
		observedAt,
		windows: [
			{ label: "5-hour", usedPercent: 12, resetsAt: "2026-09-18T14:00:00.000Z", status: "allowed" },
			{ label: "weekly", usedPercent: 40, resetsAt: "2026-09-22T08:00:00.000Z", status: "allowed" },
			{
				label: "weekly fable",
				usedPercent: 88,
				resetsAt: "2026-09-22T08:00:00.000Z",
				status: "allowed",
			},
		],
	});
});

test("a missing or empty live read keeps the header windows", () => {
	const credential = byName("claude-two@example.com.json");
	const headers = credential.quota.windows;
	const empty = withClaudeUsage(
		{ observedAt: null, credentials: [credential] },
		new Map([[credential.authIndex, { five_hour: { utilization: "n/a" } }]]),
		observedAt,
	);
	const missing = withClaudeUsage(
		{ observedAt: null, credentials: [credential] },
		new Map(),
		observedAt,
	);
	expect(empty.credentials[0]?.quota.windows).toEqual(headers);
	expect(missing.credentials[0]?.quota.windows).toEqual(headers);
});

test("the legacy fable field is used when limits do not name fable", () => {
	const credential = byName("claude-one@example.com.json");
	const next = withClaudeUsage(
		{ observedAt: null, credentials: [credential] },
		new Map([
			[
				credential.authIndex,
				{
					iguana_necktie: { utilization: 100, resets_at: "2026-09-22T08:00:00Z" },
					limits: [
						{
							kind: "weekly_scoped",
							percent: 12,
							is_active: true,
							scope: { model: { display_name: "Sonnet" } },
						},
					],
				},
			],
		]),
		observedAt,
	);
	expect(next.credentials[0]?.quota.windows).toEqual([
		{
			label: "weekly fable",
			usedPercent: 100,
			resetsAt: "2026-09-22T08:00:00.000Z",
			status: "limited",
		},
	]);
});

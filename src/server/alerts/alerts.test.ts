import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ConfigProvider, Effect, Layer, Schema } from "effect";
import { HttpClient, HttpClientResponse } from "effect/unstable/http";
import { SqlClient } from "effect/unstable/sql";
import { expect, test } from "vitest";

import { evaluate } from "#/server/alerts/evaluate";
import { runAlerts } from "#/server/alerts/run";
import { listIncidents, readStates } from "#/server/alerts/store";
import { Database } from "#/server/database";
import { writeCollectorState } from "#/server/ledger/store";
import { type Credential, poolsOf } from "#/server/management/credential";
import authFiles from "#/server/management/fixtures/auth-files.json";
import { AuthFiles } from "#/server/management/schema";

const pools = poolsOf(Schema.decodeUnknownSync(AuthFiles)(authFiles));
const codex = pools.credentials.find((c) => c.name === "codex-altay@uinaf.dev.json");
if (!codex) throw new Error("fixture missing codex");

const withWeekly = (credential: Credential, usedPercent: number): Credential => ({
	...credential,
	quota: {
		...credential.quota,
		windows: credential.quota.windows.map((w) =>
			w.label === "weekly" ? { ...w, usedPercent } : w,
		),
	},
});

const rule = {
	id: "codex-weekly-low",
	kind: "remaining" as const,
	scope: "provider:codex",
	window: "weekly",
	remainingBelow: 10,
};

test("a threshold rule fires once at the crossing, ignores jitter, and clears on reset", () => {
	const at = (used: number, firing: boolean) =>
		evaluate(
			[rule],
			{
				credentials: [withWeekly(codex, used)],
				lastPopAt: null,
				startedAt: null,
				now: "2026-09-16T00:00:00Z",
			},
			() => firing,
		).find((r) => r.condition.subject === codex.name)?.firing;
	expect(at(85, false)).toBe(false); // remaining 15
	expect(at(91, false)).toBe(true); // crosses: remaining 9
	expect(at(89, true)).toBe(true); // jitter back to 11: still firing (margin 5)
	expect(at(84, true)).toBe(false); // remaining 16: clears
	expect(at(0, true)).toBe(false); // reset to zero used: clears
});

test("a fresh collector is not stalled until its minutes have passed", () => {
	const stalled = [{ id: "stalled", kind: "stalled" as const, minutes: 15 }];
	const at = (startedAt: string | null, now: string) =>
		evaluate(stalled, { credentials: [], lastPopAt: null, startedAt, now }, () => false)[0]?.firing;
	expect(at("2026-09-16T00:00:00Z", "2026-09-16T00:05:00Z")).toBe(false);
	expect(at("2026-09-16T00:00:00Z", "2026-09-16T00:16:00Z")).toBe(true);
	expect(at(null, "2026-09-16T00:00:00Z")).toBe(true);
});

test("cooldown, unhealthy, and stalled rules read status and collector age", () => {
	const rules = [
		{ id: "cooldown", kind: "cooldown" as const },
		{ id: "unhealthy", kind: "unhealthy" as const, scope: "provider:claude" },
		{ id: "stalled", kind: "stalled" as const, minutes: 15 },
	];
	const results = evaluate(
		rules,
		{
			credentials: pools.credentials,
			lastPopAt: "2026-09-16T00:00:00Z",
			startedAt: null,
			now: "2026-09-16T00:20:00Z",
		},
		() => false,
	);
	const firing = results
		.filter((r) => r.firing)
		.map((r) => `${r.condition.ruleId}:${r.condition.subject}`);
	expect(firing).toEqual(["cooldown:claude-altay@uinaf.dev.json", "stalled:collector"]);
	expect(results.filter((r) => r.condition.ruleId === "unhealthy")).toHaveLength(3);
});

// A fake heartbeat sink: records every POST and whether it was /fail.
const sink = () => {
	const posts: Array<string> = [];
	const client = HttpClient.make((request) => {
		posts.push(request.url);
		return Effect.succeed(HttpClientResponse.fromWeb(request, new Response("ok", { status: 200 })));
	});
	return { posts, layer: Layer.succeed(HttpClient.HttpClient, client) };
};

test("runAlerts opens one incident per crossing, posts /fail then the plain heartbeat on clear", async () => {
	const dir = mkdtempSync(join(tmpdir(), "gatewai-alerts-"));
	writeFileSync(
		join(dir, "alerts.json"),
		JSON.stringify({ rules: [{ ...rule, heartbeat: "https://hb.test/abc" }] }),
	);
	const { posts, layer } = sink();
	const env = Layer.mergeAll(Database, layer).pipe(
		Layer.provideMerge(
			ConfigProvider.layer(
				ConfigProvider.fromUnknown({
					GATEWAI_DB_PATH: join(dir, "a.sqlite"),
					GATEWAI_ALERTS_FILE: join(dir, "alerts.json"),
				}),
			),
		),
	);
	const result = await Effect.gen(function* () {
		yield* writeCollectorState({ last_pop_at: "2026-09-16T00:00:00Z" });
		const run = (used: number, now: string) =>
			runAlerts({ observedAt: now, credentials: [withWeekly(codex, used)] }, now);
		const a = yield* run(85, "2026-09-16T00:00:00Z");
		const b = yield* run(92, "2026-09-16T00:01:00Z");
		const c = yield* run(92, "2026-09-16T00:02:00Z");
		const d = yield* run(90, "2026-09-16T00:03:00Z");
		const e = yield* run(0, "2026-09-16T00:04:00Z");
		const states = yield* readStates;
		const incidents = yield* listIncidents(1, 10);
		return { runs: [a, b, c, d, e], states, incidents };
	}).pipe(Effect.provide(env), Effect.runPromise);
	expect(result.runs.map((r) => [r.fired, r.cleared])).toEqual([
		[0, 0],
		[1, 0],
		[0, 0],
		[0, 0],
		[0, 1],
	]);
	expect(posts).toEqual(["https://hb.test/abc/fail", "https://hb.test/abc"]);
	expect(result.incidents.total).toBe(1);
	expect(result.incidents.rows[0]).toMatchObject({
		rule_id: rule.id,
		what: "weekly low",
		started_at: "2026-09-16T00:01:00Z",
		ended_at: "2026-09-16T00:04:00Z",
	});
	expect(result.states[0]?.firing).toBe(0);
	expect(result.states[0]?.last_fired).toBe("2026-09-16T00:01:00Z");
});

test("a failed heartbeat post is retried on the next pass", async () => {
	const dir = mkdtempSync(join(tmpdir(), "gatewai-alerts-"));
	writeFileSync(
		join(dir, "alerts.json"),
		JSON.stringify({ rules: [{ ...rule, heartbeat: "https://hb.test/abc" }] }),
	);
	let fail = true;
	const posts: Array<string> = [];
	const client = HttpClient.make((request) => {
		posts.push(request.url);
		return Effect.succeed(
			HttpClientResponse.fromWeb(request, new Response("", { status: fail ? 503 : 200 })),
		);
	});
	const env = Layer.mergeAll(Database, Layer.succeed(HttpClient.HttpClient, client)).pipe(
		Layer.provideMerge(
			ConfigProvider.layer(
				ConfigProvider.fromUnknown({
					GATEWAI_DB_PATH: join(dir, "b.sqlite"),
					GATEWAI_ALERTS_FILE: join(dir, "alerts.json"),
				}),
			),
		),
	);
	const delivered = await Effect.gen(function* () {
		const sql = yield* SqlClient.SqlClient;
		yield* runAlerts(
			{ observedAt: "x", credentials: [withWeekly(codex, 95)] },
			"2026-09-16T00:01:00Z",
		);
		fail = false;
		yield* runAlerts(
			{ observedAt: "x", credentials: [withWeekly(codex, 95)] },
			"2026-09-16T00:02:00Z",
		);
		return yield* sql<{ delivered: number }>`SELECT delivered FROM alert_state`;
	}).pipe(Effect.provide(env), Effect.runPromise);
	expect(posts).toEqual(["https://hb.test/abc/fail", "https://hb.test/abc/fail"]);
	expect(delivered[0]?.delivered).toBe(1);
});

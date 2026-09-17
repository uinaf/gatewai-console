import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ConfigProvider, Effect, Layer, Schema } from "effect";
import { HttpClient, HttpClientResponse } from "effect/unstable/http";
import { expect, test } from "vitest";

import { evaluate } from "#/server/alerts/evaluate";
import { AlertRules } from "#/server/alerts/rules";
import { runAlerts } from "#/server/alerts/run";
import { applyCondition, listIncidents, readStates } from "#/server/alerts/store";
import { Database } from "#/server/database";
import { writeCollectorState } from "#/server/ledger/store";
import { type Credential, poolsOf } from "#/server/management/credential";
import authFiles from "#/server/management/fixtures/auth-files.json";
import { AuthFiles } from "#/server/management/schema";

const pools = poolsOf(Schema.decodeUnknownSync(AuthFiles)(authFiles));
const codex = pools.credentials.find((c) => c.name === "codex-two@example.com.json");
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
	expect(firing).toEqual(["cooldown:claude-two@example.com.json", "stalled:collector"]);
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
	// Every pass pings: ok, fail, fail, fail, ok.
	expect(posts).toEqual([
		"https://hb.test/abc",
		"https://hb.test/abc/fail",
		"https://hb.test/abc/fail",
		"https://hb.test/abc/fail",
		"https://hb.test/abc",
	]);
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

test("a subject that disappears from the pool clears and closes its incident", async () => {
	const dir = mkdtempSync(join(tmpdir(), "gatewai-alerts-"));
	writeFileSync(join(dir, "alerts.json"), JSON.stringify({ rules: [rule] }));
	const { layer } = sink();
	const env = Layer.mergeAll(Database, layer).pipe(
		Layer.provideMerge(
			ConfigProvider.layer(
				ConfigProvider.fromUnknown({
					GATEWAI_DB_PATH: join(dir, "c.sqlite"),
					GATEWAI_ALERTS_FILE: join(dir, "alerts.json"),
				}),
			),
		),
	);
	const result = await Effect.gen(function* () {
		yield* runAlerts(
			{ observedAt: "x", credentials: [withWeekly(codex, 95)] },
			"2026-09-16T00:01:00Z",
		);
		const gone = yield* runAlerts({ observedAt: "x", credentials: [] }, "2026-09-16T00:02:00Z");
		const incidents = yield* listIncidents(1, 10);
		return { gone, incidents };
	}).pipe(Effect.provide(env), Effect.runPromise);
	expect(result.gone.cleared).toBe(1);
	expect(result.incidents.rows[0]?.ended_at).toBe("2026-09-16T00:02:00Z");
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
	const states = await Effect.gen(function* () {
		yield* runAlerts(
			{ observedAt: "x", credentials: [withWeekly(codex, 95)] },
			"2026-09-16T00:01:00Z",
		);
		fail = false;
		yield* runAlerts(
			{ observedAt: "x", credentials: [withWeekly(codex, 95)] },
			"2026-09-16T00:02:00Z",
		);
		return yield* readStates;
	}).pipe(Effect.provide(env), Effect.runPromise);
	// The failed post changes no state; the next pass posts the same state again.
	expect(posts).toEqual(["https://hb.test/abc/fail", "https://hb.test/abc/fail"]);
	expect(states[0]?.firing).toBe(1);
});

test("email goes out once per crossing when Cloudflare sending is configured", async () => {
	const dir = mkdtempSync(join(tmpdir(), "gatewai-alerts-"));
	writeFileSync(join(dir, "alerts.json"), JSON.stringify({ rules: [rule] }));
	const posts: Array<{ url: string; body: string }> = [];
	const client = HttpClient.make((request) => {
		posts.push({
			url: request.url,
			body: request.body._tag === "Uint8Array" ? new TextDecoder().decode(request.body.body) : "",
		});
		return Effect.succeed(HttpClientResponse.fromWeb(request, new Response("{}", { status: 200 })));
	});
	const env = Layer.mergeAll(Database, Layer.succeed(HttpClient.HttpClient, client)).pipe(
		Layer.provideMerge(
			ConfigProvider.layer(
				ConfigProvider.fromUnknown({
					GATEWAI_DB_PATH: join(dir, "e.sqlite"),
					GATEWAI_ALERTS_FILE: join(dir, "alerts.json"),
					CLOUDFLARE_ACCOUNT_ID: "acct",
					CLOUDFLARE_EMAIL_SENDING_API_TOKEN: "cf-token",
					GATEWAI_ALERT_EMAIL_FROM: "alerts@example.com",
					GATEWAI_ALERT_EMAIL_TO: "ops@example.com",
				}),
			),
		),
	);
	await Effect.gen(function* () {
		yield* runAlerts(
			{ observedAt: "x", credentials: [withWeekly(codex, 95)] },
			"2026-09-16T00:01:00Z",
		);
		yield* runAlerts(
			{ observedAt: "x", credentials: [withWeekly(codex, 95)] },
			"2026-09-16T00:02:00Z",
		);
		yield* runAlerts(
			{ observedAt: "x", credentials: [withWeekly(codex, 0)] },
			"2026-09-16T00:03:00Z",
		);
	}).pipe(Effect.provide(env), Effect.runPromise);
	expect(posts.map((p) => p.url)).toEqual([
		"https://api.cloudflare.com/client/v4/accounts/acct/email/sending/send",
		"https://api.cloudflare.com/client/v4/accounts/acct/email/sending/send",
	]);
	expect(JSON.parse(posts[0]?.body ?? "{}")).toMatchObject({
		from: "alerts@example.com",
		to: "ops@example.com",
	});
	expect(posts[0]?.body).toContain("firing: codex-weekly-low");
	expect(posts[1]?.body).toContain("clear: codex-weekly-low");
	expect(posts.some((p) => p.body.includes("cf-token"))).toBe(false);
});

test("rules with duplicate ids or out-of-range thresholds are rejected", async () => {
	const dir = mkdtempSync(join(tmpdir(), "gatewai-alerts-"));
	const bad = [
		{ rules: [rule, rule] },
		{ rules: [{ ...rule, remainingBelow: 101 }] },
		{ rules: [{ id: "s", kind: "stalled", minutes: 0 }] },
	];
	for (const [i, file] of bad.entries()) {
		writeFileSync(join(dir, `${i}.json`), JSON.stringify(file));
		const rules = await AlertRules.pipe(
			Effect.provide(
				ConfigProvider.layer(
					ConfigProvider.fromUnknown({ GATEWAI_ALERTS_FILE: join(dir, `${i}.json`) }),
				),
			),
			Effect.runPromise,
		);
		expect(rules).toEqual([]);
	}
});

test("a gateway outage still evaluates the stalled rule and leaves credential subjects alone", async () => {
	const dir = mkdtempSync(join(tmpdir(), "gatewai-alerts-"));
	writeFileSync(
		join(dir, "alerts.json"),
		JSON.stringify({ rules: [rule, { id: "stalled", kind: "stalled", minutes: 15 }] }),
	);
	const { layer } = sink();
	const env = Layer.mergeAll(Database, layer).pipe(
		Layer.provideMerge(
			ConfigProvider.layer(
				ConfigProvider.fromUnknown({
					GATEWAI_DB_PATH: join(dir, "d.sqlite"),
					GATEWAI_ALERTS_FILE: join(dir, "alerts.json"),
				}),
			),
		),
	);
	const result = await Effect.gen(function* () {
		yield* writeCollectorState({
			last_pop_at: "2026-09-16T00:00:00Z",
			started_at: "2026-09-15T00:00:00Z",
		});
		yield* runAlerts(
			{ observedAt: "x", credentials: [withWeekly(codex, 95)] },
			"2026-09-16T00:01:00Z",
		);
		const outage = yield* runAlerts(null, "2026-09-16T00:30:00Z");
		const states = yield* readStates;
		return { outage, states };
	}).pipe(Effect.provide(env), Effect.runPromise);
	expect(result.outage.fired).toBe(1);
	expect(result.states.map((s) => [s.rule_id, s.firing])).toEqual([
		[rule.id, 1],
		["stalled", 1],
	]);
});

test("a clear rule keeps its latest evaluated detail", async () => {
	const dir = mkdtempSync(join(tmpdir(), "gatewai-alerts-"));
	const env = Database.pipe(
		Layer.provideMerge(
			ConfigProvider.layer(ConfigProvider.fromUnknown({ GATEWAI_DB_PATH: join(dir, "d.sqlite") })),
		),
	);
	const condition = (detail: string) => ({
		ruleId: rule.id,
		subject: codex.name,
		what: "weekly low",
		detail,
		remaining: null,
	});
	const states = await Effect.gen(function* () {
		yield* applyCondition(condition("weekly remaining 41% on two"), false, "2026-09-16T00:00:00Z");
		yield* applyCondition(condition("weekly remaining 37% on two"), false, "2026-09-16T00:01:00Z");
		return yield* readStates;
	}).pipe(Effect.provide(env), Effect.runPromise);
	expect(states).toHaveLength(1);
	expect(states[0]).toMatchObject({
		firing: 0,
		since: "2026-09-16T00:00:00Z",
		last_fired: null,
		detail: "weekly remaining 37% on two",
	});
});

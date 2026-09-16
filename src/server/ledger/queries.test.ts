import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ConfigProvider, Effect, Layer } from "effect";
import { SqlClient } from "effect/unstable/sql";
import { expect, test } from "vitest";

import { Database } from "#/server/database";
import { breakdown, previousRange, quotaHistory, summary } from "#/server/ledger/queries";
import { insertRequests, recordQuotaSnapshot, type RequestRow } from "#/server/ledger/store";
import type { Credential } from "#/server/management/credential";

const layer = () =>
	Database.pipe(
		Layer.provide(
			ConfigProvider.layer(
				ConfigProvider.fromUnknown({
					GATEWAI_DB_PATH: join(mkdtempSync(join(tmpdir(), "gatewai-queries-")), "q.sqlite"),
				}),
			),
		),
	);
const run = <A, E>(effect: Effect.Effect<A, E, SqlClient.SqlClient>) =>
	effect.pipe(Effect.provide(layer()), Effect.runPromise);

const row = (
	overrides: Partial<RequestRow> & { request_id: string; timestamp: string },
): RequestRow => ({
	client_hash: "a".repeat(64),
	provider: "claude",
	model: "claude-fable-5-1",
	auth_index: "cred-a",
	source: null,
	stream: 1,
	failed: 0,
	latency_ms: 1000,
	ttft_ms: 200,
	tokens_input: 10,
	tokens_cached: 100,
	tokens_cache_write: 0,
	tokens_output: 5,
	tokens_reasoning: 0,
	reasoning_effort: null,
	service_tier: null,
	user_agent: null,
	raw: "{}",
	received_at: "2026-09-16T00:00:00.000Z",
	...overrides,
});

const range = { from: "2026-09-15T00:00:00.000Z", to: "2026-09-16T00:00:00.000Z" };

test("summary and breakdown aggregate the range and compare with the one before", async () => {
	const rows = [
		row({ request_id: "1", timestamp: "2026-09-15T01:00:00.000Z", latency_ms: 100 }),
		row({ request_id: "2", timestamp: "2026-09-15T02:00:00.000Z", latency_ms: 300, failed: 1 }),
		row({
			request_id: "3",
			timestamp: "2026-09-15T03:00:00.000Z",
			latency_ms: 900,
			model: "gpt-6-astra",
			provider: "codex",
		}),
		row({
			request_id: "4",
			timestamp: "2026-09-15T04:00:00.000Z",
			latency_ms: 500,
			client_hash: "b".repeat(64),
		}),
		row({ request_id: "prev", timestamp: "2026-09-14T04:00:00.000Z" }),
		row({ request_id: "out", timestamp: "2026-09-16T04:00:00.000Z" }),
	];
	const result = await run(
		Effect.gen(function* () {
			yield* insertRequests(rows, new Map());
			const total = yield* summary(range);
			const before = yield* summary(previousRange(range));
			const byClient = yield* breakdown("client", range, new Map([["a".repeat(64), "macbook"]]));
			const byModel = yield* breakdown("model", range, new Map());
			return { total, before, byClient, byModel };
		}),
	);
	expect(result.total).toEqual({ requests: 4, failed: 1, tokens: 4 * 115, cached: 400 });
	expect(result.before.requests).toBe(1);
	const macbook = result.byClient[0];
	expect(macbook).toMatchObject({
		label: "macbook",
		requests: 3,
		previousRequests: 1,
		cached: 300,
	});
	expect(macbook?.errorRate).toBeCloseTo(1 / 3);
	// Failed requests are excluded from latency; p50 of [100, 900] picks the lower middle.
	expect(macbook?.p50).toBe(100);
	expect(macbook?.p95).toBe(900);
	expect(macbook?.share.map((s) => [s.model, s.share])).toEqual([
		["claude-fable-5-1", 2 / 3],
		["gpt-6-astra", 1 / 3],
	]);
	expect(result.byClient[1]?.label).toBe("b".repeat(16));
	expect(result.byModel.map((r) => r.key)).toEqual(["claude-fable-5-1", "gpt-6-astra"]);
});

test("quota history marks drops as resets and includes the point before the range", async () => {
	const credential = (usedPercent: number, observedAt: string): Credential => ({
		name: "codex-a",
		authIndex: "x",
		provider: "codex",
		label: "a",
		plan: "pro",
		status: "active",
		statusMessage: null,
		cooldowns: [],
		success: 0,
		failed: 0,
		lastRefresh: null,
		recentRequests: [],
		websockets: null,
		quota: {
			observedAt,
			windows: [{ label: "weekly", usedPercent, resetsAt: null, status: "allowed" }],
			credits: null,
			plan: "pro",
			overage: null,
		},
	});
	const points = await run(
		Effect.gen(function* () {
			yield* recordQuotaSnapshot(credential(40, "2026-09-14T12:00:00.000Z"), "x");
			yield* recordQuotaSnapshot(credential(70, "2026-09-15T06:00:00.000Z"), "x");
			yield* recordQuotaSnapshot(credential(0, "2026-09-15T12:00:00.000Z"), "x");
			yield* recordQuotaSnapshot(credential(20, "2026-09-15T18:00:00.000Z"), "x");
			return yield* quotaHistory("codex-a", range);
		}),
	);
	expect(points.map((p) => [p.usedPercent, p.reset])).toEqual([
		[40, false],
		[70, false],
		[0, true],
		[20, false],
	]);
});

test("breakdown stays under budget on 90 days of gateway-scale rows", async () => {
	const rows: Array<RequestRow> = [];
	const start = Date.parse("2026-06-18T00:00:00.000Z");
	for (let i = 0; i < 60_000; i += 1) {
		rows.push(
			row({
				request_id: `r${i}`,
				timestamp: new Date(start + i * 129_600).toISOString(),
				client_hash: ["a", "b", "c", "d", "e"][i % 5]!.repeat(64),
				model: ["claude-fable-5-1", "gpt-6-astra", "grok-5-heavy"][i % 3]!,
				latency_ms: 200 + ((i * 7919) % 20_000),
				failed: i % 50 === 0 ? 1 : 0,
			}),
		);
	}
	const ms = await run(
		Effect.gen(function* () {
			yield* insertRequests(rows, new Map());
			const t0 = performance.now();
			yield* breakdown(
				"client",
				{ from: "2026-06-18T00:00:00.000Z", to: "2026-09-16T00:00:00.000Z" },
				new Map(),
			);
			yield* summary({ from: "2026-06-18T00:00:00.000Z", to: "2026-09-16T00:00:00.000Z" });
			return performance.now() - t0;
		}),
	);
	console.log(`ledger breakdown+summary over 60k rows: ${Math.round(ms)}ms`);
	expect(ms).toBeLessThan(1000);
});

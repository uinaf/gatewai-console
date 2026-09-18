import { type Config, ConfigProvider, Effect, Layer, Redacted } from "effect";
import { HttpClient, HttpClientError, HttpClientResponse } from "effect/unstable/http";
import type { HttpClientRequest } from "effect/unstable/http";
import { expect, test } from "vitest";

import { ManagementApi } from "#/server/management/api";
import authFiles from "#/server/management/fixtures/auth-files.json";
import usageQueue from "#/server/management/fixtures/usage-queue.json";

interface Seen {
	readonly method: string;
	readonly url: string;
	readonly authorization: string | undefined;
	readonly body: string;
}

type Reply = { status: number; body?: unknown } | "unreachable" | "hang";

const bodyText = (request: HttpClientRequest.HttpClientRequest) =>
	request.body._tag === "Uint8Array" ? new TextDecoder().decode(request.body.body) : "";

// A scripted HttpClient: one reply per call, in order, and a log of what it saw.
const scripted = (replies: ReadonlyArray<Reply>, env: Record<string, string> = {}) => {
	const seen: Array<Seen> = [];
	const queue = [...replies];
	const client = HttpClient.make((request, url) => {
		seen.push({
			method: request.method,
			url: url.toString(),
			authorization: request.headers.authorization,
			body: bodyText(request),
		});
		const reply = queue.shift() ?? { status: 500 };
		if (reply === "hang") return Effect.never;
		if (reply === "unreachable") {
			return Effect.fail(
				new HttpClientError.HttpClientError({
					reason: new HttpClientError.TransportError({ request, description: "ECONNREFUSED" }),
				}),
			);
		}
		return Effect.succeed(
			HttpClientResponse.fromWeb(
				request,
				new Response(JSON.stringify(reply.body ?? {}), {
					status: reply.status,
					headers: { "content-type": "application/json" },
				}),
			),
		);
	});
	const layer = ManagementApi.layerNoDeps.pipe(
		Layer.provide(Layer.succeed(HttpClient.HttpClient, client)),
		Layer.provide(
			ConfigProvider.layer(
				ConfigProvider.fromUnknown({
					GATEWAI_MANAGEMENT_URL: "http://proxy.test/v0/management",
					GATEWAI_MANAGEMENT_KEY: "test-key",
					GATEWAI_MANAGEMENT_TIMEOUT: "50 millis",
					...env,
				}),
			),
		),
	);
	return { seen, layer };
};

const run = <A, E>(
	layer: Layer.Layer<ManagementApi, Config.ConfigError>,
	use: (api: ManagementApi["Service"]) => Effect.Effect<A, E>,
) => Effect.flatMap(ManagementApi, use).pipe(Effect.provide(layer), Effect.exit, Effect.runPromise);

const xaiBilling = (
	creditUsagePercent?: number,
	onDemand?: { cap: number; used?: number },
	productUsage?: ReadonlyArray<{ product: string; usagePercent?: number }>,
) => ({
	status: 200,
	body: {
		status_code: 200,
		body: JSON.stringify({
			config: {
				currentPeriod: {
					type: "USAGE_PERIOD_TYPE_WEEKLY",
					start: "2026-09-13T17:40:10+00:00",
					end: "2026-09-20T17:40:10+00:00",
				},
				...(creditUsagePercent === undefined ? {} : { creditUsagePercent }),
				onDemandCap: { val: onDemand?.cap ?? 0 },
				...(onDemand?.used === undefined ? {} : { onDemandUsed: { val: onDemand.used } }),
				...(productUsage === undefined ? {} : { productUsage }),
			},
		}),
	},
});

const codexUsage = (usedPercent: number) => ({
	status: 200,
	body: {
		status_code: 200,
		body: JSON.stringify({
			user_id: "user-redacted",
			email: "codex-one@example.com",
			plan_type: "pro",
			rate_limit: {
				allowed: true,
				limit_reached: false,
				primary_window: {
					used_percent: usedPercent,
					limit_window_seconds: 604_800,
					reset_after_seconds: 165_820,
					reset_at: 1_789_808_978,
				},
				secondary_window: null,
			},
			additional_rate_limits: [{ limit_name: "GPT-5.3-Codex-Spark" }],
		}),
	},
});

const claudeUsage = (windows: {
	fiveHour?: number;
	weekly?: number;
	fable?: number;
	extra?: { used: number; cap: number };
}) => ({
	status: 200,
	body: {
		status_code: 200,
		body: JSON.stringify({
			five_hour:
				windows.fiveHour === undefined
					? undefined
					: { utilization: windows.fiveHour, resets_at: "2026-09-18T12:00:00Z" },
			seven_day:
				windows.weekly === undefined
					? undefined
					: { utilization: windows.weekly, resets_at: "2026-09-22T08:00:00Z" },
			limits:
				windows.fable === undefined
					? undefined
					: [
							{
								kind: "weekly_scoped",
								percent: windows.fable,
								resets_at: "2026-09-22T08:00:00Z",
								is_active: true,
								scope: { model: { display_name: "Fable 5" } },
							},
						],
			extra_usage:
				windows.extra === undefined
					? undefined
					: {
							is_enabled: true,
							used_credits: windows.extra.used,
							monthly_limit: windows.extra.cap,
						},
		}),
	},
});

const take = (queue: Reply[]): Reply => queue.shift() ?? { status: 500 };

// Pools fans out api-call by provider in parallel, so replies are keyed by the
// upstream URL in the body rather than call order.
const scriptedPools = (
	queues: {
		authFiles?: Reply[];
		xai?: Reply[];
		codex?: Reply[];
		claude?: Reply[];
	},
	env: Record<string, string> = {},
) => {
	const authQ = [...(queues.authFiles ?? [{ status: 200, body: authFiles }])];
	const xaiQ = [...(queues.xai ?? [])];
	const codexQ = [...(queues.codex ?? [])];
	const claudeQ = [...(queues.claude ?? [])];
	const seen: Array<Seen> = [];
	const client = HttpClient.make((request, url) => {
		seen.push({
			method: request.method,
			url: url.toString(),
			authorization: request.headers.authorization,
			body: bodyText(request),
		});
		const href = url.toString();
		const body = bodyText(request);
		const reply = href.endsWith("/auth-files")
			? take(authQ)
			: body.includes("anthropic.com")
				? take(claudeQ)
				: body.includes("wham/usage")
					? take(codexQ)
					: body.includes("grok.com")
						? take(xaiQ)
						: { status: 500 };
		if (reply === "hang") return Effect.never;
		if (reply === "unreachable") {
			return Effect.fail(
				new HttpClientError.HttpClientError({
					reason: new HttpClientError.TransportError({ request, description: "ECONNREFUSED" }),
				}),
			);
		}
		return Effect.succeed(
			HttpClientResponse.fromWeb(
				request,
				new Response(JSON.stringify(reply.body ?? {}), {
					status: reply.status,
					headers: { "content-type": "application/json" },
				}),
			),
		);
	});
	const layer = ManagementApi.layerNoDeps.pipe(
		Layer.provide(Layer.succeed(HttpClient.HttpClient, client)),
		Layer.provide(
			ConfigProvider.layer(
				ConfigProvider.fromUnknown({
					GATEWAI_MANAGEMENT_URL: "http://proxy.test/v0/management",
					GATEWAI_MANAGEMENT_KEY: "test-key",
					GATEWAI_MANAGEMENT_TIMEOUT: "50 millis",
					...env,
				}),
			),
		),
	);
	return { seen, layer };
};

test("auth-files retries a transient failure and normalises the pools", async () => {
	const { seen, layer } = scriptedPools({
		authFiles: [{ status: 503 }, { status: 200, body: authFiles }],
		xai: [xaiBilling(), xaiBilling(1)],
		codex: [codexUsage(0), codexUsage(0)],
		claude: [
			claudeUsage({ fiveHour: 10 }),
			claudeUsage({ fiveHour: 10 }),
			claudeUsage({ fiveHour: 10 }),
		],
	});
	const exit = await run(layer, (api) => api.pools);
	expect(exit._tag).toBe("Success");
	if (exit._tag !== "Success") return;
	expect(exit.value.credentials).toHaveLength(7);
	expect(seen).toHaveLength(9);
	expect(seen[0]).toMatchObject({
		method: "GET",
		url: "http://proxy.test/v0/management/auth-files",
		authorization: "Bearer test-key",
	});
});

test("xai quota comes from grok billing through api-call; a failed read leaves no window", async () => {
	const { seen, layer } = scriptedPools({
		xai: [xaiBilling(1), { status: 502 }],
	});
	const exit = await run(layer, (api) => api.pools);
	expect(exit._tag).toBe("Success");
	if (exit._tag !== "Success") return;
	const calls = seen.filter((s) => s.url.endsWith("/api-call") && s.body.includes("grok.com"));
	expect(calls.length).toBeGreaterThan(2);
	expect(calls[0]?.method).toBe("POST");
	expect(calls[0]?.body).toContain("cli-chat-proxy.grok.com/v1/billing?format=credits");
	expect(calls[0]?.body).toContain("$TOKEN$");
	const xai = exit.value.credentials.filter((c) => c.provider === "xai");
	const windows = xai.map((c) => c.quota.windows.map((w) => [w.label, w.usedPercent, w.resetsAt]));
	expect(windows).toContainEqual([
		["weekly", 1, "2026-09-20T17:40:10.000Z"],
		["grokbuild", 0, null],
	]);
	expect(windows).toContainEqual([]);
});

test("xai on-demand spend is carried when the cap is positive, null otherwise", async () => {
	const onDemandOf = async (...replies: Array<ReturnType<typeof xaiBilling>>) => {
		const { layer } = scriptedPools({ xai: replies });
		const exit = await run(layer, (api) => api.pools);
		expect(exit._tag).toBe("Success");
		if (exit._tag !== "Success") return [];
		return exit.value.credentials.filter((c) => c.provider === "xai").map((c) => c.quota.onDemand);
	};
	const spent = await onDemandOf(
		xaiBilling(1, { cap: 5000, used: 1250 }),
		xaiBilling(1, { cap: 0 }),
	);
	expect(spent).toHaveLength(2);
	expect(spent).toEqual(expect.arrayContaining([{ usedCents: 1250, capCents: 5000 }, null]));
	const fresh = await onDemandOf(xaiBilling(1, { cap: 3000 }), xaiBilling(1, { cap: 3000 }));
	expect(fresh).toEqual([
		{ usedCents: 0, capCents: 3000 },
		{ usedCents: 0, capCents: 3000 },
	]);
});

test("xai product usage becomes extra windows next to the weekly period", async () => {
	const { layer } = scriptedPools({
		xai: [
			xaiBilling(1, undefined, [{ product: "GrokBuild", usagePercent: 1 }]),
			xaiBilling(0, undefined, [{ product: "GrokBuild" }]),
		],
	});
	const exit = await run(layer, (api) => api.pools);
	expect(exit._tag).toBe("Success");
	if (exit._tag !== "Success") return;
	const xai = exit.value.credentials.filter((c) => c.provider === "xai");
	const windows = xai.map((c) => c.quota.windows.map((w) => [w.label, w.usedPercent]));
	expect(windows).toContainEqual([
		["weekly", 1],
		["grokbuild", 1],
	]);
	expect(windows).toContainEqual([
		["weekly", 0],
		["grokbuild", 0],
	]);
});

test("codex quota comes from the chatgpt usage endpoint through api-call; a failed read keeps the header windows", async () => {
	const { seen, layer } = scriptedPools({
		codex: [codexUsage(89), { status: 502 }],
	});
	const exit = await run(layer, (api) => api.pools);
	expect(exit._tag).toBe("Success");
	if (exit._tag !== "Success") return;
	const calls = seen.filter((s) => s.url.endsWith("/api-call") && s.body.includes("wham/usage"));
	expect(calls.length).toBeGreaterThan(2);
	expect(calls[0]?.body).toContain('"Chatgpt-Account-Id":"00000000-0000-4000-8000-000000000001"');
	expect(calls[0]?.body).toContain("$TOKEN$");
	const codex = exit.value.credentials.filter((c) => c.provider === "codex");
	const windows = codex.map((c) =>
		c.quota.windows.map((w) => [w.label, w.usedPercent, w.resetsAt]),
	);
	expect(windows).toContainEqual([["weekly", 89, "2026-09-19T09:09:38.000Z"]]);
	const fallback = codex.find((c) => c.name === "codex-two@example.com.json");
	expect(fallback?.quota.windows.length).toBeGreaterThan(0);
	expect(fallback?.quota.windows.map((w) => w.usedPercent)).not.toContain(89);
});

test("claude quota comes from the oauth usage endpoint through api-call; a failed read keeps the header windows", async () => {
	const { seen, layer } = scriptedPools({
		claude: [
			claudeUsage({ fiveHour: 45, weekly: 50, fable: 16, extra: { used: 0, cap: 5000 } }),
			{ status: 502 },
			claudeUsage({ fiveHour: 0, weekly: 61, fable: 100 }),
		],
	});
	const exit = await run(layer, (api) => api.pools);
	expect(exit._tag).toBe("Success");
	if (exit._tag !== "Success") return;
	const calls = seen.filter((s) => s.url.endsWith("/api-call") && s.body.includes("anthropic.com"));
	expect(calls.length).toBeGreaterThan(3);
	expect(calls[0]?.body).toContain("api.anthropic.com/api/oauth/usage");
	expect(calls[0]?.body).toContain("$TOKEN$");
	expect(calls[0]?.body).toContain("oauth-2025-04-20");
	const claude = Object.fromEntries(
		exit.value.credentials.filter((c) => c.provider === "claude").map((c) => [c.name, c]),
	);
	expect(
		claude["claude-one@example.com.json"]?.quota.windows.map((w) => [w.label, w.usedPercent]),
	).toEqual([
		["5-hour", 45],
		["weekly", 50],
		["weekly fable", 16],
	]);
	expect(claude["claude-one@example.com.json"]?.quota.onDemand).toEqual({
		usedCents: 0,
		capCents: 5000,
	});
	expect(
		claude["claude-dev@example.com.json"]?.quota.windows.map((w) => [w.label, w.usedPercent]),
	).toEqual([
		["5-hour", 0],
		["weekly", 61],
		["weekly fable", 100],
	]);
	const fallback = claude["claude-two@example.com.json"];
	expect(fallback?.quota.windows.map((w) => [w.label, w.usedPercent, w.status])).toEqual([
		["5-hour", 17, "allowed"],
		["weekly", 50, "allowed"],
		["weekly fable", 100, "rejected"],
	]);
});

test("usage-queue pops once and never retries", async () => {
	const { seen, layer } = scripted([{ status: 503 }, { status: 200, body: usageQueue }]);
	const exit = await run(layer, (api) => api.popUsage(50));
	expect(exit._tag).toBe("Failure");
	expect(seen).toHaveLength(1);
	expect(seen[0]?.url).toBe("http://proxy.test/v0/management/usage-queue?count=50");

	const ok = scripted([{ status: 200, body: usageQueue }]);
	const records = await run(ok.layer, (api) => api.popUsage(2));
	expect(records._tag).toBe("Success");
	if (records._tag === "Success") expect(records.value[0]?.model).toBe("claude-fable-5-1");
});

test("faults map to the three fault reasons", async () => {
	const reasonOf = async (reply: Reply) => {
		const { layer } = scripted([reply, reply, reply]);
		const exit = await run(layer, (api) =>
			api.authFiles.pipe(
				Effect.as("ok"),
				Effect.catchTag("ManagementError", (error) => Effect.succeed(error.reason)),
			),
		);
		return exit._tag === "Success" ? exit.value : exit._tag;
	};
	expect(await reasonOf("unreachable")).toBe("unreachable");
	expect(await reasonOf({ status: 401 })).toBe("unauthorized");
	expect(await reasonOf({ status: 200, body: { nope: true } })).toBe("mismatch");
	expect(await reasonOf({ status: 404 })).toBe("status");
});

test("runbook actions post the documented bodies", async () => {
	const { seen, layer } = scripted([
		{ status: 200, body: { status: "ok", auth_index: "abc" } },
		{ status: 200, body: { ok: true } },
		{ status: 200, body: { status: "ok" } },
	]);
	const exit = await run(layer, (api) =>
		Effect.all([
			api.resetQuota("abc"),
			api.refresh("codex-two@example.com.json"),
			api.patchFields("codex-two@example.com.json", { websockets: false }),
		]),
	);
	expect(exit._tag).toBe("Success");
	expect(
		seen.map((call) => [
			call.method,
			call.url.replace("http://proxy.test/v0/management", ""),
			call.body,
		]),
	).toEqual([
		["POST", "/reset-quota", '{"auth_index":"abc"}'],
		["POST", "/auth-files/refresh", '{"name":"codex-two@example.com.json"}'],
		["PATCH", "/auth-files/fields", '{"name":"codex-two@example.com.json","websockets":false}'],
	]);
});

test("a hung gateway times out into unreachable on both clients", async () => {
	const reads = scripted(["hang", "hang", "hang"]);
	const read = await run(reads.layer, (api) =>
		api.authFiles.pipe(Effect.catchTag("ManagementError", (error) => Effect.succeed(error.reason))),
	);
	expect(read).toMatchObject({ _tag: "Success", value: "unreachable" });
	expect(reads.seen).toHaveLength(3);

	const pops = scripted(["hang"]);
	const pop = await run(pops.layer, (api) =>
		api
			.popUsage(1)
			.pipe(Effect.catchTag("ManagementError", (error) => Effect.succeed(error.reason))),
	);
	expect(pop).toMatchObject({ _tag: "Success", value: "unreachable" });
	expect(pops.seen).toHaveLength(1);
});

test("a missing key is an unauthorized fault, not a layer failure", async () => {
	const { seen, layer } = scripted([{ status: 200, body: authFiles }], {
		GATEWAI_MANAGEMENT_KEY: "",
	});
	const exit = await run(layer, (api) =>
		api.authFiles.pipe(Effect.catchTag("ManagementError", (error) => Effect.succeed(error.reason))),
	);
	expect(exit).toMatchObject({ _tag: "Success", value: "unauthorized" });
	expect(seen).toHaveLength(0);
});

test("a mismatch never quotes the body", async () => {
	const { layer } = scripted([{ status: 200, body: { files: [{ secret: "tok-123" }] } }]);
	const exit = await run(layer, (api) =>
		api.authFiles.pipe(
			Effect.catchTag("ManagementError", (error) => Effect.succeed(error.message)),
		),
	);
	expect(exit).toMatchObject({
		_tag: "Success",
		value: "response did not match the expected shape",
	});
});

test("a popped batch keeps its valid records", async () => {
	const { layer } = scripted([{ status: 200, body: [...usageQueue, { provider: 1 }] }]);
	const exit = await run(layer, (api) => api.popUsage(3));
	expect(exit._tag).toBe("Success");
	if (exit._tag === "Success") expect(exit.value).toHaveLength(usageQueue.length);
});

test("refresh reporting ok:false is a fault", async () => {
	const { layer } = scripted([{ status: 200, body: { ok: false, error: "refresh failed" } }]);
	const exit = await run(layer, (api) =>
		api
			.refresh("x")
			.pipe(Effect.catchTag("ManagementError", (error) => Effect.succeed(error.reason))),
	);
	expect(exit).toMatchObject({ _tag: "Success", value: "status" });
});

test("an unreadable key file is an unauthorized fault", async () => {
	const { seen, layer } = scripted([{ status: 200, body: authFiles }], {
		GATEWAI_MANAGEMENT_KEY: "",
		GATEWAI_MANAGEMENT_KEY_FILE: "/nonexistent/key",
	});
	const exit = await run(layer, (api) =>
		api.authFiles.pipe(
			Effect.catchTag("ManagementError", (error) => Effect.succeed(error.message)),
		),
	);
	expect(exit).toMatchObject({ _tag: "Success", value: "management key file could not be read" });
	expect(seen).toHaveLength(0);
});

test("the key never appears in the error", async () => {
	const { layer } = scripted(["unreachable", "unreachable", "unreachable"]);
	const exit = await run(layer, (api) => api.authFiles);
	expect(JSON.stringify(exit)).not.toContain("test-key");
	expect(Redacted.value(Redacted.make("test-key"))).toBe("test-key");
});

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

const xaiBilling = (creditUsagePercent?: number) => ({
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
				onDemandCap: { val: 0 },
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

test("auth-files retries a transient failure and normalises the pools", async () => {
	const { seen, layer } = scripted([
		{ status: 503 },
		{ status: 200, body: authFiles },
		xaiBilling(),
		xaiBilling(1),
		codexUsage(0),
		codexUsage(0),
	]);
	const exit = await run(layer, (api) => api.pools);
	expect(exit._tag).toBe("Success");
	if (exit._tag !== "Success") return;
	expect(exit.value.credentials).toHaveLength(7);
	expect(seen).toHaveLength(6);
	expect(seen[0]).toMatchObject({
		method: "GET",
		url: "http://proxy.test/v0/management/auth-files",
		authorization: "Bearer test-key",
	});
});

test("xai quota comes from grok billing through api-call; a failed read leaves no window", async () => {
	const { seen, layer } = scripted([
		{ status: 200, body: authFiles },
		xaiBilling(1),
		{ status: 502 },
	]);
	const exit = await run(layer, (api) => api.pools);
	expect(exit._tag).toBe("Success");
	if (exit._tag !== "Success") return;
	const calls = seen.filter((s) => s.url.endsWith("/api-call") && s.body.includes("grok.com"));
	expect(calls).toHaveLength(2);
	expect(calls[0]?.method).toBe("POST");
	expect(calls[0]?.body).toContain("cli-chat-proxy.grok.com/v1/billing?format=credits");
	expect(calls[0]?.body).toContain("$TOKEN$");
	const xai = exit.value.credentials.filter((c) => c.provider === "xai");
	const windows = xai.map((c) => c.quota.windows.map((w) => [w.label, w.usedPercent, w.resetsAt]));
	expect(windows).toContainEqual([["weekly", 1, "2026-09-20T17:40:10.000Z"]]);
	expect(windows).toContainEqual([]);
});

test("codex quota comes from the chatgpt usage endpoint through api-call; a failed read keeps the header windows", async () => {
	const { seen, layer } = scripted([
		{ status: 200, body: authFiles },
		xaiBilling(),
		xaiBilling(),
		codexUsage(89),
		{ status: 502 },
	]);
	const exit = await run(layer, (api) => api.pools);
	expect(exit._tag).toBe("Success");
	if (exit._tag !== "Success") return;
	const calls = seen.filter((s) => s.url.endsWith("/api-call") && s.body.includes("wham/usage"));
	expect(calls).toHaveLength(2);
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

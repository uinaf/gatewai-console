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

type Reply = { status: number; body?: unknown } | "unreachable";

const bodyText = (request: HttpClientRequest.HttpClientRequest) =>
	request.body._tag === "Uint8Array" ? new TextDecoder().decode(request.body.body) : "";

// A scripted HttpClient: one reply per call, in order, and a log of what it saw.
const scripted = (replies: ReadonlyArray<Reply>) => {
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

test("auth-files retries a transient failure and normalises the pools", async () => {
	const { seen, layer } = scripted([{ status: 503 }, { status: 200, body: authFiles }]);
	const exit = await run(layer, (api) => api.pools);
	expect(exit._tag).toBe("Success");
	if (exit._tag !== "Success") return;
	expect(exit.value.credentials).toHaveLength(7);
	expect(seen).toHaveLength(2);
	expect(seen[0]).toMatchObject({
		method: "GET",
		url: "http://proxy.test/v0/management/auth-files",
		authorization: "Bearer test-key",
	});
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
			api.refresh("codex-altay@uinaf.dev.json"),
			api.patchFields("codex-altay@uinaf.dev.json", { websockets: false }),
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
		["POST", "/auth-files/refresh", '{"name":"codex-altay@uinaf.dev.json"}'],
		["PATCH", "/auth-files/fields", '{"name":"codex-altay@uinaf.dev.json","websockets":false}'],
	]);
});

test("the key never appears in the error", async () => {
	const { layer } = scripted(["unreachable", "unreachable", "unreachable"]);
	const exit = await run(layer, (api) => api.authFiles);
	expect(JSON.stringify(exit)).not.toContain("test-key");
	expect(Redacted.value(Redacted.make("test-key"))).toBe("test-key");
});

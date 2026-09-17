import { Schema } from "effect";
import { expect, test } from "vitest";

import { credentialOf, poolsOf } from "#/server/management/credential";
import fixture from "#/server/management/fixtures/auth-files.json";
import { AuthFiles } from "#/server/management/schema";

const files = Schema.decodeUnknownSync(AuthFiles)(fixture);
const byName = (name: string) => {
	const file = files.files.find((file) => file.name === name);
	if (!file) throw new Error(`fixture missing ${name}`);
	return credentialOf(file);
};

test("fixture decodes without token material", () => {
	expect(files.files).toHaveLength(7);
	// `id_token` is a claims object on the wire, never the token string.
	expect(JSON.stringify(files)).not.toMatch(/access_token|refresh_token|"id_token":"/);
});

test("anthropic unified windows fold into 5-hour, weekly, and the flagship weekly", () => {
	const credential = byName("claude-two@example.com.json");
	expect(credential.status).toBe("cooling");
	expect(credential.cooldowns[0]).toMatchObject({ model: "claude-fable-5-1", reason: "quota" });
	expect(credential.quota.windows).toEqual([
		{ label: "5-hour", usedPercent: 17, resetsAt: "2026-09-16T10:30:00.000Z", status: "allowed" },
		{ label: "weekly", usedPercent: 50, resetsAt: "2026-09-19T08:00:00.000Z", status: "allowed" },
		{
			label: "weekly fable",
			usedPercent: 100,
			resetsAt: "2026-09-19T08:00:00.000Z",
			status: "rejected",
		},
	]);
	expect(credential.quota.overage).toBe("rejected");
	expect(credential.quota.credits).toBeNull();
});

test("codex primary window, credits, and plan; per-family windows are dropped", () => {
	const credential = byName("codex-two@example.com.json");
	expect(credential.status).toBe("active");
	expect(credential.plan).toBe("pro");
	expect(credential.websockets).toBe(true);
	expect(credential.quota.credits).toEqual({ balance: 712.249535, unlimited: false });
	const labels = credential.quota.windows.map((window) => [window.label, window.usedPercent]);
	expect(labels).toContainEqual(["weekly", 77]);
	expect(labels.map(([label]) => label)).toEqual(["weekly"]);
});

test("the flagship weekly label follows the snapshot that carries 7d_oi, not key order", () => {
	const base = files.files.find((file) => file.name === "claude-two@example.com.json");
	if (!base?.model_quotas) throw new Error("fixture missing claude-two");
	const fable = base.model_quotas["claude-fable-5-1"];
	if (!fable) throw new Error("fixture missing the fable snapshot");
	const reordered = {
		...base,
		model_quotas: {
			"claude-haiku-4-5-20251001": {
				observed_at: fable.observed_at,
				signals: { "Anthropic-Ratelimit-Unified-5h-Utilization": "0.1" },
			},
			"claude-fable-5-1": fable,
		},
	};
	expect(credentialOf(reordered).quota.windows.map((window) => window.label)).toContain(
		"weekly fable",
	);
});

test("xai reports counts without windows", () => {
	const credential = byName("xai-two@example.com.json");
	expect(credential.quota.windows).toEqual([]);
	expect(credential.success).toBe(55);
	expect(credential.recentRequests).toHaveLength(20);
});

test("non-numeric signals are skipped and offsets order by instant", () => {
	const base = files.files.find((file) => file.provider === "claude");
	if (!base) throw new Error("fixture missing claude");
	const credential = credentialOf({
		...base,
		quota: {
			observed_at: "2026-09-16T10:00:00Z",
			signals: { "Anthropic-Ratelimit-Unified-5h-Utilization": "0.9" },
		},
		model_quotas: {
			stale: {
				observed_at: "2026-09-16T11:00:00+08:00",
				signals: { "Anthropic-Ratelimit-Unified-5h-Utilization": "0.1" },
			},
			broken: {
				observed_at: "2026-09-16T12:00:00Z",
				signals: { "Anthropic-Ratelimit-Unified-7d-Utilization": "N/A" },
			},
		},
	});
	expect(credential.quota.windows).toEqual([
		{ label: "5-hour", usedPercent: 90, resetsAt: null, status: "unknown" },
	]);
});

test("codex allowance flags and blank credits are honoured", () => {
	const base = files.files.find((file) => file.provider === "codex");
	if (!base) throw new Error("fixture missing codex");
	const credential = credentialOf({
		...base,
		model_quotas: {},
		quota: {
			observed_at: "2026-09-16T10:00:00Z",
			signals: {
				"X-Codex-Allowed": "false",
				"X-Codex-Primary-Used-Percent": "40",
				"X-Codex-Primary-Window-Minutes": "10080",
				"X-Codex-Credits-Balance": "",
			},
		},
	});
	expect(credential.quota.windows).toEqual([
		{ label: "weekly", usedPercent: 40, resetsAt: null, status: "rejected" },
	]);
	expect(credential.quota.credits).toBeNull();
});

test("pools carry the gateway observation time", () => {
	expect(poolsOf(files).observedAt).toBe("2026-09-16T15:01:57.038963298Z");
});

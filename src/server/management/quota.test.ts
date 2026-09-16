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
	expect(JSON.stringify(files)).not.toMatch(/id_token|access_token|refresh_token/);
});

test("anthropic unified windows fold into 5-hour, weekly, weekly opus", () => {
	const credential = byName("claude-altay@uinaf.dev.json");
	expect(credential.status).toBe("cooling");
	expect(credential.cooldowns[0]).toMatchObject({ model: "claude-fable-5-1", reason: "quota" });
	expect(credential.quota.windows).toEqual([
		{ label: "5-hour", usedPercent: 17, resetsAt: "2026-09-16T10:30:00.000Z", status: "allowed" },
		{ label: "weekly", usedPercent: 50, resetsAt: "2026-09-19T08:00:00.000Z", status: "allowed" },
		{
			label: "weekly opus",
			usedPercent: 100,
			resetsAt: "2026-09-19T08:00:00.000Z",
			status: "rejected",
		},
	]);
	expect(credential.quota.overage).toBe("rejected");
	expect(credential.quota.credits).toBeNull();
});

test("codex primary window, credits, plan, and named families", () => {
	const credential = byName("codex-altay@uinaf.dev.json");
	expect(credential.status).toBe("active");
	expect(credential.plan).toBe("pro");
	expect(credential.websockets).toBe(true);
	expect(credential.quota.credits).toEqual({ balance: 712.249535, unlimited: false });
	const labels = credential.quota.windows.map((window) => [window.label, window.usedPercent]);
	expect(labels).toContainEqual(["weekly", 77]);
	expect(labels).toContainEqual(["gpt-5.3-codex-spark 5-hour", 0]);
	expect(labels).toContainEqual(["gpt-5.3-codex-spark weekly", 0]);
	expect(labels.map(([label]) => label)).not.toContain("0m");
});

test("xai reports counts without windows", () => {
	const credential = byName("xai-altay@uinaf.dev.json");
	expect(credential.quota.windows).toEqual([]);
	expect(credential.success).toBe(55);
	expect(credential.recentRequests).toHaveLength(20);
});

test("pools carry the gateway observation time", () => {
	expect(poolsOf(files).observedAt).toBe("2026-09-16T15:01:57.038963298Z");
});

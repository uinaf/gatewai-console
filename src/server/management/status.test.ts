import { expect, test } from "vitest";

import { classifyStatus } from "#/server/management/status";

test("anthropic rate-limit json becomes limited, never the blob", () => {
	const raw = `{"type":"error","error":{"type":"rate_limit_error","message":"Rate limited"},"request_id":"req_011CfAg2ALoS8HLC5vCfhLy"}`;
	expect(classifyStatus(raw)).toEqual({ kind: "limited", message: "rate limited." });
	expect(classifyStatus(raw).message).not.toMatch(/request_id|rate_limit_error|\{/);
});

test("auth, overload, and plain lines classify without leaking json", () => {
	expect(
		classifyStatus(
			JSON.stringify({
				type: "error",
				error: { type: "authentication_error", message: "invalid x-api-key" },
			}),
		),
	).toEqual({ kind: "auth", message: "auth failed." });
	expect(classifyStatus('{"type":"overloaded_error","message":"Overloaded"}')).toEqual({
		kind: "overloaded",
		message: "provider overloaded.",
	});
	expect(classifyStatus("token expired")).toEqual({
		kind: "error",
		message: "token expired.",
	});
	expect(classifyStatus("")).toEqual({ kind: "error", message: "gateway reports an error." });
	expect(classifyStatus("{not json")).toEqual({
		kind: "error",
		message: "gateway reports an error.",
	});
});

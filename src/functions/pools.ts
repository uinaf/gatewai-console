import { createServerFn } from "@tanstack/react-start";
import { getRequestHeader } from "@tanstack/react-start/server";
import { Config, Effect } from "effect";

import { ManagementApi, type ManagementError } from "#/server/management/api";
import { type Pools } from "#/server/management/credential";
import { runtime } from "#/server/runtime";

export type FaultReason = ManagementError["reason"] | "internal";

export interface PoolsView {
	readonly host: string;
	readonly operator: string | null;
	readonly fetchedAt: string;
	readonly result:
		| { readonly ok: true; readonly pools: Pools }
		| { readonly ok: false; readonly reason: FaultReason; readonly message: string };
}

const HostLabel = Config.String("GATEWAI_HOST_LABEL").pipe(Config.withDefault("local"));

const context = () => ({
	// Set by `tailscale serve` when the console sits behind the tailnet.
	operator: getRequestHeader("tailscale-user-login") ?? null,
	fetchedAt: new Date().toISOString(),
});

const runAction = <A>(effect: Effect.Effect<A, ManagementError, ManagementApi>) =>
	runtime.runPromise(
		effect.pipe(
			Effect.map(() => ({ ok: true as const })),
			Effect.catchTag("ManagementError", (error) =>
				Effect.succeed({ ok: false as const, reason: error.reason, message: error.message }),
			),
		),
	);

export const loadPools = createServerFn({ method: "GET" }).handler(async (): Promise<PoolsView> => {
	const host = await runtime.runPromise(HostLabel);
	const result = await runtime
		.runPromise(
			Effect.flatMap(ManagementApi, (api) => api.pools).pipe(
				Effect.map((pools) => ({ ok: true as const, pools })),
				Effect.catchTag("ManagementError", (error) =>
					Effect.logWarning("pools: management api failed", error.message).pipe(
						Effect.as({ ok: false as const, reason: error.reason, message: error.message }),
					),
				),
			),
		)
		.catch((cause: unknown) => ({
			ok: false as const,
			reason: "internal" as const,
			message: cause instanceof Error ? cause.message : String(cause),
		}));
	return { host, ...context(), result };
});

const authIndexInput = (input: unknown) => {
	if (typeof input !== "object" || input === null) throw new Error("input required");
	const { authIndex } = input as { authIndex?: unknown };
	if (typeof authIndex !== "string" || authIndex === "") throw new Error("authIndex required");
	return { authIndex };
};

const nameInput = (input: unknown) => {
	if (typeof input !== "object" || input === null) throw new Error("input required");
	const { name } = input as { name?: unknown };
	if (typeof name !== "string" || name === "") throw new Error("name required");
	return { name };
};

export const resetCooldown = createServerFn({ method: "POST" })
	.validator(authIndexInput)
	.handler(({ data }) =>
		runAction(Effect.flatMap(ManagementApi, (api) => api.resetQuota(data.authIndex))),
	);

export const refreshCredential = createServerFn({ method: "POST" })
	.validator(nameInput)
	.handler(({ data }) => runAction(Effect.flatMap(ManagementApi, (api) => api.refresh(data.name))));

export const setWebsockets = createServerFn({ method: "POST" })
	.validator((input: unknown) => {
		const { name } = nameInput(input);
		const { enabled } = input as { enabled?: unknown };
		if (typeof enabled !== "boolean") throw new Error("enabled required");
		return { name, enabled };
	})
	.handler(({ data }) =>
		runAction(
			Effect.flatMap(ManagementApi, (api) =>
				api.patchFields(data.name, { websockets: data.enabled }),
			),
		),
	);

import { createServerFn } from "@tanstack/react-start";
import { getRequestHeader } from "@tanstack/react-start/server";
import { Config, Effect } from "effect";

import { ManagementApi, type ManagementError } from "#/server/management/api";
import { type Pools } from "#/server/management/credential";
import { runtime } from "#/server/runtime";

/** `render` is a thrown render error caught by the root route, not a loader result. */
export type FaultReason = ManagementError["reason"] | "internal" | "render";

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

export type ActionResult =
	| { readonly ok: true }
	| { readonly ok: false; readonly reason: FaultReason; readonly message: string };

const runAction = <A>(
	effect: Effect.Effect<A, ManagementError, ManagementApi>,
): Promise<ActionResult> =>
	runtime
		.runPromise(
			effect.pipe(
				Effect.map((): ActionResult => ({ ok: true })),
				Effect.catchTag("ManagementError", (error) =>
					Effect.succeed<ActionResult>({
						ok: false,
						reason: error.reason,
						message: error.message,
					}),
				),
			),
		)
		.catch((cause: unknown): ActionResult => {
			console.error("pools: action failed", cause);
			return { ok: false, reason: "internal", message: "console failed before asking the gateway" };
		});

export const loadPools = createServerFn({ method: "GET" }).handler((): Promise<PoolsView> =>
	runtime
		.runPromise(
			Effect.gen(function* () {
				const host = yield* HostLabel;
				const result = yield* Effect.flatMap(ManagementApi, (api) => api.pools).pipe(
					Effect.map((pools) => ({ ok: true as const, pools })),
					Effect.catchTag("ManagementError", (error) =>
						Effect.logWarning("pools: management api failed", error.message).pipe(
							Effect.as({ ok: false as const, reason: error.reason, message: error.message }),
						),
					),
				);
				return { host, ...context(), result };
			}),
		)
		// Runtime construction (config, database) failing is a console fault, not a
		// gateway one. The cause goes to the server log, never to the browser.
		.catch((cause: unknown): PoolsView => {
			console.error("pools: runtime failed", cause);
			return {
				host: "unknown",
				...context(),
				result: {
					ok: false,
					reason: "internal",
					message: "console failed before asking the gateway",
				},
			};
		}),
);

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

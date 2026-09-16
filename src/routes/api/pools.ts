import { createFileRoute } from "@tanstack/react-router";
import { Effect } from "effect";

import { ManagementApi } from "#/server/management/api";
import { runtime } from "#/server/runtime";

// Normalised credentials for the pools screen. Faults carry their reason so the
// UI can pick the matching full-surface state.
export const Route = createFileRoute("/api/pools")({
	server: {
		handlers: {
			GET: async () => {
				const result = await runtime
					.runPromise(
						Effect.flatMap(ManagementApi, (api) => api.pools).pipe(
							Effect.map((pools) => ({ ok: true as const, status: 200, ...pools })),
							Effect.catchTag("ManagementError", (error) =>
								Effect.logWarning("pools: management api failed", error.message).pipe(
									Effect.as({
										ok: false as const,
										status: 502,
										reason: error.reason,
										message: error.message,
									}),
								),
							),
						),
					)
					// Layer construction (config, database) failing is a console fault, not a gateway one.
					.catch((cause: unknown) => ({
						ok: false as const,
						status: 500,
						reason: "internal" as const,
						message: cause instanceof Error ? cause.message : String(cause),
					}));
				const { status, ...body } = result;
				return Response.json(body, { status, headers: { "cache-control": "no-store" } });
			},
		},
	},
});

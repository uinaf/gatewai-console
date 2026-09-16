import { createFileRoute } from "@tanstack/react-router";

import { health, type Health } from "#/server/health";
import { runtime } from "#/server/runtime";

export const Route = createFileRoute("/healthz")({
	server: {
		handlers: {
			GET: async () => {
				const result = await runtime.runPromise(health).catch((cause: unknown): Health => {
					// Layer construction failed (unwritable /data, bad migration). Report, never throw.
					console.error("healthz: runtime failure", cause);
					return {
						ok: false,
						version: __APP_VERSION__,
						uptimeSeconds: Math.round(process.uptime()),
						db: "unreachable",
					};
				});
				return Response.json(result, {
					status: result.ok ? 200 : 503,
					headers: { "cache-control": "no-store" },
				});
			},
		},
	},
});

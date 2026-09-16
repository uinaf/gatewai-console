import { Effect } from "effect";
import { definePlugin } from "nitro";

import { runtime } from "#/server/runtime";

// Nitro loads route handlers lazily, so nothing touched the ManagedRuntime until
// the first request. This plugin runs when the server app is created and builds
// the layer, which starts the collector inside the proxy's 60 s retention.
export default definePlugin(() => {
	void runtime.runPromise(Effect.void).catch((cause: unknown) => {
		console.error("runtime: failed to start", cause);
	});
});

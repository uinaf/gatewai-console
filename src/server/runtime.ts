import { Effect, Layer, ManagedRuntime } from "effect";

import { Database } from "#/server/database";
import { Collector } from "#/server/ledger/collector";
import { ManagementApi } from "#/server/management/api";

const appMemoMap = Layer.makeMemoMapUnsafe();

export const runtime = ManagedRuntime.make(
	Layer.mergeAll(Database, ManagementApi.layer).pipe(
		Layer.merge(Collector.pipe(Layer.provide(Layer.mergeAll(Database, ManagementApi.layer)))),
	),
	{
		memoMap: appMemoMap,
	},
);

// Build the layer now, not on the first request: the collector must be popping
// within the proxy's 60 s retention from the moment the server boots.
void runtime.runPromise(Effect.void).catch((cause: unknown) => {
	console.error("runtime: failed to start", cause);
});

const shutdown = () => {
	void runtime.dispose();
};

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);

import { Layer, ManagedRuntime } from "effect";
import { FetchHttpClient } from "effect/unstable/http";

import { Database } from "#/server/database";
import { Collector } from "#/server/ledger/collector";
import { ManagementApi } from "#/server/management/api";

const appMemoMap = Layer.makeMemoMapUnsafe();

const services = Layer.mergeAll(Database, ManagementApi.layer);

// The collector needs the services plus an HttpClient for alert heartbeats and
// provides nothing; the memo map builds the shared layers once. The runtime is
// built at boot by the nitro plugin in `boot.ts`.
export const runtime = ManagedRuntime.make(
	Layer.merge(
		services,
		Collector.pipe(Layer.provide(Layer.merge(services, FetchHttpClient.layer))),
	),
	{ memoMap: appMemoMap },
);

const shutdown = () => {
	void runtime.dispose();
};

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);

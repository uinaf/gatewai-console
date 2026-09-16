import { Layer, ManagedRuntime } from "effect";

import { Database } from "#/server/database";
import { ManagementApi } from "#/server/management/api";

const appMemoMap = Layer.makeMemoMapUnsafe();

export const runtime = ManagedRuntime.make(Layer.mergeAll(Database, ManagementApi.layer), {
	memoMap: appMemoMap,
});

const shutdown = () => {
	void runtime.dispose();
};

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);

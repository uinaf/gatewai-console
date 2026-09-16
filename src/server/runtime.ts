import { Layer, ManagedRuntime } from "effect";

import { Database } from "#/server/database";

const appMemoMap = Layer.makeMemoMapUnsafe();

export const runtime = ManagedRuntime.make(Database, { memoMap: appMemoMap });

const shutdown = () => {
	void runtime.dispose();
};

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);

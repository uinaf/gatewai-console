import { defineConfig } from "vitest/config";

import pkg from "./package.json" with { type: "json" };

// Tests run without the Start and Nitro plugins: they only need path aliases and the version define.
export default defineConfig({
	resolve: { tsconfigPaths: true },
	define: { __APP_VERSION__: JSON.stringify(pkg.version) },
	test: { environment: "node" },
});

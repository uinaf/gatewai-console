import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";
import { defineConfig } from "vite-plus";

import pkg from "./package.json" with { type: "json" };

const ignorePatterns = [
	".agents/skills/**",
	".claude/skills/**",
	"dist/**",
	".output/**",
	"public/**",
	"src/routeTree.gen.ts",
];

export default defineConfig({
	resolve: { tsconfigPaths: true },
	define: { __APP_VERSION__: JSON.stringify(pkg.version) },
	plugins: [tanstackStart(), nitro({ plugins: ["./src/server/boot.ts"] }), viteReact()],
	fmt: {
		useTabs: true,
		singleQuote: false,
		semi: true,
		ignorePatterns,
	},
	lint: {
		ignorePatterns,
		options: {
			typeAware: true,
			typeCheck: true,
		},
		plugins: ["react"],
	},
	staged: {
		"*.{js,ts,tsx,json,md,css,yml,yaml}": "vp check --fix",
	},
});

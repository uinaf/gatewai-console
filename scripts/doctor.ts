// Read-only: is this checkout and its gateway worth driving? Never prints a secret.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

type Outcome = "ok" | "fail" | "skip";
const results: Array<[Outcome, string]> = [];
const report = (outcome: Outcome, message: string) => results.push([outcome, message]);

const wanted = readFileSync(".node-version", "utf8").trim();
const running = process.versions.node;
report(
	running === wanted ? "ok" : running.split(".")[0] === wanted.split(".")[0] ? "ok" : "fail",
	`node ${running} (.node-version ${wanted})${running === wanted ? "" : "; use the pinned version for parity"}`,
);

const packageManager = (
	JSON.parse(readFileSync("package.json", "utf8")) as { packageManager: string }
).packageManager;
try {
	const pnpm = execFileSync("pnpm", ["-v"], { encoding: "utf8" }).trim();
	report(
		`pnpm@${pnpm}` === packageManager ? "ok" : "fail",
		`pnpm ${pnpm} (packageManager ${packageManager})`,
	);
} catch {
	report("fail", "pnpm missing; `corepack enable` installs the pinned version");
}

try {
	execFileSync("docker", ["version", "--format", "{{.Server.Version}}"], { stdio: "ignore" });
	report("ok", "docker daemon reachable (needed for `pnpm run smoke`)");
} catch {
	report("skip", "docker not reachable; `pnpm run smoke` unavailable on this runner");
}

const env: Record<string, string> = {};
if (existsSync(".env.local")) {
	for (const line of readFileSync(".env.local", "utf8").split("\n")) {
		const match = /^([A-Z0-9_]+)=(.*)$/.exec(line);
		if (match?.[1] && match[2] !== undefined) env[match[1]] = match[2];
	}
	const missing = ["GATEWAI_MANAGEMENT_URL", "GATEWAI_MANAGEMENT_KEY"].filter((key) => !env[key]);
	report(
		missing.length === 0 ? "ok" : "fail",
		missing.length === 0
			? ".env.local has the management url and key"
			: `.env.local is missing ${missing.join(", ")}; run \`pnpm run env\``,
	);
} else {
	report("skip", "no .env.local; run `pnpm run env` to point dev at the t102 gateway");
}

const url = env.GATEWAI_MANAGEMENT_URL;
const key = env.GATEWAI_MANAGEMENT_KEY;
if (url && key) {
	try {
		const response = await fetch(`${url}/latest-version`, {
			headers: { authorization: `Bearer ${key}`, accept: "application/json" },
			signal: AbortSignal.timeout(5000),
		});
		const body = (await response.json().catch(() => ({}))) as { "latest-version"?: string };
		report(
			response.ok ? "ok" : "fail",
			response.ok
				? `gateway ${new URL(url).host} answers (proxy ${body["latest-version"] ?? "unknown"})`
				: `gateway ${new URL(url).host} returned ${response.status}; check the key against the proxy config`,
		);
	} catch (error) {
		report(
			"fail",
			`gateway ${new URL(url).host} unreachable (${error instanceof Error ? error.name : "error"}); is the tailnet up?`,
		);
	}
}

for (const [outcome, message] of results) console.log(`${outcome.padEnd(4)} ${message}`);
process.exit(results.some(([outcome]) => outcome === "fail") ? 1 : 0);

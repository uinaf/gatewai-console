// Runs the built image the way production does (read-only root, tmpfs /tmp,
// only /data writable) and proves the shipped server answers: /healthz reports
// the database reachable and / renders the shell. Owns and removes everything
// it starts; on failure the container log is the diagnostic.
import { execFileSync, spawnSync } from "node:child_process";
import { createServer } from "node:net";

const image = process.argv[2] ?? process.env.SMOKE_IMAGE ?? "gatewai-console:ci";
const id = `gatewai-smoke-${process.pid}`;
const docker = (args: ReadonlyArray<string>) =>
	execFileSync("docker", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

const freePort = (): Promise<number> =>
	new Promise((resolve, reject) => {
		const server = createServer();
		server.listen(0, "127.0.0.1", () => {
			const address = server.address();
			server.close(() =>
				typeof address === "object" && address
					? resolve(address.port)
					: reject(new Error("no port")),
			);
		});
	});

const cleanup = () => {
	spawnSync("docker", ["rm", "-f", id], { stdio: "ignore" });
	spawnSync("docker", ["volume", "rm", "-f", id], { stdio: "ignore" });
};

function fail(message: string): never {
	console.error(`smoke: ${message}`);
	const logs = spawnSync("docker", ["logs", id], { encoding: "utf8" });
	const text = `${logs.stdout}${logs.stderr}`.trim();
	if (logs.status === 0 && text) console.error(text);
	cleanup();
	process.exit(1);
}

const port = await freePort();
process.on("SIGINT", () => {
	cleanup();
	process.exit(130);
});
try {
	docker(["volume", "create", id]);
	docker([
		"run",
		"-d",
		"--name",
		id,
		"--read-only",
		"--tmpfs",
		"/tmp",
		"-v",
		`${id}:/data`,
		"-p",
		`127.0.0.1:${port}:8080`,
		image,
	]);
} catch (error) {
	fail(
		`could not start ${image}: ${error instanceof Error ? error.message.split("\n")[0] : error}`,
	);
}

const deadline = Date.now() + 30_000;
let health: { ok?: boolean; db?: string; version?: string } | undefined;
while (Date.now() < deadline) {
	try {
		const response = await fetch(`http://127.0.0.1:${port}/healthz`, {
			signal: AbortSignal.timeout(2000),
		});
		health = (await response.json()) as typeof health;
		if (response.ok) break;
	} catch {
		/* not up yet */
	}
	await new Promise((resolve) => setTimeout(resolve, 500));
}
if (!health?.ok || health.db !== "reachable")
	fail(`/healthz never became healthy: ${JSON.stringify(health)}`);

const page = await fetch(`http://127.0.0.1:${port}/`, {
	signal: AbortSignal.timeout(10_000),
}).catch(() => undefined);
const html = (await page?.text()) ?? "";
if (!page?.ok || !html.includes("gatewai-console"))
	fail(`/ returned ${page?.status ?? "no response"} without the shell`);
// Without a management key the pools page must land on the fault surface, not a 500.
if (!html.includes("fault"))
	fail("/ rendered without the fault surface even though no management key is configured");

const user = docker([
	"inspect",
	"--format",
	"{{.Config.User}} ro={{.HostConfig.ReadonlyRootfs}}",
	id,
]);
if (user !== "1000:1000 ro=true") fail(`container runs as ${user}, expected 1000:1000 ro=true`);

cleanup();
console.log(
	`smoke: ${image} ok (version ${health.version}, db reachable, fault surface without a key, ${user})`,
);

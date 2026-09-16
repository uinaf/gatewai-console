// Writes .env.local from the operator's 1Password vault so `vp dev` can reach
// the t102 gateway without anyone pasting a key. Values never reach stdout.
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";

const account = process.env.OP_ACCOUNT ?? "my.1password.com";
const items = {
	GATEWAI_MANAGEMENT_KEY: "op://uinaf/CLIProxyAPI/management",
	GATEWAI_CLIENT_BEARER: "op://uinaf/CLIProxyAPI/client-bearer",
};
const fixed = {
	GATEWAI_MANAGEMENT_URL: "https://gatewai-admin-t102.zebroid-skate.ts.net/v0/management",
	GATEWAI_HOST_LABEL: "t102",
};

const read = (ref: string): string => {
	try {
		return execFileSync("op", ["read", "--account", account, "--no-newline", ref], {
			encoding: "utf8",
			stdio: ["ignore", "pipe", "pipe"],
		});
	} catch (error) {
		const detail = error instanceof Error && "stderr" in error ? String(error.stderr).trim() : "";
		console.error(`env: cannot read ${ref} from 1Password (${account}).`);
		if (detail) console.error(`     ${detail.split("\n")[0]}`);
		console.error(
			"     recovery: install the 1Password CLI and run `op signin`, or set OP_ACCOUNT.",
		);
		process.exit(2);
	}
};

const lines = [
	...Object.entries(fixed).map(([key, value]) => `${key}=${value}`),
	...Object.entries(items).map(([key, ref]) => `${key}=${read(ref)}`),
];
writeFileSync(".env.local", `${lines.join("\n")}\n`, { mode: 0o600 });
console.log(
	`env: wrote .env.local (${Object.keys(fixed).length + Object.keys(items).length} keys, mode 600).`,
);

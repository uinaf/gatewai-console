// Writes .env.local from the operator's 1Password vault so `vp dev` can reach
// a gateway without anyone pasting a key. Values never reach stdout.
import { execFileSync } from "node:child_process";
import { chmodSync, writeFileSync } from "node:fs";

// Site facts come from the operator's shell, never from the repository:
//   OP_ACCOUNT              1Password account (defaults to the CLI's current one)
//   OP_ITEM                 op:// path of the item holding the fields below
//   GATEWAI_MANAGEMENT_URL  the gateway's management base url
//   GATEWAI_HOST_LABEL      short host label shown in the topbar
const account = process.env.OP_ACCOUNT;
const item = process.env.OP_ITEM;
const url = process.env.GATEWAI_MANAGEMENT_URL;
if (!item || !url) {
	console.error("env: set OP_ITEM (op://<vault>/<item>) and GATEWAI_MANAGEMENT_URL first.");
	process.exit(2);
}
const items = { GATEWAI_MANAGEMENT_KEY: `${item}/management` };
// Not read by the console; kept in .env.local for curl-ing the proxy as a client.
// Missing access is not an error.
const optional = { GATEWAI_CLIENT_BEARER: `${item}/client-bearer` };
const fixed = {
	GATEWAI_MANAGEMENT_URL: url,
	GATEWAI_HOST_LABEL: process.env.GATEWAI_HOST_LABEL ?? "local",
};

const tryRead = (ref: string): string | undefined => {
	try {
		return execFileSync(
			"op",
			["read", ...(account ? ["--account", account] : []), "--no-newline", ref],
			{
				encoding: "utf8",
				stdio: ["ignore", "pipe", "pipe"],
			},
		);
	} catch {
		return undefined;
	}
};

const read = (ref: string): string => {
	try {
		return execFileSync(
			"op",
			["read", ...(account ? ["--account", account] : []), "--no-newline", ref],
			{
				encoding: "utf8",
				stdio: ["ignore", "pipe", "pipe"],
			},
		);
	} catch (error) {
		const detail = error instanceof Error && "stderr" in error ? String(error.stderr).trim() : "";
		console.error(`env: cannot read ${ref} from 1Password${account ? ` (${account})` : ""}.`);
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
	...Object.entries(optional).flatMap(([key, ref]) => {
		const value = tryRead(ref);
		return value === undefined ? [] : [`${key}=${value}`];
	}),
];
writeFileSync(".env.local", `${lines.join("\n")}\n`, { mode: 0o600 });
// The mode above only applies when the file is created; tighten an existing one too.
chmodSync(".env.local", 0o600);
console.log(
	`env: wrote .env.local (${Object.keys(fixed).length + Object.keys(items).length} keys, mode 600).`,
);

import { useRouter } from "@tanstack/react-router";
import { useTransition } from "react";

import type { FaultReason } from "#/functions/pools";

const TITLES: Record<FaultReason, (host: string) => string> = {
	unreachable: (host) => `cannot reach the gateway on ${host}.`,
	unauthorized: (host) => `the gateway on ${host} rejected the management key.`,
	mismatch: (host) => `the gateway on ${host} answered in a shape this console does not know.`,
	status: (host) => `the gateway on ${host} returned an error.`,
	internal: () => `the console failed before asking the gateway.`,
};

const HINTS: Record<FaultReason, string> = {
	unreachable: "the management api is not answering.",
	unauthorized: "check the mounted key against the proxy config.",
	mismatch:
		"a proxy upgrade probably changed the management api. pin the version or update the schema.",
	status: "the proxy answered with a non-2xx status.",
	internal: "database or configuration failed to initialise; see the server log.",
};

export function Fault({
	reason,
	message,
	host,
}: {
	reason: FaultReason;
	message: string;
	host: string;
}) {
	const router = useRouter();
	const [pending, startTransition] = useTransition();
	return (
		<section className="fault u-panel u-ticks">
			<span className="u-label">fault</span>
			<h2>{TITLES[reason](host)}</h2>
			<p className="fault-hint">{HINTS[reason]}</p>
			<div className="u-log">
				<div className="row" data-err>
					<span className="lv">error</span>
					<span className="msg">{message}</span>
				</div>
			</div>
			<div className="fault-actions">
				<button
					type="button"
					className="u-btn u-btn--primary"
					disabled={pending}
					onClick={() => startTransition(() => router.invalidate())}
				>
					retry now
				</button>
			</div>
		</section>
	);
}

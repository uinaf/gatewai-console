import { useRouter } from "@tanstack/react-router";
import { useTransition } from "react";

import type { FaultReason } from "#/functions/pools";

const TITLES: Record<FaultReason, (host: string) => string> = {
	unreachable: (host) => `cannot reach the gateway on ${host}.`,
	unauthorized: (host) => `the gateway on ${host} rejected the management key.`,
	mismatch: (host) => `the gateway on ${host} answered in a shape this console does not know.`,
	status: (host) => `the gateway on ${host} returned an error.`,
	internal: () => `the console failed before asking the gateway.`,
	render: () => `the console failed to render this page.`,
};

const HINTS: Record<FaultReason, string> = {
	unreachable: "the management api is not answering.",
	unauthorized: "check the mounted key against the proxy config.",
	mismatch:
		"a proxy upgrade probably changed the management api. pin the version or update the schema.",
	status: "the proxy answered with a non-2xx status.",
	internal: "database or configuration failed to initialise; see the server log.",
	render: "retry, and if it repeats, the server log has the stack.",
};

export function Fault({
	reason,
	message,
	host,
	onRetry,
}: {
	reason: FaultReason;
	message: string;
	host: string;
	/** Replaces the loader reload; the root error boundary passes its reset. */
	onRetry?: () => void;
}) {
	const router = useRouter();
	const [pending, startTransition] = useTransition();
	const retry = onRetry ?? (() => router.invalidate());
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
					onClick={() => startTransition(() => retry())}
				>
					retry now
				</button>
			</div>
		</section>
	);
}

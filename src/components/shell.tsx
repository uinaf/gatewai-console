import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";

import { useNow } from "#/hooks/use-now";
import { ago } from "#/components/pools/format";

const STALE_AFTER_MS = 90_000;

interface StampProps {
	readonly observedAt: string | null;
	readonly serverNow: number;
}

function Stamp({ observedAt, serverNow, host }: StampProps & { host?: string }) {
	const now = useNow(serverNow);
	const observed = observedAt === null ? Number.NaN : Date.parse(observedAt);
	const stale = !Number.isFinite(observed) || now - observed > STALE_AFTER_MS;
	return (
		<span className="stamp" data-stale={stale || undefined}>
			<span className={stale ? "u-dot u-dot--warn" : "u-dot u-dot--ok"} />
			{host ? `${host} · ` : ""}
			{stale ? "stale · " : ""}
			{host ? ago(observedAt, now) : `observed ${ago(observedAt, now)}`}
		</span>
	);
}

export interface ShellProps {
	readonly host: string;
	readonly operator: string | null;
	readonly stamp?: StampProps;
	/** Page heading. Narrow screens carry the host and stamp beside it instead of in the topbar. */
	readonly title?: string;
	readonly headExtra?: ReactNode;
	readonly children: ReactNode;
}

const SECTIONS = [
	{ to: "/", label: "pools", live: true },
	{ to: "/ledger", label: "ledger", live: true },
	{ to: "/alerts", label: "alerts", live: true },
] as const;

export function Shell({ host, operator, stamp, title, headExtra, children }: ShellProps) {
	return (
		<div className="console-shell">
			<header className="u-topbar">
				<div className="u-shell-wide u-topbar-row">
					<a className="u-topbar-mark" href="/">
						<img src="https://cdn.uinaf.dev/images/uinaf-computer.png" alt="" />
						gatewai-console
					</a>
					<nav className="u-topbar-nav">
						{SECTIONS.map((section) =>
							section.live ? (
								<Link key={section.label} to={section.to} activeProps={{ "aria-current": "page" }}>
									{section.label}
								</Link>
							) : (
								<span key={section.label} className="nav-soon" title="not built yet">
									{section.label}
								</span>
							),
						)}
					</nav>
					<div className="u-topbar-actions">
						<span className="u-meta">
							{host}
							{operator ? <span className="operator"> · {operator}</span> : null}
						</span>
						{stamp ? (
							<>
								<span className="u-sep">·</span>
								<Stamp {...stamp} />
							</>
						) : null}
					</div>
				</div>
			</header>
			<main className="u-shell-wide console-main">
				{title ? (
					<div className="page-head">
						<h1>{title}</h1>
						{headExtra}
						{stamp ? (
							<span className="stamp-narrow">
								<Stamp {...stamp} host={host} />
							</span>
						) : null}
					</div>
				) : null}
				{children}
			</main>
		</div>
	);
}

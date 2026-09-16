import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";

import { useNow } from "#/hooks/use-now";
import { ago } from "#/components/pools/format";

const STALE_AFTER_MS = 90_000;

interface StampProps {
	readonly observedAt: string | null;
	readonly serverNow: number;
}

function Stamp({ observedAt, serverNow }: StampProps) {
	const now = useNow(serverNow);
	const stale = observedAt === null || now - Date.parse(observedAt) > STALE_AFTER_MS;
	return (
		<span className="stamp" data-stale={stale || undefined}>
			<span className={stale ? "u-dot u-dot--warn" : "u-dot u-dot--ok"} />
			{stale ? "stale · " : ""}observed {ago(observedAt, now)}
		</span>
	);
}

export interface ShellProps {
	readonly host: string;
	readonly operator: string | null;
	readonly stamp?: StampProps;
	readonly children: ReactNode;
}

const SECTIONS = [
	{ to: "/", label: "pools", live: true },
	{ to: "/ledger", label: "ledger", live: false },
	{ to: "/alerts", label: "alerts", live: false },
] as const;

export function Shell({ host, operator, stamp, children }: ShellProps) {
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
							{operator ? ` · ${operator}` : ""}
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
			<main className="u-shell-wide console-main">{children}</main>
		</div>
	);
}

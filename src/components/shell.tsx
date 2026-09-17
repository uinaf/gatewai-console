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
	// A fixed word keeps the topbar width constant; the ticking detail lives in the tooltip.
	const detail = `observed ${ago(observedAt, now)}`;
	return (
		<span
			className="stamp u-tip"
			data-stale={stale || undefined}
			data-tip={detail}
			tabIndex={0}
			aria-label={`${stale ? "stale" : "live"}, ${detail}`}
		>
			<span className={stale ? "u-dot u-dot--warn" : "u-dot u-dot--ok"} aria-hidden="true" />
			{host ? `${host} · ` : ""}
			<span className="stamp-word">{stale ? "stale" : "live"}</span>
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
	{ to: "/", label: "pools" },
	{ to: "/ledger", label: "ledger" },
	{ to: "/alerts", label: "alerts" },
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
						{SECTIONS.map((section) => (
							<Link key={section.label} to={section.to} activeProps={{ "aria-current": "page" }}>
								{section.label}
							</Link>
						))}
					</nav>
					<div className="u-topbar-actions">
						<span className="u-sep topbar-divider" aria-hidden="true">
							|
						</span>
						<span className="u-meta">
							{host}
							{operator ? <span> · {operator}</span> : null}
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

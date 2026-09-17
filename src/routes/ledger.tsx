import { createFileRoute, Link } from "@tanstack/react-router";

import { Breakdown } from "#/components/ledger/breakdown";
import { Fault } from "#/components/pools/fault";
import { QuotaHistory } from "#/components/ledger/quota-history";
import { LedgerStats } from "#/components/ledger/stats";
import { Shell } from "#/components/shell";
import { type LedgerQuery, loadLedger } from "#/functions/ledger";
import { useAutoRefresh } from "#/hooks/use-auto-refresh";
import { useNow } from "#/hooks/use-now";
import type { Dimension } from "#/server/ledger/queries";

const PRESETS = ["24h", "7d", "30d", "custom"] as const;
const DIMENSIONS = ["client", "model", "provider", "credential"] as const;

export const Route = createFileRoute("/ledger")({
	validateSearch: (search: Record<string, unknown>): Partial<LedgerQuery> => ({
		...(PRESETS.includes(search.preset as never) && search.preset !== "7d"
			? { preset: search.preset as LedgerQuery["preset"] }
			: {}),
		...(typeof search.from === "string" ? { from: search.from } : {}),
		...(typeof search.to === "string" ? { to: search.to } : {}),
		...(DIMENSIONS.includes(search.by as never) && search.by !== "client"
			? { by: search.by as Dimension }
			: {}),
		...(typeof search.credential === "string" ? { credential: search.credential } : {}),
	}),
	loaderDeps: ({ search }) => search,
	loader: ({ deps }) =>
		loadLedger({ data: { preset: deps.preset ?? "7d", by: deps.by ?? "client", ...deps } }),
	component: LedgerPage,
});

function LedgerPage() {
	const view = Route.useLoaderData();
	const search = Route.useSearch();
	const navigate = Route.useNavigate();
	const now = useNow(Date.parse(view.fetchedAt));
	useAutoRefresh(60_000);
	const preset = search.preset ?? "7d";
	const by = search.by ?? "client";

	if (!view.ok) {
		return (
			<Shell host={view.host} operator={view.operator} stamp={{ observedAt: null, serverNow: now }}>
				<Fault reason="internal" message={view.message} host={view.host} />
			</Shell>
		);
	}

	return (
		<Shell
			host={view.host}
			operator={view.operator}
			stamp={{ observedAt: view.observedAt, serverNow: now }}
			title="ledger"
			headExtra={
				<nav className="u-segmented" aria-label="range">
					{PRESETS.map((p) => (
						<Link
							key={p}
							to="/ledger"
							search={(prev) => ({ ...prev, preset: p === "7d" ? undefined : p })}
							aria-current={preset === p ? "true" : undefined}
						>
							{p}
						</Link>
					))}
				</nav>
			}
		>
			{preset === "custom" ? (
				<form
					key={`${search.from ?? ""}-${search.to ?? ""}`}
					className="ledger-custom"
					onSubmit={(event) => {
						event.preventDefault();
						const data = new FormData(event.currentTarget);
						void navigate({
							search: (prev) => ({
								...prev,
								preset: "custom",
								from: String(data.get("from") ?? ""),
								to: String(data.get("to") ?? ""),
							}),
						});
					}}
				>
					<label className="u-field">
						<span className="u-label">from</span>
						<input
							className="u-input"
							type="date"
							name="from"
							defaultValue={search.from?.slice(0, 10) ?? view.range.from.slice(0, 10)}
						/>
					</label>
					<label className="u-field">
						<span className="u-label">to</span>
						<input
							className="u-input"
							type="date"
							name="to"
							defaultValue={search.to?.slice(0, 10) ?? view.range.to.slice(0, 10)}
						/>
					</label>
					<button type="submit" className="u-btn u-btn--sm">
						apply
					</button>
				</form>
			) : null}
			{view.error ? <p className="u-meta range-note">collector: {view.error}</p> : null}

			<LedgerStats current={view.current} previous={view.previous} />

			<nav className="u-tabs ledger-tabs" aria-label="dimension">
				{DIMENSIONS.map((d) => (
					<Link
						key={d}
						to="/ledger"
						search={(prev) => ({ ...prev, by: d === "client" ? undefined : d })}
						aria-current={by === d ? "page" : undefined}
					>
						{d}
					</Link>
				))}
			</nav>
			<Breakdown by={view.by} rows={view.rows} />
			<p className="u-meta ledger-note">
				unknown api keys show as a 16-char fingerprint. aggregates only · raw records stay on{" "}
				{view.host}.
			</p>

			<section className="history-section">
				<div className="page-head">
					<div>
						<span className="u-label">quota history</span>
						<h2>
							{view.credentials.find((c) => c.name === view.credential)?.label ??
								"no credentials yet"}
						</h2>
					</div>
					{view.credentials.length > 0 ? (
						<nav className="u-segmented history-pick" aria-label="credential">
							{view.credentials.map((c) => (
								<Link
									key={c.name}
									to="/ledger"
									search={(prev) => ({ ...prev, credential: c.name })}
									aria-current={view.credential === c.name ? "true" : undefined}
								>
									{c.provider} · {c.label}
								</Link>
							))}
						</nav>
					) : null}
				</div>
				<QuotaHistory points={view.history} range={view.range} fetchedAt={view.fetchedAt} />
			</section>
		</Shell>
	);
}

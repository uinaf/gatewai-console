import { createFileRoute, Link } from "@tanstack/react-router";

import { span, stamp } from "#/components/alerts/format";
import { Fault } from "#/components/pools/fault";
import { credentialAnchor } from "#/components/pools/format";
import { Shell } from "#/components/shell";
import { PAGE_SIZE, loadAlerts } from "#/functions/alerts";
import { useAutoRefresh } from "#/hooks/use-auto-refresh";
import { useNow } from "#/hooks/use-now";

/** Pages 1 and `total`, the two on either side of `current`; `null` marks a skipped gap. */
export const pageWindow = (current: number, total: number): ReadonlyArray<number | null> => {
	const keep = new Set([1, total, current - 2, current - 1, current, current + 1, current + 2]);
	const out: Array<number | null> = [];
	for (let p = 1; p <= total; p += 1) {
		if (keep.has(p)) out.push(p);
		else if (out.at(-1) !== null) out.push(null);
	}
	return out;
};

export const Route = createFileRoute("/alerts")({
	validateSearch: (search: Record<string, unknown>): { page?: number } => {
		const page = Number(search.page);
		return Number.isInteger(page) && page > 1 ? { page } : {};
	},
	loaderDeps: ({ search }) => search,
	loader: ({ deps }) => loadAlerts({ data: { page: deps.page ?? 1 } }),
	component: AlertsPage,
});

function AlertsPage() {
	const view = Route.useLoaderData();
	const now = useNow(Date.parse(view.fetchedAt));
	useAutoRefresh(30_000);
	if (!view.ok) {
		return (
			<Shell
				host={view.host}
				operator={view.operator}
				stamp={{ observedAt: null, serverNow: now }}
				title="alerts"
			>
				<Fault reason="internal" message={view.message} host={view.host} />
			</Shell>
		);
	}
	const firing = view.rules.flatMap((rule) => rule.firing.map((f) => ({ rule, ...f })));
	const pages = Math.max(1, Math.ceil(view.total / PAGE_SIZE));
	const nowIso = new Date(now).toISOString();

	return (
		<Shell
			host={view.host}
			operator={view.operator}
			stamp={{ observedAt: view.observedAt, serverNow: now }}
			title="alerts"
		>
			{view.error ? (
				<p className="u-meta range-note" role="status">
					{view.error}
				</p>
			) : null}

			<section className="alerts-block">
				<span className="u-label">firing</span>
				{firing.length === 0 ? (
					<p className="u-meta alerts-empty">nothing firing.</p>
				) : (
					<div className="firing">
						{firing.map((f) => (
							<div key={`${f.rule.id}-${f.subject}`} className="firing-row">
								<div>
									<div className="firing-name">
										<span className="u-dot u-dot--error" />
										{f.rule.id}
									</div>
									<Link to="/" hash={credentialAnchor(f.subject)} className="u-meta firing-subject">
										{f.label} →
									</Link>
									<p className="u-meta firing-detail">{f.detail}</p>
								</div>
								<span className="u-meta firing-since">since {stamp(f.since)}</span>
							</div>
						))}
					</div>
				)}
			</section>

			<section className="alerts-block">
				<span className="u-label">rules</span>
				<div className="table-scroll">
					<table className="u-table rules-table">
						<thead>
							<tr>
								<th>rule</th>
								<th>scope</th>
								<th>condition</th>
								<th>now</th>
								<th className="nowrap">last fired</th>
							</tr>
						</thead>
						<tbody>
							{view.rules.map((rule) => {
								const [nearest, ...rest] = rule.clear;
								return (
									<tr key={rule.id} data-firing={rule.firing.length > 0 ? "" : undefined}>
										<td>{rule.id}</td>
										<td>{rule.scope}</td>
										<td>{rule.condition}</td>
										<td>
											{rule.firing.length > 0 ? (
												`firing · ${rule.firing[0]?.detail ?? ""}`
											) : nearest ? (
												<>
													{nearest.detail}
													{rest.length > 0 ? (
														<span title={rest.map((c) => c.detail).join("\n")}>
															{` · +${rest.length} more`}
														</span>
													) : null}
												</>
											) : (
												"—"
											)}
										</td>
										<td className="nowrap">{rule.lastFired ? stamp(rule.lastFired) : "—"}</td>
									</tr>
								);
							})}
						</tbody>
					</table>
				</div>
			</section>

			<section className="alerts-block">
				<span className="u-label">incidents</span>
				{view.incidents.length === 0 ? (
					<p className="u-meta alerts-empty">no incidents recorded.</p>
				) : (
					<div className="table-scroll">
						<table className="u-table incidents-table">
							<thead>
								<tr>
									<th>what</th>
									<th>credential</th>
									<th>rule</th>
									<th data-num>started</th>
									<th data-num>length</th>
								</tr>
							</thead>
							<tbody>
								{view.incidents.map((incident) => (
									<tr key={incident.id}>
										<td>
											<span className="incident-what">
												<span
													className={incident.ended_at ? "u-dot u-dot--warn" : "u-dot u-dot--error"}
												/>
												{incident.what}
											</span>
										</td>
										<td>
											<Link
												to="/"
												hash={credentialAnchor(incident.subject)}
												title={incident.subject}
											>
												{incident.label}
											</Link>
										</td>
										<td>{incident.rule_id}</td>
										<td data-num>{stamp(incident.started_at)}</td>
										<td data-num data-ongoing={incident.ended_at ? undefined : ""}>
											{incident.ended_at
												? span(incident.started_at, incident.ended_at)
												: `ongoing · ${span(incident.started_at, nowIso)}`}
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				)}
				{pages > 1 ? (
					<div className="pager-row">
						<span className="u-meta">
							{(view.page - 1) * PAGE_SIZE + 1}–{Math.min(view.total, view.page * PAGE_SIZE)} of{" "}
							{view.total}
						</span>
						<nav className="u-pager" aria-label="incident pages">
							{pageWindow(view.page, pages).map((p, i) =>
								p === null ? (
									<span key={`gap-${i}`} className="u-meta" aria-hidden="true">
										…
									</span>
								) : (
									<Link
										key={p}
										to="/alerts"
										search={p === 1 ? {} : { page: p }}
										aria-current={p === view.page ? "page" : undefined}
									>
										{String(p).padStart(2, "0")}
									</Link>
								),
							)}
						</nav>
					</div>
				) : null}
			</section>
		</Shell>
	);
}

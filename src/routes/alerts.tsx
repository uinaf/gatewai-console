import { createFileRoute, Link } from "@tanstack/react-router";

import { span, stamp } from "#/components/alerts/format";
import { Shell } from "#/components/shell";
import { PAGE_SIZE, loadAlerts } from "#/functions/alerts";
import { useAutoRefresh } from "#/hooks/use-auto-refresh";
import { useNow } from "#/hooks/use-now";

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
	const firing = view.rules.flatMap((rule) => rule.firing.map((f) => ({ rule, ...f })));
	const clear = view.rules.filter((rule) => rule.firing.length === 0);
	const pages = Math.max(1, Math.ceil(view.total / PAGE_SIZE));
	const nowIso = new Date(now).toISOString();

	return (
		<Shell
			host={view.host}
			operator={view.operator}
			stamp={{ observedAt: view.observedAt, serverNow: now }}
		>
			<h1>alerts</h1>
			{view.error ? <p className="u-meta range-note">{view.error}</p> : null}

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
									<p className="u-meta firing-detail">
										{f.rule.condition} · scope {f.rule.scope} · {f.detail}
									</p>
								</div>
								<span className="u-meta firing-since">since {stamp(f.since)}</span>
							</div>
						))}
					</div>
				)}
			</section>

			<section className="alerts-block">
				<div className="page-head">
					<span className="u-label">clear rules</span>
					<span className="u-meta">read-only · edit alerts.json on {view.host}</span>
				</div>
				<div className="table-scroll">
					<table className="u-table rules-table">
						<thead>
							<tr>
								<th>rule</th>
								<th>scope</th>
								<th>condition</th>
								<th>delivery</th>
								<th data-num>clear since</th>
								<th data-num>last fired</th>
							</tr>
						</thead>
						<tbody>
							{clear.map((rule) => (
								<tr key={rule.id}>
									<td>{rule.id}</td>
									<td>{rule.scope}</td>
									<td>{rule.condition}</td>
									<td>{rule.delivers ? "heartbeat" : "console only"}</td>
									<td data-num>{stamp(rule.clearSince)}</td>
									<td data-num>{stamp(rule.lastFired)}</td>
								</tr>
							))}
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
									<th>subject</th>
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
										<td>{incident.subject}</td>
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
							{Array.from({ length: pages }, (_, i) => i + 1).map((p) => (
								<Link
									key={p}
									to="/alerts"
									search={p === 1 ? {} : { page: p }}
									aria-current={p === view.page ? "page" : undefined}
								>
									{String(p).padStart(2, "0")}
								</Link>
							))}
						</nav>
					</div>
				) : null}
			</section>
		</Shell>
	);
}

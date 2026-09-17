import { Link } from "@tanstack/react-router";

import { compact, count, delta, percent, seconds } from "#/components/ledger/format";
import { credentialAnchor } from "#/components/pools/format";
import type { BreakdownRow, Dimension } from "#/server/ledger/queries";

// Model share is a stacked bar per row. Each model takes the next viz series
// colour in legend order (the palette wraps after five), segments carry a
// title, and the legend names every model so identity is never colour alone.

const HEADINGS: Record<Dimension, string> = {
	client: "client",
	model: "model",
	provider: "provider",
	credential: "credential",
	effort: "reasoning effort",
	tier: "service tier",
	agent: "user agent",
};

export function Breakdown({
	by,
	rows,
	comparable,
}: {
	by: Dimension;
	rows: ReadonlyArray<BreakdownRow>;
	/** False hides the per-row deltas: the previous range predates collection. */
	comparable: boolean;
}) {
	// Keyed by model and provider: the same model id can be served by two providers.
	const models = new Map<string, { model: string; provider: string }>();
	for (const row of rows) for (const s of row.share) models.set(`${s.provider}/${s.model}`, s);
	const seriesOf = new Map([...models.keys()].map((id, index) => [id, index % 5]));
	if (rows.length === 0) return <p className="u-meta ledger-empty">no requests in range.</p>;
	return (
		<>
			<div className="u-legend ledger-legend">
				{[...models].map(([id, { model, provider }]) => (
					<span key={id}>
						<i data-series={seriesOf.get(id)} />
						{model}
						{[...models.values()].filter((m) => m.model === model).length > 1
							? ` (${provider})`
							: ""}
					</span>
				))}
			</div>
			<div className="table-scroll">
				<table className="u-table ledger-table">
					<thead>
						<tr>
							<th>{HEADINGS[by]}</th>
							<th data-num>requests</th>
							<th data-num>error rate</th>
							<th data-num>tokens</th>
							<th data-num>cached</th>
							<th data-num>latency p50 (s)</th>
							<th data-num>latency p95 (s)</th>
							<th data-num>ttft p50 (s)</th>
							<th className="share-head">model share</th>
						</tr>
					</thead>
					<tbody>
						{rows.map((row) => (
							<tr key={row.key}>
								<td>
									{by === "credential" && row.name ? (
										<Link to="/" hash={credentialAnchor(row.name)}>
											{row.label}
										</Link>
									) : (
										row.label
									)}
								</td>
								<td data-num>
									{count(row.requests)}
									{comparable ? (
										<>
											<br />
											<span className="u-meta">{delta(row.requests, row.previousRequests)}</span>
										</>
									) : null}
								</td>
								<td data-num data-bad={row.errorRate >= 0.05 || undefined}>
									{percent(row.errorRate)}
								</td>
								<td
									data-num
									title={`in ${compact(row.tokensInput)} · cached ${compact(row.cached)} · cache write ${compact(row.tokensCacheWrite)} · out ${compact(row.tokensOutput)} · reasoning ${compact(row.tokensReasoning)}`}
								>
									{compact(row.tokens)}
									{comparable ? (
										<>
											<br />
											<span className="u-meta">{delta(row.tokens, row.previousTokens)}</span>
										</>
									) : null}
								</td>
								<td data-num>{compact(row.cached)}</td>
								<td data-num>{seconds(row.p50)}</td>
								<td data-num>{seconds(row.p95)}</td>
								<td data-num>{seconds(row.ttftP50)}</td>
								<td>
									<div
										className="u-stack share"
										role="img"
										aria-label={row.share
											.map((s) => `${s.model} ${percent(s.share, 0)}`)
											.join(", ")}
									>
										{row.share.map((s) => {
											const width = `${s.share * 100}%`;
											return (
												<i
													key={`${s.provider}/${s.model}`}
													data-series={seriesOf.get(`${s.provider}/${s.model}`)}
													style={{ width }}
													title={`${s.model} · ${percent(s.share, 0)}`}
												/>
											);
										})}
									</div>
								</td>
							</tr>
						))}
					</tbody>
				</table>
			</div>
		</>
	);
}

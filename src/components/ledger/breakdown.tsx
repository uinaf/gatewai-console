import { compact, count, delta, millis, percent } from "#/components/ledger/format";
import type { BreakdownRow, Dimension } from "#/server/ledger/queries";

// Model share is a stacked bar per row; segments carry the provider hue and a
// title, and the legend above names every model so identity is never colour alone.

const HEADINGS: Record<Dimension, string> = {
	client: "client",
	model: "model",
	provider: "provider",
	credential: "credential",
};

export function Breakdown({ by, rows }: { by: Dimension; rows: ReadonlyArray<BreakdownRow> }) {
	const models = new Map<string, string>();
	for (const row of rows) for (const s of row.share) models.set(s.model, s.provider);
	if (rows.length === 0) return <p className="u-meta ledger-empty">no requests in range.</p>;
	return (
		<>
			<div className="u-legend ledger-legend">
				{[...models].map(([model, provider]) => (
					<span key={model}>
						<i data-provider={provider} />
						{model}
					</span>
				))}
			</div>
			<div className="table-scroll">
				<table className="u-table ledger-table">
					<thead>
						<tr>
							<th>{HEADINGS[by]}</th>
							<th data-num>requests</th>
							<th data-num>err</th>
							<th data-num>tokens</th>
							<th data-num>cached</th>
							<th data-num>p50</th>
							<th data-num>p95</th>
							<th data-num>ttft p50</th>
							<th className="share-head">model share</th>
						</tr>
					</thead>
					<tbody>
						{rows.map((row) => (
							<tr key={row.key}>
								<td>{row.label}</td>
								<td data-num>
									{count(row.requests)}
									<br />
									<span className="u-meta">{delta(row.requests, row.previousRequests)}</span>
								</td>
								<td data-num data-bad={row.errorRate >= 0.05 || undefined}>
									{percent(row.errorRate)}
								</td>
								<td data-num>
									{compact(row.tokens)}
									<br />
									<span className="u-meta">{delta(row.tokens, row.previousTokens)}</span>
								</td>
								<td data-num>{compact(row.cached)}</td>
								<td data-num>{millis(row.p50)}</td>
								<td data-num>{millis(row.p95)}</td>
								<td data-num>{millis(row.ttftP50)}</td>
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
													key={s.model}
													data-provider={s.provider}
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

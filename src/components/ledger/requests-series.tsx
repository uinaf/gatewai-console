import { stamp } from "#/components/alerts/format";
import { count, dayTick, hourTick } from "#/components/ledger/format";
import type { Range, SeriesBucket } from "#/server/ledger/queries";

// Requests per bucket as bars, failed stacked on ok, scaled to the busiest
// bucket. The width, x() mapping, and tick rule match quota-history.tsx so
// the bars sit over the drain that caused them; the table carries the same numbers.

const WIDTH = 1000;
const HEIGHT = 100;
const HOUR_MS = 3_600_000;

export function RequestsSeries({
	series,
	range,
	fetchedAt,
}: {
	series: ReadonlyArray<SeriesBucket>;
	range: Range;
	fetchedAt: string;
}) {
	const from = Date.parse(range.from);
	const to = Date.parse(range.to);
	const x = (ms: number) => Math.max(0, Math.min(WIDTH, ((ms - from) / (to - from)) * WIDTH));
	const first = series[0];
	const second = series[1];
	const step = first && second ? Date.parse(second.at) - Date.parse(first.at) : to - from;
	const unit = step === HOUR_MS ? "hour" : "day";
	const peak = Math.max(1, ...series.map((b) => b.requests));
	const total = series.reduce((sum, b) => sum + b.requests, 0);
	const failed = series.reduce((sum, b) => sum + b.failed, 0);
	const spanDays = (to - from) / 86_400_000;
	const ticks = Array.from({ length: 5 }, (_, i) =>
		new Date(from + ((to - from) * i) / 4).toISOString(),
	);
	const tick = spanDays > 2 ? dayTick : hourTick;
	// Presets end at the request time; a custom range ends where the operator said.
	const endsNow = Math.abs(to - Date.parse(fetchedAt)) < 60_000;

	if (total === 0) return <p className="u-meta ledger-empty">no requests in range.</p>;

	return (
		<div className="series">
			<div className="history-plot series-plot">
				<div className="history-y">
					<span className="u-meta">{count(peak)}</span>
					<span className="u-meta">0</span>
				</div>
				<div className="history-svg">
					<svg
						className="u-chart series-chart"
						viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
						preserveAspectRatio="none"
						role="img"
						aria-label={`${count(total)} requests, ${count(failed)} failed, per ${unit}`}
					>
						{series.map((b) => {
							const start = Date.parse(b.at);
							// Edge buckets are clipped to the range: the query only counts inside it.
							const x0 = x(Math.max(from, start));
							const width = Math.max(0, x(Math.min(to, start + step)) - x0 - 1);
							const ok = b.requests - b.failed;
							const okHeight = (ok / peak) * HEIGHT;
							const failedHeight = (b.failed / peak) * HEIGHT;
							return (
								<g key={b.at}>
									<title>{`${stamp(b.at)} · ${count(ok)} ok · ${count(b.failed)} failed`}</title>
									<rect
										className="ok"
										x={x0}
										y={HEIGHT - okHeight}
										width={width}
										height={okHeight}
									/>
									<rect
										className="failed"
										x={x0}
										y={HEIGHT - okHeight - failedHeight}
										width={width}
										height={failedHeight}
									/>
								</g>
							);
						})}
					</svg>
					<div className="u-axis">
						{ticks.map((t, i) => (
							<span key={t}>{i === ticks.length - 1 && endsNow ? "now" : tick(t)}</span>
						))}
					</div>
				</div>
			</div>
			<div className="u-legend history-legend series-legend">
				<span>
					<i data-ok aria-hidden="true" />
					ok
				</span>
				<span>
					<i data-failed aria-hidden="true" />
					failed · stacked on top
				</span>
				<span className="u-meta">one bar per {unit}</span>
			</div>
			<details className="history-table">
				<summary className="u-meta">buckets as a table</summary>
				<table className="u-table">
					<thead>
						<tr>
							<th>{unit}</th>
							<th data-num>requests</th>
							<th data-num>failed</th>
						</tr>
					</thead>
					<tbody>
						{series.map((b) => (
							<tr key={b.at}>
								<td>{stamp(b.at)}</td>
								<td data-num>{count(b.requests)}</td>
								<td data-num>{count(b.failed)}</td>
							</tr>
						))}
					</tbody>
				</table>
			</details>
		</div>
	);
}

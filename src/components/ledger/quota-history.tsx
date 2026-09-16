import { useState } from "react";

import { dayTick, hourTick } from "#/components/ledger/format";
import type { QuotaPoint, Range } from "#/server/ledger/queries";

// Used percent over time per window, one line each; a reset is a drop to the
// new value drawn as a dashed vertical. Crosshair tooltip lists every window at
// the nearest observation; the table view below carries the same numbers.

const WIDTH = 1000;
const HEIGHT = 200;
const SERIES = ["weekly", "5-hour"] as const;

interface Series {
	readonly label: string;
	readonly dash: string | undefined;
	readonly points: ReadonlyArray<QuotaPoint>;
}

export function QuotaHistory({
	points,
	range,
}: {
	points: ReadonlyArray<QuotaPoint>;
	range: Range;
}) {
	const [hover, setHover] = useState<number | null>(null);
	const from = Date.parse(range.from);
	const to = Date.parse(range.to);
	const x = (iso: string) =>
		Math.max(0, Math.min(WIDTH, ((Date.parse(iso) - from) / (to - from)) * WIDTH));
	const y = (used: number) => HEIGHT - (used / 100) * HEIGHT;

	const series: Array<Series> = SERIES.flatMap((label) => {
		const own = points.filter((p) => p.label === label);
		return own.length > 0
			? [{ label, dash: label === "5-hour" ? "4 3" : undefined, points: own }]
			: [];
	});
	const observations = [...new Set(points.map((p) => p.at))].sort();
	const path = (own: ReadonlyArray<QuotaPoint>) =>
		own
			.map((p, i) => {
				const px = x(p.at);
				// A reset drops vertically: the old value ends and the new one starts at the same x.
				return `${i === 0 ? "M" : p.reset ? "L" : "L"}${px.toFixed(1)},${y(p.usedPercent).toFixed(1)}`;
			})
			.join(" ");
	const resets = points.filter((p) => p.reset);
	const spanDays = (to - from) / 86_400_000;
	const ticks = Array.from({ length: 5 }, (_, i) =>
		new Date(from + ((to - from) * i) / 4).toISOString(),
	);
	const tick = spanDays > 2 ? dayTick : hourTick;

	const onMove = (event: React.PointerEvent<SVGSVGElement>) => {
		if (observations.length === 0) return;
		const rect = event.currentTarget.getBoundingClientRect();
		const at = from + ((event.clientX - rect.left) / rect.width) * (to - from);
		let best = 0;
		for (let i = 1; i < observations.length; i += 1) {
			if (
				Math.abs(Date.parse(observations[i]!) - at) < Math.abs(Date.parse(observations[best]!) - at)
			)
				best = i;
		}
		setHover(best);
	};
	const hovered = hover === null ? null : (observations[hover] ?? null);
	const readout = hovered
		? series.map((s) => {
				const latest = s.points.filter((p) => p.at <= hovered).at(-1);
				return { label: s.label, dash: s.dash, value: latest?.usedPercent ?? null };
			})
		: [];

	if (points.length === 0)
		return <p className="u-meta ledger-empty">no quota observations in range.</p>;

	return (
		<div className="history">
			<div className="history-plot">
				<div className="history-y">
					{[100, 75, 50, 25, 0].map((v) => (
						<span key={v} className="u-meta">
							{v}
						</span>
					))}
				</div>
				<div className="history-svg">
					<svg
						className="u-chart history-chart"
						viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
						preserveAspectRatio="none"
						role="img"
						aria-label="used percent over time per quota window"
						onPointerMove={onMove}
						onPointerLeave={() => setHover(null)}
					>
						{[25, 50, 75].map((v) => (
							<line key={v} className="grid" x1="0" y1={y(v)} x2={WIDTH} y2={y(v)} />
						))}
						{resets.map((p) => (
							<line
								key={`${p.label}-${p.at}`}
								className="reset"
								x1={x(p.at)}
								y1="0"
								x2={x(p.at)}
								y2={HEIGHT}
							/>
						))}
						{series.map((s) => (
							<path
								key={s.label}
								className="line"
								data-window={s.label}
								strokeDasharray={s.dash}
								d={path(s.points)}
							/>
						))}
						{hovered ? (
							<line className="crosshair" x1={x(hovered)} y1="0" x2={x(hovered)} y2={HEIGHT} />
						) : null}
					</svg>
					<div className="u-axis">
						{ticks.map((t, i) => (
							<span key={t}>{i === ticks.length - 1 ? "now" : tick(t)}</span>
						))}
					</div>
					{hovered ? (
						<div className="history-tip" role="status">
							<span className="u-meta">{hovered.slice(0, 16).replace("T", " ")}z</span>
							{readout.map((r) => (
								<span key={r.label}>
									<strong>{r.value === null ? "—" : `${r.value}%`}</strong> {r.label}
								</span>
							))}
						</div>
					) : null}
				</div>
			</div>
			<div className="u-legend history-legend">
				{series.map((s) => (
					<span key={s.label}>
						<span
							className="key"
							data-window={s.label}
							data-dashed={s.dash ? "" : undefined}
							aria-hidden="true"
						/>
						{s.label} · used %
					</span>
				))}
				<span className="u-meta">┆ reset — drop to the new value</span>
			</div>
			<details className="history-table">
				<summary className="u-meta">observations as a table</summary>
				<table className="u-table">
					<thead>
						<tr>
							<th>observed</th>
							<th>window</th>
							<th data-num>used</th>
							<th>reset</th>
						</tr>
					</thead>
					<tbody>
						{points.map((p) => (
							<tr key={`${p.at}-${p.label}`}>
								<td>{p.at.slice(0, 16).replace("T", " ")}z</td>
								<td>{p.label}</td>
								<td data-num>{p.usedPercent}%</td>
								<td>{p.reset ? "yes" : ""}</td>
							</tr>
						))}
					</tbody>
				</table>
			</details>
		</div>
	);
}

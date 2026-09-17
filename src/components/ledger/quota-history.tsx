import { useState } from "react";

import { stamp } from "#/components/alerts/format";
import { dayTick, hourTick } from "#/components/ledger/format";
import type { QuotaPoint, Range } from "#/server/ledger/queries";

// Used percent over time per window, one line each; a reset is a drop to the
// new value drawn as a dashed vertical. Crosshair tooltip lists every window at
// the nearest observation; the table view below carries the same numbers.

const WIDTH = 1000;
const HEIGHT = 200;
// Every window the normaliser reported gets a line: the two standard ones keep
// their fixed hue and dash, named model families follow in a fixed order with
// their own hue and dash so identity never rests on colour alone.
const DASHES = [undefined, "4 3", "1 3", "6 2 1 2", "2 2"];

interface Series {
	readonly label: string;
	readonly index: number;
	readonly dash: string | undefined;
	readonly points: ReadonlyArray<QuotaPoint>;
}

export function QuotaHistory({
	points,
	range,
	fetchedAt,
}: {
	points: ReadonlyArray<QuotaPoint>;
	range: Range;
	fetchedAt: string;
}) {
	const [hover, setHover] = useState<string | null>(null);
	const from = Date.parse(range.from);
	const to = Date.parse(range.to);
	const x = (iso: string) =>
		Math.max(0, Math.min(WIDTH, ((Date.parse(iso) - from) / (to - from)) * WIDTH));
	const y = (used: number) => HEIGHT - (used / 100) * HEIGHT;

	const labels = [...new Set(points.map((p) => p.label))].sort((a, b) => {
		const rank = (l: string) => (l === "weekly" ? 0 : l === "5-hour" ? 1 : 2);
		return rank(a) - rank(b) || a.localeCompare(b);
	});
	const series: Array<Series> = labels.map((label, index) => ({
		label,
		index: Math.min(index, DASHES.length - 1),
		dash: DASHES[Math.min(index, DASHES.length - 1)],
		points: points.filter((p) => p.label === label),
	}));
	const observations = [...new Set(points.map((p) => p.at))].sort();
	// A reset drops vertically at its timestamp; the last known value extends to the range end.
	const path = (own: ReadonlyArray<QuotaPoint>) => {
		const parts: Array<string> = [];
		let previous: number | null = null;
		for (const p of own) {
			const px = x(p.at).toFixed(1);
			if (parts.length === 0) parts.push(`M${px},${y(p.usedPercent).toFixed(1)}`);
			else {
				if (p.reset && previous !== null) parts.push(`L${px},${y(previous).toFixed(1)}`);
				parts.push(`L${px},${y(p.usedPercent).toFixed(1)}`);
			}
			previous = p.usedPercent;
		}
		if (previous !== null) parts.push(`L${WIDTH},${y(previous).toFixed(1)}`);
		return parts.join(" ");
	};
	const resets = points.filter((p) => p.reset);
	const spanDays = (to - from) / 86_400_000;
	const ticks = Array.from({ length: 5 }, (_, i) =>
		new Date(from + ((to - from) * i) / 4).toISOString(),
	);
	const tick = spanDays > 2 ? dayTick : hourTick;
	// Presets end at the request time; a custom range ends where the operator said.
	const endsNow = Math.abs(to - Date.parse(fetchedAt)) < 60_000;

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
		setHover(observations[best] ?? null);
	};
	const hovered = hover !== null && observations.includes(hover) ? hover : null;
	const readout = hovered
		? series.map((s) => {
				const latest = s.points.filter((p) => p.at <= hovered).at(-1);
				return { label: s.label, index: s.index, dash: s.dash, value: latest?.usedPercent ?? null };
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
								data-series={s.index}
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
							<span key={t}>{i === ticks.length - 1 && endsNow ? "now" : tick(t)}</span>
						))}
					</div>
					{hovered ? (
						<div className="history-tip" aria-hidden="true">
							<span className="u-meta">{stamp(hovered)}</span>
							{readout.map((r) => (
								<span key={r.label}>
									<span
										className="key"
										data-series={r.index}
										data-dashed={r.dash ? "" : undefined}
										aria-hidden="true"
									/>
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
							data-series={s.index}
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
								<td>{stamp(p.at)}</td>
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

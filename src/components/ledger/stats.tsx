import { compact, count, delta, percent, pointsDelta } from "#/components/ledger/format";
import type { Summary } from "#/server/ledger/queries";

export function LedgerStats({ current, previous }: { current: Summary; previous: Summary }) {
	const rate = current.requests === 0 ? 0 : current.failed / current.requests;
	const previousRate = previous.requests === 0 ? 0 : previous.failed / previous.requests;
	return (
		<div className="u-panel-grid stats">
			<div className="u-stat">
				<span className="u-label">requests</span>
				<span className="u-stat-value" title={count(current.requests)}>
					{compact(current.requests)}
				</span>
				<span className="u-stat-note">
					{delta(current.requests, previous.requests) || "no change"} · {count(previous.requests)}{" "}
					previous
				</span>
			</div>
			<div className="u-stat">
				<span className="u-label">error rate</span>
				<span className="u-stat-value">{percent(rate)}</span>
				<span className="u-stat-note">
					{pointsDelta(rate, previousRate)} · {percent(previousRate)} previous
				</span>
			</div>
			<div className="u-stat">
				<span className="u-label">tokens</span>
				<span className="u-stat-value">{compact(current.tokens)}</span>
				<span className="u-stat-note">
					{delta(current.tokens, previous.tokens) || "no change"} · {compact(current.cached)} of it
					cached
				</span>
			</div>
		</div>
	);
}

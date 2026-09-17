import { compact, count, delta, percent, pointsDelta } from "#/components/ledger/format";
import type { Summary } from "#/server/ledger/queries";

const note = (parts: ReadonlyArray<string | null>): string => parts.filter(Boolean).join(" · ");

export function LedgerStats({
	current,
	previous,
	comparable,
}: {
	current: Summary;
	previous: Summary;
	/** False hides every delta: the previous range predates collection. */
	comparable: boolean;
}) {
	const rate = current.requests === 0 ? 0 : current.failed / current.requests;
	const previousRate = previous.requests === 0 ? 0 : previous.failed / previous.requests;
	const requestsNote = comparable
		? note([
				delta(current.requests, previous.requests) || "no change",
				`${count(previous.requests)} previous`,
			])
		: "";
	const rateNote = comparable
		? note([pointsDelta(rate, previousRate), `${percent(previousRate)} previous`])
		: "";
	const tokensNote = note([
		comparable ? delta(current.tokens, previous.tokens) || "no change" : null,
		`${compact(current.cached)} of it cached`,
	]);
	return (
		<div className="u-panel-grid stats">
			<div className="u-stat">
				<span className="u-label">requests</span>
				<span className="u-stat-value" title={count(current.requests)}>
					{compact(current.requests)}
				</span>
				{requestsNote ? <span className="u-stat-note">{requestsNote}</span> : null}
			</div>
			<div className="u-stat">
				<span className="u-label">error rate</span>
				<span className="u-stat-value">{percent(rate)}</span>
				{rateNote ? <span className="u-stat-note">{rateNote}</span> : null}
			</div>
			<div className="u-stat">
				<span className="u-label">tokens</span>
				<span className="u-stat-value">{compact(current.tokens)}</span>
				<span className="u-stat-note">{tokensNote}</span>
			</div>
		</div>
	);
}

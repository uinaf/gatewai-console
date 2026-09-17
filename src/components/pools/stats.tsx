import { resetsIn } from "#/components/pools/format";
import type { ProviderSummary } from "#/server/management/credential";

export function Stats({
	summaries,
	now,
}: {
	summaries: ReadonlyArray<ProviderSummary>;
	now: number;
}) {
	return (
		<div className="u-panel-grid stats">
			{summaries.map((summary) => (
				<div key={summary.provider} className="u-stat">
					<span className="u-label stat-label">
						<span className="u-dot" data-provider={summary.provider} />
						{summary.provider}
					</span>
					<span className="u-stat-value">
						{summary.worst ? `${summary.worst.remainingPercent}%` : "—"}
					</span>
					<span className="u-stat-note stat-detail">
						{summary.worst
							? `${summary.worst.label} · resets ${resetsIn(summary.worst.resetsAt, now) || "—"} · ${summary.cooling} cooling`
							: `${summary.accounts} accounts · no quota signal`}
					</span>
				</div>
			))}
		</div>
	);
}

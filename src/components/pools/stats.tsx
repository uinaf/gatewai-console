import type { ProviderSummary } from "#/server/management/credential";

export function Stats({ summaries }: { summaries: ReadonlyArray<ProviderSummary> }) {
	return (
		<div className="u-panel-grid stats">
			{summaries.map((summary) => (
				<div key={summary.provider} className="u-stat">
					<span className="u-label stat-label">
						<span className="u-dot" data-provider={summary.provider} />
						{summary.provider}
					</span>
					<span className="u-stat-value">
						{summary.remainingPercent === null ? "—" : `${summary.remainingPercent}%`}
					</span>
					<span className="u-stat-note stat-detail">
						{summary.accounts} {summary.accounts === 1 ? "account" : "accounts"} · {summary.cooling}{" "}
						cooling · {summary.requestsLastHour} req last hour
					</span>
				</div>
			))}
		</div>
	);
}

import { resetsIn } from "#/components/pools/format";

export interface QuotaMeterProps {
	readonly label: string;
	readonly usedPercent: number;
	readonly resetsAt: string | null;
	readonly status: string;
	readonly provider: string;
	readonly now: number;
	readonly secondary?: boolean;
}

export function QuotaMeter({
	label,
	usedPercent,
	resetsAt,
	status,
	provider,
	now,
	secondary,
}: QuotaMeterProps) {
	const width = `${usedPercent}%`;
	// Requests fail now: say so in text and in the name, not only in the fill colour.
	const flagged = status === "limited" || status === "rejected";
	return (
		<div className="meter" data-secondary={secondary || undefined} data-status={status}>
			<span className="meter-label">{label}</span>
			<span
				className="meter-track"
				role="img"
				aria-label={`${label} ${usedPercent}% used${flagged ? `, ${status}` : ""}`}
			>
				<span className="meter-fill" data-provider={provider} style={{ width }} />
			</span>
			<span className="meter-value">
				{usedPercent}%{flagged ? <span className="meter-flag"> · {status}</span> : null}
			</span>
			<span className="meter-reset">{resetsIn(resetsAt, now)}</span>
		</div>
	);
}

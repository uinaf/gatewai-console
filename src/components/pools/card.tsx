import { useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState, useTransition } from "react";

import { Buckets } from "#/components/pools/buckets";
import { calendar, credits } from "#/components/pools/format";
import { ProviderMark } from "#/components/pools/marks";
import { QuotaMeter } from "#/components/pools/quota-meter";
import {
	type ActionResult,
	refreshCredential,
	resetCooldown,
	setWebsockets,
} from "#/functions/pools";
import type { Credential } from "#/server/management/credential";

const STATUS_DOT: Record<Credential["status"], string> = {
	active: "u-dot u-dot--ok",
	cooling: "u-dot u-dot--error",
	disabled: "u-dot",
	error: "u-dot u-dot--warn",
};

function footnote(credential: Credential): string | null {
	const cooldown = credential.cooldowns[0];
	if (credential.status === "cooling" && cooldown) {
		const scope = cooldown.model ? ` for ${cooldown.model}` : "";
		const until = cooldown.until ? ` until ${calendar(cooldown.until)}` : "";
		// Rendered in the viewer's zone; see card-note's suppressHydrationWarning.
		return `cooldown${scope}${until}.`;
	}
	if (credential.status === "disabled") return "disabled. requests route to the other accounts.";
	if (credential.status === "error") return credential.statusMessage ?? "gateway reports an error.";
	return null;
}

export function CredentialCard({ credential, now }: { credential: Credential; now: number }) {
	const router = useRouter();
	const reset = useServerFn(resetCooldown);
	const refresh = useServerFn(refreshCredential);
	const websockets = useServerFn(setWebsockets);
	const [pending, startTransition] = useTransition();
	const [failure, setFailure] = useState<string | null>(null);

	// A rejected runbook action stays on the card until the next action succeeds.
	const act = (label: string, action: () => Promise<ActionResult>) =>
		startTransition(async () => {
			const result = await action();
			setFailure(result.ok ? null : `${label} failed: ${result.message}`);
			await router.invalidate();
		});

	const { quota } = credential;
	const creditsLine = quota.credits
		? `credits ${quota.credits.unlimited ? "unlimited" : credits(quota.credits.balance)}`
		: null;
	const meta: Array<string> = [];
	if (quota.overage) meta.push(`overage ${quota.overage}`);
	if (credential.provider === "xai") meta.push("xai reports no quota");
	const note = footnote(credential);

	return (
		<article
			className="card u-panel"
			data-status={credential.status}
			aria-busy={pending || undefined}
		>
			<header className="card-head">
				<ProviderMark provider={credential.provider} />
				<div className="card-title">
					<div className="card-name">{credential.label}</div>
					<div className="card-tags">
						{credential.plan ? <span className="u-tag">{credential.plan}</span> : null}
						{credential.websockets ? <span className="u-tag">ws</span> : null}
					</div>
				</div>
				<span className="card-status" data-status={credential.status}>
					<span className={STATUS_DOT[credential.status]} />
					{credential.status}
				</span>
			</header>

			{quota.windows.length > 0 ? (
				<div className="meters">
					{quota.windows.map((window, index) => (
						<QuotaMeter
							key={window.label}
							{...window}
							provider={credential.provider}
							now={now}
							secondary={index > 1}
						/>
					))}
				</div>
			) : null}

			<div className="card-meta">
				<span className="u-meta">
					{creditsLine ? <span className="card-credits">{creditsLine}</span> : null}
					{creditsLine && meta.length > 0 ? <span className="card-credits"> · </span> : null}
					{meta.join(" · ")}
				</span>
				<span className="u-meta">
					{credential.success} ok · {credential.failed} failed
				</span>
			</div>

			<Buckets buckets={credential.recentRequests} />

			<footer className="card-foot" data-note={failure || note ? "" : undefined}>
				{failure || note ? (
					<p
						className="u-meta card-note"
						role={failure ? "alert" : undefined}
						data-failure={failure ? "" : undefined}
						// The cooldown date is formatted in the viewer's zone, which the server cannot know.
						suppressHydrationWarning
					>
						{failure ?? note}
					</p>
				) : null}
				<div className="card-actions">
					{credential.status === "cooling" ? (
						<button
							type="button"
							className="u-btn u-btn--sm"
							disabled={pending}
							onClick={() =>
								act("reset cooldown", () => reset({ data: { authIndex: credential.authIndex } }))
							}
						>
							reset cooldown
						</button>
					) : null}
					<button
						type="button"
						className="card-action"
						disabled={pending}
						onClick={() => act("refresh", () => refresh({ data: { name: credential.name } }))}
					>
						refresh
					</button>
					{credential.websockets !== null ? (
						<button
							type="button"
							className="card-action"
							disabled={pending}
							aria-pressed={credential.websockets}
							onClick={() =>
								act("websockets", () =>
									websockets({ data: { name: credential.name, enabled: !credential.websockets } }),
								)
							}
						>
							ws {credential.websockets ? "on" : "off"}
						</button>
					) : null}
				</div>
			</footer>
		</article>
	);
}

import { Link, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState, useTransition } from "react";

import { Buckets } from "#/components/pools/buckets";
import { stamp } from "#/components/alerts/format";
import { credentialAnchor, credits } from "#/components/pools/format";
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
		return cooldown.until ? `cooldown until ${stamp(cooldown.until)}.` : "cooling down.";
	}
	if (credential.status === "disabled") return "disabled. requests route to the other accounts.";
	if (credential.status === "error") return credential.statusMessage ?? "gateway reports an error.";
	return null;
}

export function CredentialCard({
	credential,
	now,
	landed,
}: {
	credential: Credential;
	now: number;
	landed: boolean;
}) {
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
	const note = footnote(credential);

	return (
		<article
			id={credentialAnchor(credential.name)}
			className="card u-panel"
			data-status={credential.status}
			data-landed={landed || undefined}
			aria-busy={pending || undefined}
		>
			<header className="card-head">
				<ProviderMark provider={credential.provider} />
				<div className="card-title">
					<div className="card-name">{credential.label}</div>
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

			{creditsLine ? (
				<div className="card-meta">
					<span className="u-meta card-credits">{creditsLine}</span>
				</div>
			) : null}

			<Buckets buckets={credential.recentRequests} />

			<footer className="card-foot" data-note={failure || note ? "" : undefined}>
				{failure || note ? (
					<p
						className="u-meta card-note"
						role={failure ? "alert" : undefined}
						data-failure={failure ? "" : undefined}
					>
						{failure ?? note}
					</p>
				) : null}
				<div className="card-actions">
					<Link to="/ledger" search={{ credential: credential.name }} className="card-action">
						history →
					</Link>
					{credential.status === "cooling" ? (
						<button
							type="button"
							className="u-btn u-btn--sm"
							disabled={pending}
							aria-label={`reset cooldown for ${credential.label}`}
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
						aria-label={`refresh ${credential.label}`}
						onClick={() => act("refresh", () => refresh({ data: { name: credential.name } }))}
					>
						refresh
					</button>
					{credential.websockets !== null ? (
						<button
							type="button"
							className="card-action"
							disabled={pending}
							aria-label={`websockets for ${credential.label}`}
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

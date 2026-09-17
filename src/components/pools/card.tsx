import { Link, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { type KeyboardEvent, useState, useTransition } from "react";

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
	const [outcome, setOutcome] = useState<{ kind: "ok" | "failed"; text: string } | null>(null);
	const [confirming, setConfirming] = useState(false);

	// The last runbook outcome stays on the card until the next action starts. Buttons stay
	// enabled while pending so keyboard focus survives; `act` ignores the repeat click instead.
	const act = (label: string, action: () => Promise<ActionResult>) => {
		if (pending) return;
		setOutcome(null);
		startTransition(async () => {
			const result = await action();
			setOutcome(
				result.ok
					? { kind: "ok", text: `${label} done.` }
					: { kind: "failed", text: `${label} failed: ${result.message}` },
			);
			await router.invalidate();
		});
	};
	const cancelOnEscape = (event: KeyboardEvent<HTMLButtonElement>) => {
		if (event.key === "Escape") setConfirming(false);
	};

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

			<footer className="card-foot" data-note={outcome || note ? "" : undefined}>
				{outcome || note ? (
					<p
						className="u-meta card-note"
						role={outcome ? (outcome.kind === "failed" ? "alert" : "status") : undefined}
						data-failure={outcome?.kind === "failed" ? "" : undefined}
					>
						{outcome?.text ?? note}
					</p>
				) : null}
				<div className="card-actions">
					<Link to="/ledger" search={{ credential: credential.name }} className="card-action">
						history →
					</Link>
					{credential.status === "cooling" ? (
						<>
							<button
								type="button"
								className="u-btn u-btn--sm"
								aria-disabled={pending || undefined}
								aria-label={`${confirming ? "confirm reset cooldown" : "reset cooldown"} for ${credential.label}`}
								onKeyDown={cancelOnEscape}
								onClick={() => {
									if (!confirming) {
										setConfirming(true);
										return;
									}
									setConfirming(false);
									act("reset cooldown", () => reset({ data: { authIndex: credential.authIndex } }));
								}}
							>
								{confirming ? "confirm reset" : "reset cooldown"}
							</button>
							{confirming ? (
								<button
									type="button"
									className="card-action"
									onKeyDown={cancelOnEscape}
									onClick={() => setConfirming(false)}
								>
									cancel
								</button>
							) : null}
						</>
					) : null}
					<button
						type="button"
						className="card-action"
						aria-disabled={pending || undefined}
						aria-label={`refresh ${credential.label}`}
						onClick={() => act("refresh", () => refresh({ data: { name: credential.name } }))}
					>
						refresh
					</button>
					{credential.websockets !== null ? (
						<button
							type="button"
							className="card-action"
							aria-disabled={pending || undefined}
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

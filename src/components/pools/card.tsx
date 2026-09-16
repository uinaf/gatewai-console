import { useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useTransition } from "react";

import { Buckets } from "#/components/pools/buckets";
import { calendar, credits } from "#/components/pools/format";
import { ProviderMark } from "#/components/pools/marks";
import { QuotaMeter } from "#/components/pools/quota-meter";
import { refreshCredential, resetCooldown, setWebsockets } from "#/functions/pools";
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

	const act = (action: () => Promise<unknown>) =>
		startTransition(async () => {
			await action();
			await router.invalidate();
		});

	const { quota } = credential;
	const meta: Array<string> = [];
	if (quota.credits)
		meta.push(`credits ${quota.credits.unlimited ? "unlimited" : credits(quota.credits.balance)}`);
	if (quota.overage) meta.push(`overage ${quota.overage}`);
	if (credential.provider === "xai") meta.push("no quota headers from xai");
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
				<span className="u-meta">{meta.join(" · ")}</span>
				<span className="u-meta">
					{credential.success} ok · {credential.failed} failed
				</span>
			</div>

			<Buckets buckets={credential.recentRequests} />

			<footer className="card-foot">
				<p className="u-meta card-note">{note}</p>
				<div className="card-actions">
					{credential.status === "cooling" ? (
						<button
							type="button"
							className="u-btn u-btn--sm"
							disabled={pending}
							onClick={() => act(() => reset({ data: { authIndex: credential.authIndex } }))}
						>
							reset cooldown
						</button>
					) : null}
					<button
						type="button"
						className="u-btn u-btn--sm u-btn--ghost"
						disabled={pending}
						onClick={() => act(() => refresh({ data: { name: credential.name } }))}
					>
						refresh
					</button>
					{credential.websockets !== null ? (
						<button
							type="button"
							className="u-btn u-btn--sm u-btn--ghost"
							disabled={pending}
							aria-pressed={credential.websockets}
							onClick={() =>
								act(() =>
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

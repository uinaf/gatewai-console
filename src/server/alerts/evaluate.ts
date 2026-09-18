import { stamp } from "#/components/alerts/format";
import type { Rule } from "#/server/alerts/rules";
import type { Credential } from "#/server/management/credential";

// Pure evaluation of rules against one observation. Hysteresis lives here:
// a threshold rule fires when remaining drops below the line and clears only
// once remaining is back above the line plus a margin (or the window reset),
// so jitter around the line never refires.

const CLEAR_MARGIN = 5;

export interface Condition {
	readonly ruleId: string;
	readonly subject: string;
	readonly what: string;
	readonly detail: string;
	/** Present value the rule compares; null for boolean conditions. */
	readonly remaining: number | null;
}

export interface Observation {
	readonly credentials: ReadonlyArray<Credential>;
	readonly lastPopAt: string | null;
	/** When the collector started; a fresh process is not stalled until it has had its minutes. */
	readonly startedAt: string | null;
	readonly now: string;
}

const inScope = (rule: Rule, credential: Credential): boolean => {
	const scope = rule.scope ?? "all";
	if (scope === "all") return true;
	if (scope.startsWith("provider:")) return credential.provider === scope.slice(9);
	return credential.name === scope.slice(11);
};

/** Every (rule, subject) pair the rule applies to, with whether it currently fires. */
export const evaluate = (
	rules: ReadonlyArray<Rule>,
	observation: Observation,
	wasFiring: (ruleId: string, subject: string) => boolean,
): ReadonlyArray<{ readonly condition: Condition; readonly firing: boolean }> =>
	rules.flatMap((rule) => {
		if (rule.kind === "stalled") {
			// The later of the last pop and the start: a restart earns its window even with an old pop.
			const anchor =
				[observation.lastPopAt, observation.startedAt]
					.filter((v): v is string => v !== null)
					.sort()
					.at(-1) ?? null;
			const age = anchor
				? (Date.parse(observation.now) - Date.parse(anchor)) / 60_000
				: Number.POSITIVE_INFINITY;
			return [
				{
					condition: {
						ruleId: rule.id,
						subject: "collector",
						what: "collector stalled",
						detail: observation.lastPopAt ? `last pop ${observation.lastPopAt}` : "never popped",
						remaining: null,
					},
					firing: age > rule.minutes,
				},
			];
		}
		return observation.credentials
			.filter((c) => inScope(rule, c))
			.flatMap((credential): Array<{ condition: Condition; firing: boolean }> => {
				switch (rule.kind) {
					case "remaining": {
						const window = credential.quota.windows.find((w) => w.label === rule.window);
						if (!window) return [];
						const remaining = 100 - window.usedPercent;
						const before = wasFiring(rule.id, credential.name);
						const firing = before
							? remaining < rule.remainingBelow + CLEAR_MARGIN
							: remaining < rule.remainingBelow;
						return [
							{
								condition: {
									ruleId: rule.id,
									subject: credential.name,
									what: `${rule.window} ${remaining <= 0 ? "exhausted" : "low"}`,
									detail: `${rule.window} remaining ${remaining}% on ${credential.label}`,
									remaining,
								},
								firing,
							},
						];
					}
					case "cooldown": {
						const cooldown = credential.cooldowns[0];
						return [
							{
								condition: {
									ruleId: rule.id,
									subject: credential.name,
									what: "cooldown",
									detail: cooldown
										? [
												credential.label,
												cooldown.model,
												cooldown.until ? `until ${stamp(cooldown.until)}` : null,
											]
												.filter(Boolean)
												.join(" · ")
										: `${credential.label} not cooling`,
									remaining: null,
								},
								firing: credential.status === "cooling",
							},
						];
					}
					case "unhealthy":
						return [
							{
								condition: {
									ruleId: rule.id,
									subject: credential.name,
									what:
										credential.status === "disabled"
											? "disabled"
											: credential.status === "limited"
												? "rate limited"
												: "refresh failed",
									detail: `${credential.label} ${credential.status}${credential.statusMessage ? `: ${credential.statusMessage}` : ""}`,
									remaining: null,
								},
								firing:
									credential.status === "disabled" ||
									credential.status === "error" ||
									credential.status === "limited",
							},
						];
					default:
						return [];
				}
			});
	});

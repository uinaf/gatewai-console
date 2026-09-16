import { readFileSync } from "node:fs";

import { Config, Effect, Schema } from "effect";

// Rules come from a checked-in JSON file mounted read-only; the UI never edits
// them. Each rule may name a Better Stack heartbeat: firing posts `/fail`,
// clearing posts the plain URL, so hosts need heartbeat URLs and never the
// Uptime API token.

const Scope = Schema.String.pipe(
	Schema.check(
		Schema.isPattern(/^(all|provider:[a-z0-9-]+|credential:.+)$/, {
			description: "all, provider:<name>, or credential:<file name>",
		}),
	),
);

const common = {
	id: Schema.String.pipe(Schema.check(Schema.isPattern(/^[a-z0-9][a-z0-9-]*$/))),
	scope: Schema.optionalKey(Scope),
	heartbeat: Schema.optionalKey(Schema.String),
};

export const Rule = Schema.Union([
	Schema.Struct({
		...common,
		kind: Schema.Literal("remaining"),
		window: Schema.String,
		remainingBelow: Schema.Number.pipe(
			Schema.check(Schema.isBetween({ minimum: 0, maximum: 100 })),
		),
	}),
	Schema.Struct({ ...common, kind: Schema.Literal("cooldown") }),
	Schema.Struct({ ...common, kind: Schema.Literal("unhealthy") }),
	Schema.Struct({
		...common,
		kind: Schema.Literal("stalled"),
		minutes: Schema.Number.pipe(Schema.check(Schema.isGreaterThan(0))),
	}),
]);
export type Rule = typeof Rule.Type;

const RulesFile = Schema.Struct({ rules: Schema.Array(Rule) }).pipe(
	Schema.check(
		Schema.makeFilter((file) => new Set(file.rules.map((r) => r.id)).size === file.rules.length, {
			description: "rule ids must be unique",
		}),
	),
);

export const describe = (rule: Rule): string => {
	switch (rule.kind) {
		case "remaining":
			return `${rule.window} remaining below ${rule.remainingBelow}%`;
		case "cooldown":
			return "credential entered cooldown";
		case "unhealthy":
			return "credential disabled or failed refresh";
		case "stalled":
			return `no records for ${rule.minutes}m`;
	}
};

export const scopeLabel = (rule: Rule): string =>
	rule.kind === "stalled"
		? "collector"
		: rule.scope === undefined || rule.scope === "all"
			? "all credentials"
			: rule.scope;

/** Rules from `GATEWAI_ALERTS_FILE`; an absent or broken file means no rules and a warning. */
export const AlertRules = Config.String("GATEWAI_ALERTS_FILE").pipe(
	Config.withDefault(""),
	Effect.filterOrFail(
		(file) => file !== "",
		() => new Error("unset"),
	),
	Effect.flatMap((file) =>
		Effect.try({
			try: () => JSON.parse(readFileSync(file, "utf8")) as unknown,
			catch: (cause) =>
				new Error(`cannot read ${file}: ${cause instanceof Error ? cause.message : cause}`),
		}),
	),
	Effect.flatMap(Schema.decodeUnknownEffect(RulesFile)),
	Effect.map((parsed): ReadonlyArray<Rule> => parsed.rules),
	Effect.catch((error) =>
		(error instanceof Error && error.message === "unset"
			? Effect.void
			: Effect.logWarning("alerts: rules unavailable", String(error))
		).pipe(Effect.as<ReadonlyArray<Rule>>([])),
	),
);

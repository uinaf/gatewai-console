import { createServerFn } from "@tanstack/react-start";
import { getRequestHeader } from "@tanstack/react-start/server";
import { Config, Effect } from "effect";

import { AlertRules, describe, scopeLabel } from "#/server/alerts/rules";
import { type AlertState, type Incident, listIncidents, readStates } from "#/server/alerts/store";
import { readCollectorState } from "#/server/ledger/store";
import { runtime } from "#/server/runtime";

export const PAGE_SIZE = 20;

export interface RuleView {
	readonly id: string;
	readonly scope: string;
	readonly condition: string;
	readonly delivers: boolean;
	readonly firing: ReadonlyArray<{ subject: string; detail: string; since: string }>;
	readonly clearSince: string | null;
	readonly lastFired: string | null;
}

export type AlertsView = AlertsLoaded | AlertsFault;

interface AlertsFault {
	readonly ok: false;
	readonly host: string;
	readonly operator: null;
	readonly fetchedAt: string;
	readonly message: string;
}

interface AlertsLoaded {
	readonly ok: true;
	readonly host: string;
	readonly operator: string | null;
	readonly fetchedAt: string;
	readonly observedAt: string | null;
	readonly rules: ReadonlyArray<RuleView>;
	readonly incidents: ReadonlyArray<Incident>;
	readonly total: number;
	readonly page: number;
	readonly error: string | null;
}

const HostLabel = Config.String("GATEWAI_HOST_LABEL").pipe(Config.withDefault("local"));

const pageOf = (input: unknown): { page: number } => {
	const raw =
		(typeof input === "object" && input !== null ? (input as { page?: unknown }).page : 1) ?? 1;
	const page = Number(raw);
	return { page: Number.isInteger(page) && page >= 1 ? page : 1 };
};

const latest = (values: ReadonlyArray<string | null>): string | null =>
	values.reduce<string | null>((best, v) => (v && (!best || v > best) ? v : best), null);

export const loadAlerts = createServerFn({ method: "GET" })
	.validator(pageOf)
	.handler(({ data }): Promise<AlertsView> =>
		runtime
			.runPromise(
				Effect.gen(function* () {
					const host = yield* HostLabel;
					const fetchedAt = new Date().toISOString();
					const rules = yield* AlertRules;
					const states = yield* readStates;
					const { rows, total } = yield* listIncidents(data.page, PAGE_SIZE);
					const collector = yield* readCollectorState;
					const byRule = new Map<string, Array<AlertState>>();
					for (const s of states) byRule.set(s.rule_id, [...(byRule.get(s.rule_id) ?? []), s]);
					return {
						ok: true as const,
						host,
						operator: getRequestHeader("tailscale-user-login") ?? null,
						fetchedAt,
						observedAt: collector.lastSnapshotAt,
						rules: rules.map((rule): RuleView => {
							const own = byRule.get(rule.id) ?? [];
							const firing = own.filter((s) => s.firing === 1);
							return {
								id: rule.id,
								scope: scopeLabel(rule),
								condition: describe(rule),
								delivers: rule.heartbeat !== undefined,
								firing: firing.map((s) => ({
									subject: s.subject,
									detail: s.detail ?? "",
									since: s.since ?? fetchedAt,
								})),
								clearSince: firing.length > 0 ? null : latest(own.map((s) => s.since)),
								lastFired: latest(own.map((s) => s.last_fired)),
							};
						}),
						incidents: rows,
						total,
						page: data.page,
						error: rules.length === 0 ? "no rules loaded; set GATEWAI_ALERTS_FILE" : null,
					};
				}),
			)
			.catch((cause: unknown): AlertsView => {
				console.error("alerts: runtime failed", cause);
				return {
					ok: false,
					host: "unknown",
					operator: null,
					fetchedAt: new Date().toISOString(),
					message: "console failed before reading the alerts",
				};
			}),
	);

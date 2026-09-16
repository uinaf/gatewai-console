import { Effect } from "effect";
import { SqlClient } from "effect/unstable/sql";

import { deliver } from "#/server/alerts/deliver";
import { sendEmail } from "#/server/alerts/email";
import { evaluate } from "#/server/alerts/evaluate";
import { AlertRules } from "#/server/alerts/rules";
import { applyCondition, clearMissing, readStates } from "#/server/alerts/store";
import { readCollectorState } from "#/server/ledger/store";
import type { Pools } from "#/server/management/credential";

// One evaluation pass: rules × credentials → state transitions → heartbeat
// posts. Better Stack expects a ping every period, so every pass posts each
// rule's current state: `/fail` while any subject fires, the plain URL when
// none does. A subject that vanished from the pool clears.

/**
 * `pools` is null when the gateway could not be read: only collector rules run
 * then, and credential subjects are left as they were rather than cleared.
 */
export const runAlerts = (pools: Pools | null, now: string) =>
	Effect.gen(function* () {
		const sql = yield* SqlClient.SqlClient;
		const rules = yield* AlertRules;
		if (rules.length === 0) return { fired: 0, cleared: 0 };
		const states = yield* readStates;
		const collector = yield* readCollectorState;
		const wasFiring = (ruleId: string, subject: string) =>
			states.some((s) => s.rule_id === ruleId && s.subject === subject && s.firing === 1);
		const applicable = pools ? rules : rules.filter((r) => r.kind === "stalled");
		const results = evaluate(
			applicable,
			{
				credentials: pools?.credentials ?? [],
				lastPopAt: collector.lastPopAt,
				startedAt: collector.startedAt,
				now,
			},
			wasFiring,
		);
		let fired = 0;
		let cleared = 0;
		const seen = new Set<string>();
		for (const { condition, firing } of results) {
			seen.add(`${condition.ruleId}\u0000${condition.subject}`);
			const transition = yield* applyCondition(condition, firing, now);
			if (transition === "none") continue;
			if (transition === "fired") fired += 1;
			else cleared += 1;
			// One mail per crossing; a failed send is logged and not retried, the
			// heartbeat and the console keep the state.
			yield* sendEmail({
				subject: `[gatewai] ${transition === "fired" ? "firing" : "clear"}: ${condition.ruleId} · ${condition.subject}`,
				text: `${condition.what}\n\n${condition.detail}\n\nrule ${condition.ruleId}\nsubject ${condition.subject}\nat ${now}\n`,
			}).pipe(
				Effect.catch((error) =>
					Effect.logWarning("alerts: email delivery failed", condition.ruleId, String(error)),
				),
			);
		}
		if (pools) cleared += yield* clearMissing(seen, now);
		for (const rule of rules) {
			if (!rule.heartbeat) continue;
			const firingRows = yield* sql<{ detail: string | null }>`
				SELECT detail FROM alert_state WHERE rule_id = ${rule.id} AND firing = 1`;
			const detail =
				firingRows
					.map((row) => row.detail)
					.filter(Boolean)
					.join("\n") || rule.id;
			yield* deliver(rule.heartbeat, firingRows.length > 0, detail).pipe(
				Effect.catch((error) =>
					Effect.logWarning("alerts: heartbeat delivery failed", rule.id, String(error)),
				),
			);
		}
		return { fired, cleared };
	});

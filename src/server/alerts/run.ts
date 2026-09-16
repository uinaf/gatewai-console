import { Effect } from "effect";
import { SqlClient } from "effect/unstable/sql";

import { deliver } from "#/server/alerts/deliver";
import { evaluate } from "#/server/alerts/evaluate";
import { AlertRules } from "#/server/alerts/rules";
import { applyCondition, markDelivered, readStates } from "#/server/alerts/store";
import { readCollectorState } from "#/server/ledger/store";
import type { Pools } from "#/server/management/credential";

// One evaluation pass: rules × credentials → state transitions → heartbeat
// posts. A rule's heartbeat is failed while any subject fires and resolved
// when none does; undelivered transitions retry on the next pass.

export const runAlerts = (pools: Pools, now: string) =>
	Effect.gen(function* () {
		const sql = yield* SqlClient.SqlClient;
		const rules = yield* AlertRules;
		if (rules.length === 0) return { fired: 0, cleared: 0 };
		const states = yield* readStates;
		const collector = yield* readCollectorState;
		const wasFiring = (ruleId: string, subject: string) =>
			states.some((s) => s.rule_id === ruleId && s.subject === subject && s.firing === 1);
		const results = evaluate(
			rules,
			{
				credentials: pools.credentials,
				lastPopAt: collector.lastPopAt,
				startedAt: collector.startedAt,
				now,
			},
			wasFiring,
		);
		let fired = 0;
		let cleared = 0;
		for (const { condition, firing } of results) {
			const transition = yield* applyCondition(condition, firing, now);
			if (transition === "fired") fired += 1;
			if (transition === "cleared") cleared += 1;
		}
		// Deliver per rule from the stored state so a failed post retries next pass.
		const pending = yield* sql<{
			rule_id: string;
			subject: string;
			firing: number;
			detail: string | null;
		}>`
			SELECT rule_id, subject, firing, detail FROM alert_state WHERE delivered = 0`;
		for (const row of pending) {
			const rule = rules.find((r) => r.id === row.rule_id);
			if (!rule?.heartbeat) {
				yield* markDelivered(row.rule_id, row.subject);
				continue;
			}
			const anyFiring = yield* sql<{ n: number }>`SELECT count(*) AS n FROM alert_state
				WHERE rule_id = ${row.rule_id} AND firing = 1`;
			const ruleFiring = (anyFiring[0]?.n ?? 0) > 0;
			yield* deliver(rule.heartbeat, ruleFiring, row.detail ?? row.rule_id).pipe(
				Effect.andThen(markDelivered(row.rule_id, row.subject)),
				Effect.catch((error) =>
					Effect.logWarning("alerts: heartbeat delivery failed", row.rule_id, String(error)),
				),
			);
		}
		return { fired, cleared };
	});

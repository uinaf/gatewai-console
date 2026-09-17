import { Effect } from "effect";
import { SqlClient } from "effect/unstable/sql";

import type { Condition } from "#/server/alerts/evaluate";

export interface AlertState {
	readonly rule_id: string;
	readonly subject: string;
	readonly firing: number;
	readonly since: string | null;
	readonly last_fired: string | null;
	readonly detail: string | null;
}

export const readStates = Effect.gen(function* () {
	const sql = yield* SqlClient.SqlClient;
	return yield* sql<AlertState>`SELECT * FROM alert_state ORDER BY rule_id, subject`;
});

type Transition = "fired" | "cleared" | "none";

/** Applies one evaluated condition; opens or closes an incident on a crossing. */
export const applyCondition = (condition: Condition, firing: boolean, now: string) =>
	Effect.gen(function* () {
		const sql = yield* SqlClient.SqlClient;
		return yield* sql.withTransaction(applyConditionUnsafe(sql, condition, firing, now));
	});

const applyConditionUnsafe = (
	sql: SqlClient.SqlClient,
	condition: Condition,
	firing: boolean,
	now: string,
) =>
	Effect.gen(function* () {
		const [current] = yield* sql<AlertState>`SELECT * FROM alert_state
			WHERE rule_id = ${condition.ruleId} AND subject = ${condition.subject}`;
		const was = (current?.firing ?? 0) === 1;
		if (firing && !was) {
			yield* sql`INSERT INTO alert_state ${sql.insert({
				rule_id: condition.ruleId,
				subject: condition.subject,
				firing: 1,
				since: now,
				last_fired: now,
				detail: condition.detail,
			})} ON CONFLICT (rule_id, subject) DO UPDATE SET
				firing = 1, since = excluded.since, last_fired = excluded.last_fired,
				detail = excluded.detail`;
			yield* sql`INSERT INTO alert_incidents ${sql.insert({
				rule_id: condition.ruleId,
				subject: condition.subject,
				what: condition.what,
				detail: condition.detail,
				started_at: now,
				ended_at: null,
			})}`;
			return "fired" as Transition;
		}
		if (!firing && was) {
			yield* sql`UPDATE alert_state SET firing = 0, since = ${now}, detail = ${condition.detail}
				WHERE rule_id = ${condition.ruleId} AND subject = ${condition.subject}`;
			yield* sql`UPDATE alert_incidents SET ended_at = ${now}
				WHERE rule_id = ${condition.ruleId} AND subject = ${condition.subject} AND ended_at IS NULL`;
			return "cleared" as Transition;
		}
		if (!current) {
			yield* sql`INSERT INTO alert_state ${sql.insert({
				rule_id: condition.ruleId,
				subject: condition.subject,
				firing: 0,
				since: now,
				last_fired: null,
				detail: condition.detail,
			})}`;
		} else {
			yield* sql`UPDATE alert_state SET detail = ${condition.detail}
				WHERE rule_id = ${condition.ruleId} AND subject = ${condition.subject}`;
		}
		return "none" as Transition;
	});

/** Clears every stored pair the current observation no longer emits (credential gone). */
export const clearMissing = (seen: ReadonlySet<string>, now: string) =>
	Effect.gen(function* () {
		const sql = yield* SqlClient.SqlClient;
		const firing = yield* sql<{ rule_id: string; subject: string }>`
			SELECT rule_id, subject FROM alert_state WHERE firing = 1`;
		let cleared = 0;
		for (const row of firing) {
			if (seen.has(`${row.rule_id}\u0000${row.subject}`)) continue;
			yield* sql`UPDATE alert_state SET firing = 0, since = ${now}, detail = 'subject no longer reported'
				WHERE rule_id = ${row.rule_id} AND subject = ${row.subject}`;
			yield* sql`UPDATE alert_incidents SET ended_at = ${now}
				WHERE rule_id = ${row.rule_id} AND subject = ${row.subject} AND ended_at IS NULL`;
			cleared += 1;
		}
		return cleared;
	});

export interface Incident {
	readonly id: number;
	readonly rule_id: string;
	readonly subject: string;
	readonly what: string;
	readonly detail: string | null;
	readonly started_at: string;
	readonly ended_at: string | null;
}

export const listIncidents = (page: number, size: number) =>
	Effect.gen(function* () {
		const sql = yield* SqlClient.SqlClient;
		const [count] = yield* sql<{ n: number }>`SELECT count(*) AS n FROM alert_incidents`;
		const rows = yield* sql<Incident>`SELECT * FROM alert_incidents
			ORDER BY started_at DESC LIMIT ${size} OFFSET ${(page - 1) * size}`;
		return { rows, total: count?.n ?? 0 };
	});

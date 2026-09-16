import { Config, Duration, Effect, Layer, Schedule } from "effect";
import { HttpClient } from "effect/unstable/http";
import { SqlClient } from "effect/unstable/sql";

import { runAlerts } from "#/server/alerts/run";

import { ClientRegistry } from "#/server/ledger/clients";
import {
	incrementRowsWritten,
	insertRequests,
	pruneRequests,
	recordQuotaSnapshot,
	rollupSince,
	toRow,
	upsertCredentials,
	writeCollectorState,
} from "#/server/ledger/store";
import { ManagementApi } from "#/server/management/api";

// The proxy keeps usage records for 60 s and pops them on read, so this is the
// one process that may pop. Failures are recorded and the loop continues; a
// batch that fails to store is lost, never re-popped, and shows up as an error
// on /healthz.

const POP_EVERY = Duration.seconds(5);
const SNAPSHOT_EVERY = Duration.seconds(30);
const MAINTAIN_EVERY = Duration.hours(1);
const BATCH = 500;

const now = () => new Date().toISOString();

// Errors are kept per stage so a healthy pop cannot hide a failing snapshot.
const noteError = (stage: string, message: string) =>
	Effect.logWarning(`collector: ${stage} failed`, message).pipe(
		Effect.andThen(
			writeCollectorState({ [`error:${stage}`]: message, [`error_at:${stage}`]: now() }),
		),
		Effect.catch(() => Effect.void),
	);

const clearError = (stage: string) =>
	writeCollectorState({ [`error:${stage}`]: null, [`error_at:${stage}`]: null });

/** One pop-and-store cycle. Exported so tests can drive it without the timers. */
export const popOnce = Effect.gen(function* () {
	const api = yield* ManagementApi;
	const registry = yield* ClientRegistry;
	const records = yield* api.popUsage(BATCH);
	const receivedAt = now();
	const rows = records.map((record) => toRow(record, receivedAt));
	const written = yield* insertRequests(rows, registry);
	yield* incrementRowsWritten(written);
	yield* writeCollectorState({ last_pop_at: receivedAt, last_pop_count: records.length });
	yield* clearError("pop");
	return { popped: records.length, written };
});

/** One auth-files poll: credentials upserted, a snapshot per credential when its quota changed. */
export const snapshotOnce = Effect.gen(function* () {
	const api = yield* ManagementApi;
	const pools = yield* api.pools;
	const recordedAt = now();
	yield* upsertCredentials(pools.credentials, recordedAt);
	let recorded = 0;
	for (const credential of pools.credentials) {
		if (yield* recordQuotaSnapshot(credential, recordedAt)) recorded += 1;
	}
	yield* writeCollectorState({ last_snapshot_at: recordedAt });
	yield* clearError("snapshot");
	// Rules see every observation, not only changed snapshots: the stalled rule
	// and hysteresis clears depend on time passing.
	const alerts = yield* runAlerts(pools, recordedAt);
	if (alerts.fired > 0 || alerts.cleared > 0) {
		yield* Effect.logInfo("alerts", `fired ${alerts.fired}, cleared ${alerts.cleared}`);
	}
	return recorded;
});

/** Rollups for the 48 h of hours up to the newest stored request, plus retention pruning. */
export const maintainOnce = Effect.gen(function* () {
	const sql = yield* SqlClient.SqlClient;
	const at = now();
	const [newest] = yield* sql<{
		latest: string | null;
	}>`SELECT max(timestamp) AS latest FROM requests`;
	if (newest?.latest) {
		yield* rollupSince(new Date(Date.parse(newest.latest) - 48 * 3_600_000).toISOString());
	}
	const pruned = yield* pruneRequests(at);
	yield* writeCollectorState({ last_maintenance_at: at });
	yield* clearError("maintain");
	return pruned;
});

const loop = <A, E>(
	stage: string,
	every: Duration.Duration,
	once: Effect.Effect<A, E, ManagementApi | SqlClient.SqlClient | HttpClient.HttpClient>,
) =>
	once.pipe(
		// Defects too: a loop that dies stops popping and the proxy drops the records.
		Effect.catchCause((cause) => noteError(stage, String(cause).split("\n")[0] ?? "unknown")),
		Effect.repeat(Schedule.spaced(every)),
		Effect.onInterrupt(() => Effect.logInfo(`collector: ${stage} stopped`)),
		Effect.forkScoped,
	);

const Enabled = Config.Boolean("GATEWAI_COLLECT").pipe(Config.withDefault(true));

/** Forks the three loops for the lifetime of the runtime; disposing the runtime interrupts them. */
export const Collector = Layer.effectDiscard(
	Effect.gen(function* () {
		if (!(yield* Enabled)) {
			yield* Effect.logInfo("collector: disabled by GATEWAI_COLLECT");
			return;
		}
		yield* writeCollectorState({ started_at: now() });
		yield* loop("pop", POP_EVERY, popOnce);
		yield* loop("snapshot", SNAPSHOT_EVERY, snapshotOnce);
		yield* loop("maintain", MAINTAIN_EVERY, maintainOnce);
		yield* Effect.logInfo("collector: started");
	}),
);

import { Config, Duration, Effect, Layer, Schedule } from "effect";
import { SqlClient } from "effect/unstable/sql";

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

const noteError = (stage: string, message: string) =>
	Effect.logWarning(`collector: ${stage} failed`, message).pipe(
		Effect.andThen(
			writeCollectorState({ last_error: `${stage}: ${message}`, last_error_at: now() }),
		),
		Effect.catch(() => Effect.void),
	);

/** One pop-and-store cycle. Exported so tests can drive it without the timers. */
export const popOnce = Effect.gen(function* () {
	const api = yield* ManagementApi;
	const registry = yield* ClientRegistry;
	const records = yield* api.popUsage(BATCH);
	const receivedAt = now();
	const rows = records.flatMap((record) => {
		const row = toRow(record, receivedAt);
		return row ? [row] : [];
	});
	const written = yield* insertRequests(rows, registry);
	yield* incrementRowsWritten(written);
	yield* writeCollectorState({
		last_pop_at: receivedAt,
		last_pop_count: records.length,
		last_error: null,
		last_error_at: null,
	});
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
	return pruned;
});

const loop = <A, E>(
	stage: string,
	every: Duration.Duration,
	once: Effect.Effect<A, E, ManagementApi | SqlClient.SqlClient>,
) =>
	once.pipe(
		Effect.catch((error) =>
			noteError(stage, error instanceof Error ? error.message : String(error)),
		),
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
		yield* loop("pop", POP_EVERY, popOnce);
		yield* loop("snapshot", SNAPSHOT_EVERY, snapshotOnce);
		yield* loop("maintain", MAINTAIN_EVERY, maintainOnce);
		yield* Effect.logInfo("collector: started");
	}),
);

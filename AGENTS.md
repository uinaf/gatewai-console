# gatewai-console

Private operator console for the two gatewai CLIProxyAPI gateways. Design
record: [#1](https://github.com/uinaf/gatewai-console/issues/1). Visual brief:
[docs/design-brief.md](docs/design-brief.md).

## Stack

- Vite+ (`vp`) toolchain: oxfmt, oxlint, Vitest, knip, `.vite-hooks` + `vp staged`.
  pnpm from `package.json#packageManager`, Node from `.node-version`.
- TanStack Start + React 19, Node server target through `nitro/vite`
  (`node-server` preset). Build output is `.output/`; the container runs
  `.output/server/index.mjs`. No Cloudflare, no wrangler.
- `@uinaf/design/css` imported once in `src/styles.css`; app-only styles stay there.
  `design-check src` runs in verify.
- Effect for server services (`src/server/`), bridged to Start handlers through
  one `ManagedRuntime` in `src/server/runtime.ts`.
- `src/server/management/` is the only code that knows the CLIProxyAPI
  management API: `Schema` wire shapes (unknown keys and token material are
  dropped at decode), `ManagementApi` over `HttpClient`, and the quota
  normaliser that folds provider headers into `QuotaWindow`s. Reads retry
  twice on transient failures; `usage-queue` never retries because popping
  consumes. Contract tests run on redacted fixtures captured from a live gateway.
- SQLite through Effect SQL: `@effect/sql-sqlite-node` (`node:sqlite` underneath,
  no native build) provides `SqlClient`; `effect/unstable/sql` owns queries,
  models, and the migrator. Migrations are Effects in `src/db/migrations.ts`,
  keyed `<id>_<name>`, run in one transaction when the `Database` layer builds,
  so a fresh volume is migrated on first boot. No Drizzle, no separate
  migrations directory in the image.
- The ledger (`src/server/ledger/`): `Collector` is a background layer inside
  the runtime that pops `usage-queue` every 5 s (the proxy keeps 60 s and
  popping consumes, so exactly one console per proxy), stores rows keyed on
  `request_id` in one transaction, snapshots each credential's normalised quota
  every 30 s only when it changed, and hourly recomputes rollups for the last
  48 h and prunes raw rows past 90 days. The raw client key is sha256-hashed
  before storage; `GATEWAI_CLIENTS_FILE` (JSON `{ "<sha256>": "label" }`,
  optional, read-only) names keys, anything else is a 16-char fingerprint.
  `GATEWAI_COLLECT=false` turns the loops off. State and errors land in
  `collector_state` and surface on `/healthz`.
- Alerts (`src/server/alerts/`): rules come from `GATEWAI_ALERTS_FILE`
  (JSON, see `alerts.example.json`, mounted read-only, never edited in the UI).
  Kinds: `remaining` (a window's remaining percent below a threshold, with a
  5-point clear margin so jitter never refires), `cooldown`, `unhealthy`,
  `stalled` (no pop for N minutes). Every snapshot pass evaluates all rules;
  a crossing opens one row in `alert_incidents` and closes it on clear.
  Delivery is a Better Stack heartbeat per rule: firing posts `<url>/fail`
  with the detail, clearing posts `<url>`. Hosts hold heartbeat URLs only,
  never the Uptime API token; every pass posts each rule's current state.
- Runtime image: distroless `nodejs24`, UID 1000, read-only root, only `/data`
  writable, port 8080, no shell. Runtime Node lags `.node-version` by a few
  patch releases; keep `node:sqlite` usage to APIs both have. A bind-mounted
  `/data` must be owned by UID 1000 on the host; a named volume inherits it.

## Commands

`vp` is `node_modules/.bin/vp`; use `pnpm exec vp` or `pnpm run` when it is not
on PATH. Scripts are in [package.json](package.json).

```bash
pnpm install --frozen-lockfile
pnpm run env                  # .env.local from 1Password (OP_ITEM, GATEWAI_MANAGEMENT_URL); never prints values
pnpm run doctor               # read-only: toolchain pins, env, gateway reachable
PORT=3000 pnpm run dev        # strict port: a collision fails instead of drifting
vp check                      # oxfmt + oxlint + typecheck
vp run verify                 # the CI gate; see package.json#scripts.verify
docker build -t gatewai-console:ci . && pnpm run smoke gatewai-console:ci
                              # the shipped image, hardened as in production
node .output/server/index.mjs # the production build after vp run build
```

`scripts/` holds the lifecycle helpers CI shares: `env`, `doctor`, `smoke`.
They are plain Node TypeScript with no repository imports so they run before
anything is built.

Runtime environment: `GATEWAI_DB_PATH` (default `data/console.sqlite`) in
[src/server/database.ts](src/server/database.ts); `GATEWAI_MANAGEMENT_URL`
(default loopback `8317`) and `GATEWAI_MANAGEMENT_KEY` or
`GATEWAI_MANAGEMENT_KEY_FILE`, `GATEWAI_MANAGEMENT_TIMEOUT` in
[src/server/management/api.ts](src/server/management/api.ts);
`GATEWAI_HOST_LABEL` (a short host label) in [src/functions/pools.ts](src/functions/pools.ts);
`GATEWAI_COLLECT`, `GATEWAI_CLIENTS_FILE` in [src/server/ledger/](src/server/ledger/);
`GATEWAI_ALERTS_FILE` in [src/server/alerts/rules.ts](src/server/alerts/rules.ts);
`PORT` and `HOST` by nitro. Container defaults are in the [Dockerfile](Dockerfile).

## Invariants

- Dark only. `color-scheme: dark` is pinned at `:root`; no light theme, no toggle.
- Read-only plus the runbook actions from #1: reset cooldown, refresh credential,
  toggle credential fields. No config editing, no plugin store, no OAuth enrollment.
- The management key never lands in the repo, logs, client bundle, or test
  fixtures. Production reads it from a container secret file.
- One console per proxy. Popping the usage queue consumes it.
- Product routes follow the shared design canvas one screen per PR: pools at
  `/`, ledger at `/ledger`, alerts at `/alerts`.
- Ledger pages read aggregates only (`src/server/ledger/queries.ts`); raw
  request rows never leave the server. Percentiles are computed in process
  from sorted latencies, which measured 86 ms for a 90-day breakdown over
  60k rows.
- Charts follow the dataviz skill on top of the design tokens: two quota
  lines differ by dash as well as hue, model-share segments carry provider
  hues with 2px gaps, a legend and a table view always exist, and the
  crosshair readout lists every series. The uinaf accent and slime hues fail
  the skill's generic dark-mode lightness band by design; identity is never
  colour alone.
- The browser never talks to the proxy. Pages load through server functions in
  `src/functions/`, which run inside the `ManagedRuntime`.

## Dev against live

`GATEWAI_MANAGEMENT_URL` and `GATEWAI_MANAGEMENT_KEY` from the operator's vault
in `.env.local` (gitignored, see `.env.example`); `pnpm run env` writes it
from 1Password given `OP_ITEM` and the url. `vp dev` loads it. `curl -s localhost:3000/api/pools` prints the normalised
pools; the key never appears in the payload or the log.

## Layout

| Path                      | Role                                                 |
| ------------------------- | ---------------------------------------------------- |
| `src/routes/`             | TanStack file routes; `healthz.ts` is a server route |
| `src/server/database.ts`  | `Database` layer: `SqlClient`, pragmas, migrations   |
| `src/server/runtime.ts`   | `ManagedRuntime` shared by handlers                  |
| `src/server/health.ts`    | `/healthz` payload: version, uptime, db reachability |
| `src/server/management/`  | `ManagementApi`, wire schemas, quota normaliser      |
| `src/routes/api/pools.ts` | Normalised credentials for the pools screen          |
| `src/server/ledger/`      | Collector loops, store, queries, client key registry |
| `src/routes/ledger.tsx`   | Ledger screen: range, breakdowns, quota history      |
| `src/server/alerts/`      | Rules, evaluator with hysteresis, store, heartbeats  |
| `src/routes/alerts.tsx`   | Alerts screen: firing, clear rules, incidents        |
| `src/db/migrations.ts`    | Migration Effects: `meta`, then the ledger tables    |
| `.github/workflows/`      | `verify` (PR, merge queue, call), `scan`, `release`  |

## Delivery

- Conventional commits. PRs against `main`; `verify` (gate plus a container
  smoke) and `scan` run on PRs and are required by the `default-branch-checks`
  ruleset. Squash is the only merge method; branches delete on merge.
- PR bodies follow the [uinaf/.github](https://github.com/uinaf/.github)
  template: problem, solution, proof. Proof carries only what CI cannot show;
  attach screenshots with `gh pr create --attach ./shot.png` or
  `gh pr comment <n> --attach`, never commit them.
- `release.yml` on push to `main` re-runs verify, then pushes
  `ghcr.io/uinaf/gatewai-console` tagged `sha-<sha>`, the package version, and
  `latest`, with the digest in the job summary. Deployment lives in the
  operator's infrastructure repo and pins that digest.
- Renovate extends `uinaf/renovate-config`.

## Repository Skills

- For React effect changes, use [react-ban-use-effect](.agents/skills/react-ban-use-effect/SKILL.md).
- For React feature and bug verification or diagnostics, use [react-doctor](.agents/skills/react-doctor/SKILL.md).
- For Start routes, server routes, server functions, SSR, or the Node build, use [tanstack-start](.agents/skills/tanstack-start/SKILL.md). Its Vinxi and `app.config.ts` examples predate this repo; follow the installed Start version and `vite.config.ts`.
- For Effect setup and routing to the bundled guide, use [effect-ts](.agents/skills/effect-ts/SKILL.md). Keep `effect` at the pinned rc; the skill's install step does not authorize an upgrade.

# Learning more about Effect

This repository uses the Effect Typescript library.

Before writing any Effect code, first read `node_modules/effect/AGENTS.md`
**completely**, and follow the links in the file when required.

If you need to learn more about particular Effect apis and concepts that the
guide doesn't cover, search through the source code in `node_modules/effect/src`.

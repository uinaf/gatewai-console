# gatewai-console

Private operator console for CLIProxyAPI gateways: pools, ledger, alerts. One
console per proxy. Design record: [#1](https://github.com/uinaf/gatewai-console/issues/1);
visual brief: [docs/design-brief.md](docs/design-brief.md); operator-facing
usage: [README.md](README.md).

## Stack and boundaries

- Vite+ (`vp`) owns format, lint, types, tests, knip, and the pre-commit hook.
  TanStack Start + React 19 on a Node server through `nitro/vite`; the
  container runs `.output/server/index.mjs`. No Cloudflare Workers, no wrangler.
- Effect for everything server-side (`src/server/`), bridged to Start through
  the one `ManagedRuntime` in [src/server/runtime.ts](src/server/runtime.ts).
  Read `node_modules/effect/AGENTS.md` before writing Effect code. Keep
  `effect` at the pinned rc.
- SQLite via `@effect/sql-sqlite-node` (`node:sqlite`, no native build).
  Migrations are Effects in [src/db/migrations.ts](src/db/migrations.ts), run
  in one transaction when the `Database` layer builds; never edit a released
  migration, add the next id.
- [src/server/management/](src/server/management/) is the only code that
  knows the proxy's management API. Schemas drop unknown keys, so token material
  never passes the boundary. Reads retry twice; `usage-queue` never retries
  because popping consumes.
- [src/server/ledger/](src/server/ledger/): the `Collector` layer pops every
  5 s from process boot ([src/server/boot.ts](src/server/boot.ts) builds the
  runtime; Start loads handlers lazily), snapshots quota every 30 s on change,
  rolls up hourly, prunes raw rows after 90 days. Client keys are stored as
  sha256 only. Errors are kept per stage and surface on `/healthz`.
- [src/server/alerts/](src/server/alerts/): rules from a read-only JSON file
  ([alerts.example.json](alerts.example.json)), a pure evaluator with a 5-point
  clear margin, one incident per crossing, email through Cloudflare Email
  Sending on crossings and an optional Better Stack heartbeat per rule fed every
  pass. Hosts never hold the Better Stack API token.
- Pages load only through server functions in `src/functions/`; the browser
  never talks to the proxy and never receives raw request rows. Charts follow
  the dataviz skill on the design tokens; identity never rests on colour alone.
- `@uinaf/design/css` is imported once in `src/styles.css`; `design-check src`
  runs in verify. Dark only, `color-scheme: dark` pinned at `:root`.

## Commands

Scripts live in [package.json](package.json); `vp` is `node_modules/.bin/vp`.
Every environment variable and its default is listed in
[.env.example](.env.example) and read in the file that owns it.

```bash
pnpm install --frozen-lockfile
OP_ITEM=op://<vault>/<item> GATEWAI_MANAGEMENT_URL=... pnpm run env   # .env.local from 1Password, never prints values
pnpm run doctor               # read-only: pins, env, gateway reachable
PORT=3000 pnpm run dev        # strict port: a collision fails instead of drifting
pnpm run verify               # the CI gate: audit, routes, check, design, tests, knip, build
docker build -t gatewai-console:ci . && pnpm run smoke gatewai-console:ci   # the image, hardened as in production
```

`curl -s localhost:3000/api/pools` prints the normalised pools; the key never
appears in the payload or the log.

## Invariants

- The management key never lands in the repo, logs, client bundle, or fixtures.
  Production reads it from a file; fixtures are redacted captures.
- Read-only plus the runbook actions from #1: reset cooldown, refresh credential,
  toggle credential fields. No config editing, plugin store, or OAuth enrollment.
- One console per proxy: popping the usage queue consumes it, and a rule's
  heartbeat expects one feeder.
- No site facts in the tree: hostnames, vault paths, and addresses come from the
  operator's shell or mounted files.

## Delivery

- Conventional commits, squash-only PRs against `main`; `verify` (gate plus the
  container smoke) and `scan` are required checks. PR bodies follow the
  [uinaf/.github](https://github.com/uinaf/.github) template; attach
  screenshots with `gh pr create --attach`, never commit them.
- Pushes to `main` publish `ghcr.io/uinaf/gatewai-console` (`sha-<sha>`, the
  package version, `latest`) with the digest in the run summary. Deployment
  pins that digest in the operator's infrastructure repo.
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

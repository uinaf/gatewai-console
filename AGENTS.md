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
- Drizzle over SQLite. Driver is `node:sqlite` (`DatabaseSync`) behind
  `drizzle-orm/sqlite-proxy`; Drizzle ships no native `node:sqlite` driver yet.
  Chosen over `better-sqlite3` because Node 24 has the module unflagged, the
  image needs no native build, and the distroless runtime has no toolchain.
  Pragmas are set on open; migrations in `drizzle/` run when the `Database`
  layer builds, so a fresh volume is migrated on first boot.
- Runtime image: distroless `nodejs24`, UID 1000, read-only root, only `/data`
  writable, port 8080, no shell. Runtime Node lags `.node-version` by a few
  patch releases; keep `node:sqlite` usage to APIs both have. A bind-mounted
  `/data` must be owned by UID 1000 on the host; a named volume inherits it.

## Commands

`vp` is `node_modules/.bin/vp`; use `pnpm exec vp` or `pnpm run` when it is not
on PATH. Scripts are in [package.json](package.json).

```bash
pnpm install --frozen-lockfile
vp dev                        # http://localhost:3000
vp check                      # oxfmt + oxlint + typecheck
vp run verify                 # the CI gate; see package.json#scripts.verify
vp run db:generate            # drizzle-kit migration from src/db/schema.ts
node .output/server/index.mjs # the production build after vp run build
```

Runtime environment is read in [src/server/database.ts](src/server/database.ts)
(`GATEWAI_DB_PATH`, `GATEWAI_MIGRATIONS_DIR`) and by nitro (`PORT`, `HOST`);
container defaults are in the [Dockerfile](Dockerfile).

## Invariants

- Dark only. `color-scheme: dark` is pinned at `:root`; no light theme, no toggle.
- Read-only plus the runbook actions from #1: reset cooldown, refresh credential,
  toggle credential fields. No config editing, no plugin store, no OAuth enrollment.
- The management key never lands in the repo, logs, client bundle, or test
  fixtures. Production reads it from a container secret file.
- One console per proxy. Popping the usage queue consumes it.
- Product routes wait for the design. Until then `/` renders the shell only.

## Dev against live

[#3](https://github.com/uinaf/gatewai-console/issues/3) owns the convention:
`GATEWAI_MANAGEMENT_KEY` from the operator's vault in `.env.local` (gitignored,
see `.env.example`), pointed at the t102 gateway. Nothing in this skeleton calls
the proxy yet.

## Layout

| Path                     | Role                                                 |
| ------------------------ | ---------------------------------------------------- |
| `src/routes/`            | TanStack file routes; `healthz.ts` is a server route |
| `src/server/database.ts` | `Database` service: node:sqlite, WAL, migrations     |
| `src/server/runtime.ts`  | `ManagedRuntime` shared by handlers                  |
| `src/server/health.ts`   | `/healthz` payload: version, uptime, db reachability |
| `src/db/schema.ts`       | Drizzle schema (`meta` only for now)                 |
| `drizzle/`               | Checked-in migrations                                |
| `.github/workflows/`     | `verify` (PR, merge queue, call), `scan`, `release`  |

## Delivery

- Conventional commits. PRs against `main`; `verify` and `scan` run on PRs.
- `release.yml` on push to `main` re-runs verify, then pushes
  `ghcr.io/uinaf/gatewai-console` tagged `sha-<sha>`, the package version, and
  `latest`, with the digest in the job summary. Deployment is
  [zebroid-infra#124](https://github.com/uinaf/zebroid-infra/issues/124).
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

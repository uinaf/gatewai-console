# gatewai-console

Operator console for the gatewai [CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI)
gateways, one console per gateway host.

It replaces the stock Management Center with a uinaf-styled surface: account
pools and quota, a per-client-key usage ledger, and quota drain alerts. It runs
next to the proxy on each gateway host and reads the management API over
loopback. Proxy configuration stays in the operator's infrastructure repo;
the console is read-only plus the runbook actions.

Status: pools live; ledger and alerts next. Tracker epic [#1](https://github.com/uinaf/gatewai-console/issues/1).

## Run

```bash
pnpm install --frozen-lockfile
OP_ITEM='op://VAULT/ITEM' GATEWAI_MANAGEMENT_URL='https://gateway.example/v0/management' pnpm run env
pnpm run doctor                 # toolchain, env, gateway reachability
pnpm run dev                    # http://localhost:3000 (PORT=… to move it)
pnpm run verify                 # the CI gate
```

`vp` lives in `node_modules/.bin`; `pnpm run <script>` and `pnpm exec vp` find it.

Production build and container:

```bash
pnpm run build && GATEWAI_DB_PATH=/tmp/console.sqlite node .output/server/index.mjs
docker build -t gatewai-console:local .
pnpm run smoke gatewai-console:local   # runs it hardened, checks /healthz and /
docker run --rm --read-only --tmpfs /tmp -v gatewai-console-data:/data -p 8080:8080 gatewai-console:local
curl localhost:8080/healthz     # {"ok":true,"version":"0.1.0","uptimeSeconds":1,"db":"reachable"}
```

The container runs as UID 1000 with a read-only root. A bind-mounted `/data`
must be owned by UID 1000 on the host; `/healthz` answers 503 with
`"db":"unreachable"` when it is not.

## Deploy

Push to `main` publishes `ghcr.io/uinaf/gatewai-console` (tags: `sha-<sha>`,
package version, `latest`) with the digest in the run summary. Deployment pins
that digest and runs one Compose project per gateway host, with `/data` on a
volume and the management key, `alerts.json`, and `clients.json` mounted
read-only.

## Docs

- [AGENTS.md](AGENTS.md): stack, commands, invariants, dev-against-live
- [docs/design-brief.md](docs/design-brief.md): visual brief for the screens

# gatewai-console

Operator console for the gatewai [CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI)
gateways on `zebroid-rpi` and `zebroid-platform`.

It replaces the stock Management Center with a uinaf-styled surface: account
pools and quota, a per-client-key usage ledger, and quota drain alerts. It runs
next to the proxy on each gateway host and reads the management API over
loopback. Configuration stays in [uinaf/zebroid-infra](https://github.com/uinaf/zebroid-infra);
the console is read-only plus the runbook actions.

Status: skeleton. Tracker epic [#1](https://github.com/uinaf/gatewai-console/issues/1).

## Run

```bash
pnpm install --frozen-lockfile
vp dev                          # http://localhost:3000
vp run verify                   # the CI gate
```

Production build and container:

```bash
vp run build && GATEWAI_DB_PATH=/tmp/console.sqlite node .output/server/index.mjs
docker build -t gatewai-console:local .
docker run --rm --read-only --tmpfs /tmp -v "$(mktemp -d):/data" -p 8080:8080 gatewai-console:local
curl localhost:8080/healthz     # {"ok":true,"version":"0.1.0","uptimeSeconds":1,"db":"reachable"}
```

The container runs as UID 1000 with a read-only root; `/data` must be writable
by that UID.

## Deploy

Push to `main` publishes `ghcr.io/uinaf/gatewai-console` (tags: `sha-<sha>`,
package version, `latest`) with the digest in the run summary. zebroid-infra
pins that digest and runs one Compose project per gateway host:
[uinaf/zebroid-infra#124](https://github.com/uinaf/zebroid-infra/issues/124).

## Docs

- [AGENTS.md](AGENTS.md): stack, commands, invariants, dev-against-live
- [docs/design-brief.md](docs/design-brief.md): visual brief for the screens

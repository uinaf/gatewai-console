# uinaf/gatewai-console

Operator console for a self-hosted [CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI)
gateway. One console runs next to each proxy and reads its management API over
loopback.

It replaces the stock Management Center with three screens: **pools** (every
credential with its quota windows, cooldowns, request history, and the runbook
actions), **ledger** (per-key and per-model usage over time, kept past the
proxy's 60-second retention), and **alerts** (rules on remaining quota,
cooldowns, failed refreshes, and a stalled collector, delivered by email or a
Better Stack heartbeat). Dark only; read-only apart from reset cooldown,
refresh credential, and the websockets toggle.

## Run it

The image is `ghcr.io/uinaf/gatewai-console`, tagged with the package version
and the commit. It runs as UID 1000 on a read-only root with `/data` as the only
writable path.

```bash
docker run --rm --read-only --tmpfs /tmp \
  -v gatewai-console-data:/data \
  -v /etc/gatewai/management-key:/run/secrets/management-key:ro \
  -e GATEWAI_MANAGEMENT_URL=http://127.0.0.1:8317/v0/management \
  -e GATEWAI_MANAGEMENT_KEY_FILE=/run/secrets/management-key \
  -e GATEWAI_HOST_LABEL=t102 \
  --network host \
  ghcr.io/uinaf/gatewai-console:latest
```

`GET /healthz` answers with the version, database reachability, and the
collector's last pop; anything else in the environment is listed with its owner
in [AGENTS.md](AGENTS.md#commands). Mount [alerts.json](alerts.example.json) and
set `GATEWAI_ALERTS_FILE` to enable rules; mount a `clients.json` map of
`sha256(client key)` to label and set `GATEWAI_CLIENTS_FILE` to name keys in the
ledger.

The management key is the only secret the console holds. It never reaches the
browser, the logs, or the database.

## Develop

```bash
pnpm install --frozen-lockfile
<<<<<<< HEAD
OP_ITEM='op://VAULT/ITEM' GATEWAI_MANAGEMENT_URL='https://gateway.example/v0/management' pnpm run env
pnpm run doctor                 # toolchain, env, gateway reachability
pnpm run dev                    # http://localhost:3000 (PORT=… to move it)
pnpm run verify                 # the CI gate
=======
OP_ITEM='op://VAULT/ITEM' GATEWAI_MANAGEMENT_URL='https://gateway.example/v0/management' pnpm run env
pnpm run doctor   # pins, .env.local, gateway reachable
pnpm run dev      # http://localhost:3000, PORT= to move it
pnpm run verify   # the CI gate
>>>>>>> 7cf3cdb (feat: email on alert crossings through Cloudflare Email Sending; readme for operators)
```

`pnpm run env` writes `.env.local` from a 1Password item holding `management`
(and optionally `client-bearer`); write the file by hand if you keep the key
elsewhere. Against a live gateway the collector starts popping the usage queue
immediately, and popping consumes, so point exactly one console at a proxy.

To try the image the way production runs it:

```bash
docker build -t gatewai-console:local .
pnpm run smoke gatewai-console:local
```

## Design and delivery

The screens follow a shared design canvas on the uinaf design system; the brief
is in [docs/design-brief.md](docs/design-brief.md). Stack, invariants, and
layout are in [AGENTS.md](AGENTS.md). Pushes to `main` publish the image with
the digest in the run summary.

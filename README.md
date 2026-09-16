# uinaf/gatewai-console

Operator console for a self-hosted [CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI)
gateway. It runs next to the proxy, reads the management API over loopback, and
replaces the stock Management Center with three screens:

- **Pools.** Every credential with its quota windows, cooldowns, twenty-bucket
  request history, and the runbook actions: reset cooldown, refresh, toggle
  websockets. Provider quota headers are folded into plain windows, so Claude's
  unified limits and Codex's primary, secondary, and per-model families read
  the same way.
- **Ledger.** Per client key, model, provider, and credential: requests, error
  rate, tokens with cache reads and writes, p50/p95 latency and time to first
  token, model share, and deltas against the previous range. The proxy keeps
  usage records for sixty seconds; the console persists them and keeps hourly
  rollups indefinitely. Quota history per credential shows drains and resets.
- **Alerts.** Rules on remaining quota, cooldowns, failed refreshes, and a
  stalled collector, evaluated with hysteresis so jitter never refires. Each
  crossing opens an incident, sends an email through Cloudflare Email Sending
  if configured, and feeds an optional Better Stack heartbeat per rule.

Dark only, on the uinaf design system. Read-only apart from the three runbook
actions. Client keys are stored as SHA-256 only; the management key never
reaches the browser, the logs, or the database.

## Run

The image is `ghcr.io/uinaf/gatewai-console`, tagged with the package version
and `sha-<commit>`. It runs as UID 1000 on a read-only root; `/data` is the only
writable path and holds the SQLite file, which a fresh volume migrates on first
boot.

```bash
docker run --rm --network host --read-only --tmpfs /tmp \
  -v gatewai-console-data:/data \
  -v /etc/gatewai/management-key:/run/secrets/management-key:ro \
  -e GATEWAI_MANAGEMENT_KEY_FILE=/run/secrets/management-key \
  -e GATEWAI_HOST_LABEL=gateway-a \
  ghcr.io/uinaf/gatewai-console:latest
```

The console listens on 8080 and expects the proxy's management API at
`http://127.0.0.1:8317/v0/management`; set `GATEWAI_MANAGEMENT_URL` to point
elsewhere. Every other setting, with its default and the file that reads it, is
in [.env.example](.env.example). Two optional read-only mounts:

- `GATEWAI_ALERTS_FILE`: alert rules, see [alerts.example.json](alerts.example.json).
- `GATEWAI_CLIENTS_FILE`: names client keys in the ledger. Either a JSON map of
  `sha256(client key)` to a label, or an inventory `{ "clients": [{ "name",
"fingerprint" }] }` where the fingerprint is the first 16 hex characters of
  that hash.

`GET /healthz` reports the version, database reachability, and the collector's
last pop, lag, rows written, and last error. Run exactly one console per proxy:
reading the usage queue consumes it.

Put the console behind whatever already authenticates your operators; it has
no login. When served through `tailscale serve`, it shows the
`tailscale-user-login` header in the topbar.

## Develop

Node and pnpm versions are pinned in [.node-version](.node-version) and
[package.json](package.json). Development talks to a real gateway; there is
no mock proxy.

```bash
pnpm install --frozen-lockfile
cp .env.example .env.local        # or: OP_ITEM='op://VAULT/ITEM' GATEWAI_MANAGEMENT_URL='https://gateway.example/v0/management' pnpm run env
pnpm run doctor                   # pins, .env.local, gateway reachable
pnpm run dev                      # http://localhost:3000; PORT= to move it
pnpm run verify                   # the CI gate
```

`pnpm run env` writes `.env.local` from a 1Password item holding a
`management` field. To run the image the way production does:

```bash
docker build -t gatewai-console:local . && pnpm run smoke gatewai-console:local
```

Stack, boundaries, and delivery rules are in [AGENTS.md](AGENTS.md). The visual
brief the screens were designed from is [docs/design-brief.md](docs/design-brief.md).

## License

[MIT](LICENSE).

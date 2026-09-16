# Design brief for claude.ai/design

Paste everything below the rule into a claude.ai/design conversation. The
tracker epic [#1](https://github.com/uinaf/gatewai-console/issues/1) is the
authority on scope; this brief is the visual ask.

---

Design **gatewai-console**, a private operator console for a self-hosted LLM
gateway ([CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI)) that
fronts my Codex, Claude Code, and Grok subscriptions. Two instances run on two
small Linux hosts, one console per host. Audience: me, an engineer, on a
MacBook, opened a few times a day and glanced at, plus a phone-width view for a
quick check. No other users, no onboarding, no marketing.

## Design system, mandatory

Use the uinaf design system. Read it before drawing anything:

- Spec and tokens: <https://design.uinaf.dev>. Connect the MCP server at
  `https://design.uinaf.dev/mcp` and pull tokens, components, and the reference
  screens from it rather than guessing.
- Start from the **dashboard** reference screen
  (`https://design.uinaf.dev/pages/dashboard.md`): one-row topbar with the
  current-page marker, stat strip, ruled data table. **settings** shows ruled
  field groups and the dashed danger zone; use that language for the actions
  and alert rules. Do not invent a second shell.
- One typeface (Berkeley Mono, from the CDN), near-black, hairline borders, one
  accent, visible structure. Light and dark.
- Voice: short, dry, periods at the end. No emoji, no exclamation marks, no
  gradients, no illustrations, no SaaS sludge. `↗` external, `→` forward, `·`
  separator.
- The icon set is closed: eight 16-grid stroke SVGs. If you need a glyph that
  is not there, use text.

## Gather references first

Use the Mobbin MCP to pull real screens before sketching, and say which ones you
drew from. Look for:

- Usage and quota dashboards with per-account allowances: Vercel usage, Linear
  billing, Cloudflare analytics, PostHog usage, Grafana single-stat panels,
  Betterstack status and incidents, Bifrost gateway dashboard.
- Rate-limit and "resets in" patterns: GitHub API rate limit, Anthropic and
  OpenAI console usage pages, Apple Screen Time.
- Sparklines inside cards and dense ruled tables: Linear, Raycast, Datadog.

Borrow information hierarchy and density, not chrome. Everything renders in the
uinaf shell.

## What the data looks like

Every number on screen comes from the gateway's management API. Shapes below
are real, values are illustrative.

### Credentials (one per subscription account)

```json
{
  "name": "codex-two@example.com",
  "provider": "codex",
  "account_type": "pro",
  "status": "active",
  "status_message": "",
  "disabled": false,
  "unavailable": false,
  "cooldowns": [],
  "success": 350,
  "failed": 1,
  "last_refresh": "2026-09-16T10:02:11Z",
  "recent_requests": [
    { "time": "15:20-15:30", "success": 2, "failed": 0 },
    { "time": "15:50-16:00", "success": 25, "failed": 0 }
  ],
  "quota": { "observed_at": "2026-09-16T10:31:04Z", "signals": { "...": "..." } },
  "model_quotas": { "gpt-5.6-luna": { "observed_at": "...", "signals": { "...": "..." } } },
  "attributes": { "websockets": "true", "priority": "0" }
}
```

`recent_requests` is always twenty ten-minute buckets, most zero. `status` is
one of `active`, `cooling`, `disabled`, `error`; `cooldowns` carries
`{ reason, until }` when cooling.

### Quota signals, normalised for the UI

The raw signals are provider rate-limit headers. The server folds them into
windows so the UI never parses headers:

```json
{
  "windows": [
    { "label": "5-hour", "usedPercent": 38, "resetsAt": "2026-09-16T13:30:00Z", "status": "allowed" },
    { "label": "Weekly", "usedPercent": 9, "resetsAt": "2026-09-22T03:00:00Z", "status": "allowed" }
  ],
  "credits": { "balance": 712.25, "unlimited": false },
  "plan": "pro"
}
```

Provider differences the design must show honestly:

| Provider | Windows | Extras |
|---|---|---|
| Claude (Max) | `5-hour`, `Weekly`, `Weekly Fable` (model-specific) | overage status (`rejected` here) |
| Codex (Pro) | `Weekly` primary, sometimes a `5-hour` secondary, per-model `Additional` families like `GPT-5.3-Codex-Spark` | credits balance, plan type |
| xAI (SuperGrok Heavy) | **none**. The provider sends no quota headers | request counts and status only |

An exhausted window looks like `usedPercent: 100`, `status: "limited"`, with
`cooldowns[0].until` two days out. Design that state; it is the one I open the
console for.

### Usage records (the ledger)

The gateway emits one record per request. The console stores them and shows
aggregates only; the browser never gets raw rows.

```json
{
  "request_id": "req_01J...",
  "timestamp": "2026-09-16T10:31:04Z",
  "api_key": "sha256:9f3c…",
  "client": "macbook",
  "provider": "codex",
  "model": "gpt-6-astra",
  "auth_index": "codex-two@example.com",
  "stream": true,
  "failed": false,
  "latency_ms": 8420,
  "ttft_ms": 610,
  "tokens": 15234,
  "token_breakdown": { "input": 12000, "cached": 9800, "output": 3100, "reasoning": 134 },
  "reasoning_effort": "medium",
  "service_tier": "default",
  "user_agent": "codex_cli_rs/0.153.4"
}
```

Clients are named consumers: `macbook`, `devbox`, `hindsight`, `agents`,
`ci`. Unknown keys show as a 16-char fingerprint.

Aggregates the ledger screen must carry per client, per model, per provider,
per credential, for a time range and its previous range:

```json
{
  "requests": 1834,
  "errorRate": 0.012,
  "tokens": { "input": 12.1e6, "cached": 9.4e6, "output": 2.2e6, "reasoning": 0.3e6 },
  "latency": { "p50": 6100, "p95": 21400 },
  "ttft": { "p50": 540, "p95": 1900 },
  "models": [{ "model": "gpt-6-astra", "share": 0.71 }, { "model": "claude-fable-5-1", "share": 0.29 }],
  "delta": { "requests": 0.18, "tokens": -0.05 }
}
```

### Quota history (the drain view)

One point per observed change per credential per window:

```json
[{ "at": "2026-09-15T00:00:00Z", "window": "Weekly", "usedPercent": 0 },
 { "at": "2026-09-16T10:31:04Z", "window": "Weekly", "usedPercent": 77 }]
```

Resets appear as drops to zero; mark them.

### Alert rules and incidents

```json
{ "id": "codex-weekly-low", "scope": "provider:codex", "window": "Weekly", "remainingBelow": 10,
  "state": "firing", "since": "2026-09-16T09:12:00Z", "lastFired": "2026-09-16T09:12:00Z" }
```

Rules come from a file and are read-only in the UI. Kinds: remaining below a
threshold, credential entered cooldown, credential disabled or failed refresh,
collector stalled.

## Screens

1. **Pools** (default). Stat strip: per provider, accounts, aggregate
   remaining, active cooldowns, requests last hour. Then one card per
   credential: provider mark, name, plan badge, each window as a labelled bar
   with used percent and reset countdown ("resets in 2h 10m", "resets Sun
   03:00"), status line, credits when present, the twenty-bucket
   success/failed sparkline, websockets flag, and three quiet actions: reset
   cooldown, refresh, websockets toggle. Filter chips by provider. Sort by
   remaining. Grok cards have no bars; show counts and status without faking
   a meter.
2. **Ledger**. Range presets 24h / 7d / 30d / custom with previous-range
   deltas. Tabs or a segmented control for client · model · provider ·
   credential. Ruled table with the aggregates above; model share as a thin
   stacked bar inside the row. Below, the quota history chart per credential
   with reset markers.
3. **Alerts**. Ruled list of rules with state, since, last fired. Incident
   history table. Dashed danger-zone treatment for anything currently firing.

**Topbar**, one row: product name, the three sections with the current-page
marker, host name (`t102` or `eu`), operator login from the tailnet, and an
"observed 12 s ago" stamp that becomes a stale warning after 90 s.

No settings pages, no config editing, no login form, no empty-state
illustrations. Empty ledger says "no requests in range." in one line.

## Deliverables

- Pools at 1280 and 390, light and dark.
- Ledger and Alerts at 1280, dark.
- Component sheet: credential card in `active`, `cooling` (0% weekly, resets
  in 2d 21h), `disabled`; quota window bar at 9, 77, 100 percent; sparkline;
  stale topbar stamp; alert row firing and clear.
- Use real numbers: seven credentials, two Codex Pro (one cooling), three
  Claude Max, two Grok Heavy.

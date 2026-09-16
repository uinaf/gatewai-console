# gatewai-console

Operator console for the gatewai [CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI)
gateways on `zebroid-rpi` and `zebroid-platform`.

It replaces the stock Management Center with a uinaf-styled surface: account
pools and quota, a per-client-key usage ledger, and quota drain alerts. It runs
next to the proxy on each gateway host and reads the management API over
loopback. Configuration stays in [uinaf/zebroid-infra](https://github.com/uinaf/zebroid-infra);
the console is read-only plus the runbook actions.

Status: planning. The design record is the tracker epic.

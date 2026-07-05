# lemon-cli

LLM-friendly composite reads of lemon-server state. Returns JSON by default; pass `--text` for human-readable output.

The goal: collapse a 4–6 tool-call composite read ("is app X healthy?") into a single subcommand that returns structured fields, so an agent doesn't have to grep-parse prose.

Not a replacement for skills — skills still cover *actions* (deploy, restart, new-project). This CLI covers *reads*.

## Install

Already installed on lemon-server:

```
~/lemon-cli/lemon         # entrypoint
~/bin/lemon -> ~/lemon-cli/lemon
```

`~/bin` is on PATH, so just run `lemon ...`.

## Subcommands

| Command | Output |
|---|---|
| `lemon app status <app>` | Container state + port + Caddy route + Bao key count + recent error lines |
| `lemon app ls` | All apps from ports.json with container state, domain, auth |
| `lemon secrets status <app>` | Where the app's secrets live (`bao` / `file` / `none`) and key count |
| `lemon caddy routes` | Every `*.{{DOMAIN}}` route parsed from `/etc/caddy/Caddyfile` |
| `lemon port-audit` | Cross-check: declared ports vs running containers vs Caddy routes |
| `lemon deploy-check <repo>` | Pre-deploy sanity check + suggested port |
| `lemon docker-ls` | Directories under `~/docker/` with `managed_by: pipeline\|manual` |
| `lemon bao-keys <app>` | List leaf keys at `secret/apps/<app>/` |
| `lemon smoke <app\|url>` | HTTP probe through Caddy on localhost (skips Cloudflare). Status, redirect chain, body preview, auth_redirect flag |
| `lemon auth-check <app>` | Verify Authentik wiring: Caddy block, outpost reachable, anonymous request behaviour matches declaration |
| `lemon verify <app>` | One objective gate before declaring an app done: container running + Caddy route + HTTP responds + no fresh log errors (+ auth-challenge check when expected) |

## Flags

- `--text` — human-readable output instead of JSON.
- `--pretty` — pretty-print JSON.
- `--debug` — log subprocess + HTTP calls to stderr.
- `--no-bao` — skip OpenBao calls (faster when sealed/unreachable).

Flags must come **before** the subcommand: `lemon --pretty app status food-splitter`.

## Exit codes

- `0` — success
- `1` — fatal error (printed as `{"error":...,"type":...}` JSON)
- `2` — partial data: result still printed, but the result's `errors` array is non-empty

## Layout

```
lemon-cli/
  lemon                    # executable shim
  lemon_cli/
    main.py                # argparse dispatcher
    config.py              # paths + module-level DEBUG/NO_BAO flags
    sources/               # raw data fetchers (docker, ports, caddy, bao, filesystem)
    commands/              # one file per subcommand; each exports run(args) and render_text(result)
```

Each command takes a parsed `args` namespace and returns a dict/list. The dispatcher then either JSON-dumps it or calls the command's `render_text` for `--text` mode.

## Adding a subcommand

1. Drop `lemon_cli/commands/<name>.py` with `run(args)` and (optionally) `render_text(result)`.
2. Register it in `main.py` `build_parser()` — `set_defaults(_func=..., _render=...)`.
3. Reuse helpers in `lemon_cli/sources/`.

## Not deployed

This repo has no Dockerfile or `docker-compose.yml`, so the auto-deploy pipeline will skip it (it dies with "No Dockerfile or docker-compose.yml found"). The CLI lives on the host directly.

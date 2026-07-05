---
name: lemon
description: LLM-friendly composite reads of lemon-server state via the `lemon` CLI. Prefer this over running 4-6 separate docker/ports/Caddy/Bao tool calls when answering "is app X healthy?", "what's on port Y?", "where do <app>'s secrets live?", or auditing ports/routes.
---

# /lemon — composite reads of lemon-server state

`lemon` is a small Python CLI at `~/bin/lemon` (source: `~/lemon-cli/`). It returns **JSON by default**, so structured fields land in your context instead of prose that needs re-parsing.

## When to use this instead of older skills

| Question | Use this | Instead of |
|---|---|---|
| "Is `<app>` healthy?" | `lemon app status <app>` | `/server-status` + `/docker-info` + reading ports.json + grepping Caddyfile |
| "What apps are deployed?" | `lemon app ls` | reading `~/deploy/ports.json` + `docker ps` |
| "Where do `<app>`'s secrets live?" | `lemon secrets status <app>` | reading `secrets.env` + `ls .bao-*` |
| "What Caddy routes exist?" | `lemon caddy routes` | grepping `/etc/caddy/Caddyfile` |
| "Any port orphans?" | `lemon port-audit` | manual three-way diff |
| "Can I deploy `<repo>`?" | `lemon deploy-check <repo>` | reading ports.json + Caddyfile + listing `~/docker/` |
| "What's at `~/docker/<x>/`?" | `lemon docker-ls` | `ls ~/docker/` + guessing |
| "What's in Bao for `<app>`?" | `lemon bao-keys <app>` | reading `bao-fetch.sh` + curling Bao yourself |
| "Is the deploy actually loading?" | `lemon smoke <app>` | `curl -I https://<app>.{{DOMAIN}}` (fights Cloudflare) |
| "Is Authentik wired correctly?" | `lemon auth-check <app>` | reading Caddyfile + curling outpost + manual anon probe |
| **"Am I done?"** | **`lemon verify <app>`** | container check + smoke + log scan + Caddy + auth check — one composite gate |
| "Is the server healthy overall?" | `lemon server-health` | `docker ps` + `df` + `systemctl --failed` + cloudflared/loki/grafana checks |
| "Show me recent logs for `<app>`" | `lemon logs <app>` | knowing Loki port + constructing LogQL + parsing raw stream |
| "Did the last deploy succeed?" | `lemon gh-status <app>` | `gh run list --repo {{GITHUB_ORG}}/<app>` + parsing |
| "Any pipeline warnings/CVEs after deploy?" | `lemon ci check <repo>` | reading GH Actions job logs + grepping warning patterns |
| "Which repos have failing pipelines?" | `lemon ci ls` | iterating gh run list across all org repos |
| "Is Bao sealed?" | `lemon bao-status` | curling `/v1/sys/health` and knowing the status codes |
| "Did the backup run OK?" | `lemon backup-status` | reading `~/backup.log` + running `restic snapshots` |
| "What n8n workflows are active?" | `lemon n8n ls` | knowing API key + constructing curl + parsing JSON |
| "What Plane issues are open?" | `lemon plane ls` | knowing API key + project ID + constructing curl + filtering |

Skills (`/deploy`, `/new-project`, `/server-cmd`) still own **actions**. This CLI is read-only.

## Subcommands

```
lemon app status <app>                   # container + ports + caddy + bao + recent errors
lemon app ls                             # inventory of all apps from ports.json
lemon secrets status <app>              # source: bao | file | none, key_count, bao_reachable
lemon caddy routes                       # [{domain, port, auth}]
lemon port-audit                         # ports.json vs containers vs caddy
lemon deploy-check <repo>               # ready:bool + reasons + port_suggested
lemon docker-ls                          # ~/docker/* with managed_by: pipeline | manual
lemon bao-keys <app>                     # leaf keys at secret/apps/<app>/
lemon smoke <app|url>                    # HTTP probe via Caddy on localhost
lemon auth-check <app>                   # Authentik wiring sanity check
lemon verify <app>                       # ★ objective gate before declaring done

lemon server-health                      # containers + disk + failed units + tunnel + monitoring + runner
lemon logs <app> [--since 15m] [--limit 50] [--errors]   # Loki log query
lemon gh-status <app> [--limit 5]       # GitHub Actions run history for {{GITHUB_ORG}}/<app>
lemon ci check <repo>                    # Analyse latest run: Trivy CVEs, size growth >15%, Lighthouse scores
lemon ci ls                              # Latest run conclusion for every org repo (quick fleet view)
lemon bao-status                         # OpenBao seal/health + apps with AppRole creds
lemon backup-status [--no-restic]       # last backup run + latest restic snapshot
lemon n8n ls                             # list all n8n workflows (id, active, name)
lemon n8n status <id|name>              # get one n8n workflow by ID or partial name
lemon plane ls [--state open|backlog|todo|in-progress|done|cancelled]  # Plane issues
```

## `lemon verify` is the verification gate

The usage report flagged "declared done before verifying" as the #1 friction
pattern (deploys that weren't actually loading, workflows that were never
imported, Authentik configs that were missed). After **any** deploy, restart,
config change, or claim that "<app> is working", run:

```
lemon verify <app>
```

Six checks: `caddy_route`, `container_running`, `port_assigned`,
`http_responds` (HTTP probe through Caddy returns 2xx/3xx or an auth
challenge), `authentik_challenges_anon` (only when `import authentik` is
declared), `no_errors_in_last_60s` (configurable with `--since`). All must
pass for `ok: true`. If any fail, the structured `detail` field tells you
exactly which subsystem to look at.

`smoke` and `auth-check` are the focused single-check siblings — use them when
`verify` fails and you want to drill in.

## New command notes

**`lemon server-health`** — single JSON composite replacing 6+ separate checks. Returns `ok: true` only when containers/disk/tunnel/monitoring/runner all pass.

**`lemon logs <app>`** — queries Loki via `loki_project` label first (injected by deploy.sh), falls back to `container` label. Use `--errors` to filter to error/exception/fatal/panic lines only. Default window `--since 15m`; increase to `1h`, `24h` etc. when investigating older issues. Note: apps not in loki_project (not pipeline-managed) will fall back to the container label, which uses the full container name (e.g. `cashflow-api-1`), not the short name.

**`lemon gh-status <app>`** — calls `gh run list` for `{{GITHUB_ORG}}/<app>`. Returns `latest` (most recent run) plus full `runs` array. Conclusion values: `success`, `failure`, `cancelled`, `null` (in-progress).

**`lemon ci check <repo>`** — fetches the latest completed run for a repo, finds the `scan`, `size-check`, and `lighthouse` jobs (reusable workflow prefixes them as `"deploy / scan"` etc. — the CLI strips the prefix automatically), fetches each job's raw log via the GitHub API, and greps for warning patterns: non-zero Trivy CVE counts, `WARNING: ... grew by N%` lines, and `scores below threshold`. Returns `ok: true` when no warnings found. Slow (~5s) because it fetches full job logs. Use after a deploy to check if anything needs attention.

**`lemon ci ls`** — lists the latest completed run conclusion for every repo in the org. Fast (one `gh run list` per repo, no log fetching). Useful for spotting stale failures across the fleet.**`lemon ci ls`** omits repos with no pipeline runs (e.g. template repos).

**`lemon bao-status`** — reads `/v1/sys/health` (no auth needed). Status codes: 200=active, 429=standby, 503=sealed, 501=not-initialized. Also lists apps with AppRole creds on disk.

**`lemon backup-status`** — parses `~/backup.log` for the last "Backup complete" line, scans that run for error lines, then calls `restic snapshots --latest 1 --json` (sourcing `~/.restic-env`). Use `--no-restic` to skip the slow restic call.

**`lemon n8n ls / n8n status`** — hits n8n REST API on `localhost:5678`. The API key is baked into the command (same key as in the `/n8n` skill). `●` = active, `○` = inactive in text output.

**`lemon plane ls`** — hits Plane via Caddy on `localhost:80` with a `Host: plane.{{DOMAIN}}` header (bypasses Cloudflare bot detection that blocks Python urllib). API key is read from `~/secret-key-{{PLANE_API_KEY_FILE_ID}}.csv`. The Plane `?state=` query param is ignored by the API — filtering is done client-side. Default `--state open` returns backlog + todo + in-progress issues.

## Flags (place BEFORE the subcommand)

- `--text` — human-readable rendering instead of JSON.
- `--pretty` — pretty-print JSON.
- `--debug` — log every subprocess + HTTP call to stderr; use when the CLI itself misbehaves.
- `--no-bao` — skip OpenBao calls (when Bao is sealed or you only care about other fields).

Example: `lemon --pretty app status food-splitter`.

## Exit codes

- `0` — success
- `1` — fatal (output is `{"error":..., "type":...}`)
- `2` — partial: JSON still printed, check the `errors` array

## Reading the JSON

`lemon app status <app>` returns:

```jsonc
{
  "app": "food-splitter",
  "container": {"name": "...", "state": "running", "status": "Up 4 days", "image": "...", "id": "..."},
  "ports": [10008],
  "port_map": {"app": 10008},          // raw entry from ports.json
  "caddy":  {"domain": "...", "port": 10008, "auth": "authentik|none"},
  "bao":    {"source": "bao|file|none", "bao_reachable": true, "key_count": 6, "has_role_id": true},
  "recent_errors": ["...log line..."],   // last 100 log lines filtered by error regex
  "filesystem": {"app_dir_exists": true, "has_compose": true, "has_dockerfile": false},
  "errors": []                           // CLI-level issues (missing container, no caddy block, etc)
}
```

When a field is `null` or the `errors` array is non-empty, surface that to the user instead of pretending the data is complete.

## Notes

- Performance: each subcommand should finish in <500ms. Bao tokens are cached in `/tmp/lemon-bao-token-<app>` for 5 minutes.
- Container matching is by substring of the container name; multi-service apps (`plane-proxy-1`, `plane-worker-1`) may match the wrong one — fall back to `docker ps | grep <app>` if precision matters.
- Adding a subcommand: drop a file in `~/lemon-cli/lemon_cli/commands/`, register in `main.py`.

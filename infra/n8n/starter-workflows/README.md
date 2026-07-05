# Starter workflows

Generic n8n workflow JSON ready to import after templates are rendered. After importing, configure credentials in the n8n UI — these JSON files do **not** embed credential IDs (those are install-specific).

## Bulk import

```bash
N8N_API_KEY=$(cat ~/.n8n-api-key)         # set this once
for f in *.json; do
  echo "importing $f"
  curl -s -X POST "http://localhost:5678/api/v1/workflows" \
    -H "X-N8N-API-KEY: $N8N_API_KEY" -H "Content-Type: application/json" \
    -d @"$f" | python3 -c "import json,sys; d=json.load(sys.stdin); print('  ->', d.get('id', d))"
done
```

Workflows ship inactive. Activate them from the n8n UI once you've wired credentials.

## What ships

| File | What it does | Cron | Needs |
|---|---|---|---|
| `service-uptime-monitor.json` | Pings each `<app>.{{DOMAIN}}`, posts a Telegram alert if any is down. Edit the URL list in the first node. | every 5 min | tg-notify reachable on `lemon-internal` |
| `disk-usage-alert.json` | Polls `server-cmd` for `df -h /`, alerts when root usage > 85%. | hourly | `server-cmd` listening on `host.docker.internal:10021`; tg-notify |
| `watchtower-weekly-digest.json` | Pulls the last week of Watchtower update notifications and posts a digest. | Mondays | tg-notify |
| `daily-backup-digest.json` | Reads `~/backup.log` via `server-cmd`, posts a Telegram summary. | daily 08:00 | tg-notify; `server-cmd`; backup cron in place |
| `daily-claude-code-session.json` | POSTs a "what should I look at today" prompt to `claude-runner` (`/run/scheduled`). | daily 08:30 | `claude-runner` running on `:9879`; the `server-maintainer` agent installed |
| `weekly-security-audit.json` | Invokes the `security-auditor` agent via `claude-runner`. Files a Plane ticket per run with fail2ban, auth.log, port-audit, Authentik failed-login, stale-image, and UFW findings. | Sundays 09:00 | `claude-runner` running; `security-auditor` agent installed; `lemon port-audit` available |

## Network gotcha

These workflows reach two kinds of services:

- **Other containers** (e.g. `tg-notify`) via the `lemon-internal` Docker network — uses the container name, e.g. `http://tg-notify:8080/send`. n8n must be attached to `lemon-internal`.
- **Host-bound services** (e.g. `server-cmd` listening as a systemd unit on `127.0.0.1:10021`, and `claude-runner` on `127.0.0.1:9879`) — these are NOT Docker containers, so the workflows use `http://host.docker.internal:<port>`. The `host.docker.internal` hostname requires `extra_hosts: ["host.docker.internal:host-gateway"]` on the n8n compose service (already set in `infra/n8n/docker-compose.yml.template`).

If you change a port or move a host service into a container, edit the corresponding workflow node — the JSON still uses the legacy literal in the few places where the template wouldn't read sensibly.

## Daily Claude Code Session prompt

The `daily-claude-code-session` workflow expects `claude-runner` to invoke the `server-maintainer` agent. The current prompt body is generic; replace it with whatever you want the agent to do each morning. A minimal example:

```
Run your daily server maintenance routine. Open a single Plane ticket, run
verify-install, check drift, summarise findings to tg-notify, close the ticket.
```

`claude-runner`'s `scheduled.sh` handler will invoke `claude --agent server-maintainer -p "<prompt>"` if you set `CLAUDE_AGENT=server-maintainer` in the workflow body's JSON (the runner forwards extra keys as env vars).


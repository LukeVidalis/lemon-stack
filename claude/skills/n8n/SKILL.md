---
name: n8n
description: "Use when creating, importing, activating, or debugging n8n workflows or credentials via the REST API — including webhooks that stopped firing after a change"
allowed-tools:
  - Bash
  - Read
  - Write
---

# n8n Skill

n8n runs at `n8n.{{DOMAIN}}` (container port 5678, accessible at `http://localhost:5678` on the host).

---

## API access

```bash
N8N_API_KEY=$(grep '^N8N_API_KEY=' ~/.config/lemon/n8n.env | cut -d= -f2)
BASE="http://localhost:5678/api/v1"
```

The API key lives in `~/.config/lemon/n8n.env` (mode 600, host-only) — **never hardcode it in skills, scripts, or the lemon CLI**. Key name in n8n: `claude-automation`. Scopes: workflow CRUD, credential CRUD, tag CRUD, workflow:activate. To rotate: stop n8n, swap the value in `user_api_keys` via host sqlite3 on the volume DB, start n8n, update the env file (last rotated 2026-07-05, {{PLANE_PROJECT_PREFIX}}-124).

---

## Common operations

### List all workflows
```bash
curl -s "$BASE/workflows?limit=50" -H "X-N8N-API-KEY: $N8N_API_KEY" | \
  python3 -c "import json,sys; [print(f\"{w['id']}  active={w['active']}  {w['name']}\") for w in json.load(sys.stdin)['data']]"
```

### Get a workflow
```bash
curl -s "$BASE/workflows/<id>" -H "X-N8N-API-KEY: $N8N_API_KEY"
```

### Import (create) a workflow from JSON file
```bash
curl -s -X POST "$BASE/workflows" \
  -H "X-N8N-API-KEY: $N8N_API_KEY" \
  -H "Content-Type: application/json" \
  -d @workflow.json
```
Returns the created workflow including its assigned `id`.

### Activate a workflow
```bash
curl -s -X POST "$BASE/workflows/<id>/activate" -H "X-N8N-API-KEY: $N8N_API_KEY"
```

> ⚠️ **Always activate via the API, never by setting `active=1` in SQLite directly.** Direct DB edits bypass webhook registration (no write to `webhook_entity` or the in-memory registry) — webhooks silently stop responding. If that happened, re-activate via this endpoint. The API key needs the `workflow:activate` scope.

### Deactivate a workflow
```bash
curl -s -X POST "$BASE/workflows/<id>/deactivate" -H "X-N8N-API-KEY: $N8N_API_KEY"
```

### Update a workflow (full replace)
```bash
curl -s -X PUT "$BASE/workflows/<id>" \
  -H "X-N8N-API-KEY: $N8N_API_KEY" \
  -H "Content-Type: application/json" \
  -d @workflow.json
```

### Delete a workflow
```bash
curl -s -X DELETE "$BASE/workflows/<id>" -H "X-N8N-API-KEY: $N8N_API_KEY"
```

### Trigger a workflow manually (webhook-triggered workflows)
For webhook-triggered workflows, POST to their webhook URL. For manual triggers, use the n8n UI.

### List executions
```bash
curl -s "$BASE/executions?limit=20&workflowId=<id>" -H "X-N8N-API-KEY: $N8N_API_KEY"
```

### List credentials
```bash
curl -s "$BASE/credentials?limit=50" -H "X-N8N-API-KEY: $N8N_API_KEY" | \
  python3 -c "import json,sys; [print(f\"{c['id']}  type={c['type']}  {c['name']}\") for c in json.load(sys.stdin)['data']]"
```

---

## Existing workflows

> **Snapshot (2026-06) — list live with `lemon n8n ls` before relying on this.** IDs are stable; the set and active flags drift.

| ID | Name | Active |
|---|---|---|
| `opRs4SGsCwzkqhKr` | Daily Claude Code Session | ✅ |
| `yjK7F7eYJkrAE0Zy` | Plane → Claude Code | ✅ |
| `5dRGe5P0NrxbNDX2` | Plane → GitHub Copilot | ✅ |
| `U7gNedHh1UCjR0yC` | My workflow (Telegram bot commands) | ✅ |
| `HWycGViteLrNRPKL` | tg-notify: Send Telegram | ✅ |
| `QSY7uLG7Cz4fIbdj` | Disk Usage Alert | ✅ |
| `8rhIO2qQrikEtSRC` | Service Uptime Monitor | ✅ |
| `zwPyZSFyLrKSWIbT` | Daily Backup Digest | ✅ |
| `frcJOagDlT3tEDiG` | Watchtower Weekly Digest | ✅ |
| `IswkROnPiXetcoYk` | Weekly Plane Issue Digest | ✅ |
| `EnydIXkUO1IJ42zj` | Clothes Tagger Workflow | ✅ |
| `HJgXH3igG25a2x0v` | Tesco Receipt Backfill | ✅ |
| `SiyEPN6HLxVgcESL` | Tesco Receipt → Food Splitter | ✅ |
| `wellhubGymAccessTelegram` | Wellhub Gym Access Link to Telegram | ✅ |

---

## Existing credentials

> **Snapshot (2026-06)** — verify live via the List credentials command above.

| ID | Name | Type |
|---|---|---|
| `wWCqKaCTkTKBD56d` | server-cmd API | httpHeaderAuth |
| `WLERegIj33Xn9v90` | tg-notify API | httpHeaderAuth |
| `qOS99OLwRxunoaM9` | food bot | telegramApi |
| `m38vJqhqHr81ODFB` | Wardrobe Helper Bot | telegramApi |
| `XNQXbwvjFdSbG1WX` | Gmail account | gmailOAuth2 |
| `XgmcmTr2KmFDWOrm` | Google Sheets account | googleSheetsOAuth2Api |
| `QSPbgdjpIzK3ZltT` | Notion account | notionApi |
| `rUrbyNzBuzqEg2YY` | OpenAi account | openAiApi |

---

## Patterns used in existing workflows

### Calling host commands (server-cmd)
```json
{
  "type": "n8n-nodes-base.httpRequest",
  "parameters": {
    "method": "POST",
    "url": "http://host.docker.internal:10021/cmd",
    "authentication": "predefinedCredentialType",
    "nodeCredentialType": "httpHeaderAuth",
    "sendBody": true,
    "specifyBody": "json",
    "jsonBody": "={{ JSON.stringify({ command: '/some-command' }) }}"
  },
  "credentials": { "httpHeaderAuth": { "id": "wWCqKaCTkTKBD56d", "name": "server-cmd API" } }
}
```

### Calling the claude-runner (unified)
All three legacy runners (`scheduled-claude`, `plane-claude`, `plane-copilot`) are consolidated into one Python HTTP server on the host: `~/claude-runner/runner.py`, systemd unit `claude-runner.service`. Logs live under `~/claude-runner/logs/` in the `scheduled`, `plane-claude`, and `plane-copilot` subdirectories.

**Preferred (unified) endpoint** — port 9879:
- `POST http://host.docker.internal:9879/run/scheduled` (JSON with `prompt`, `work_dir`, `label`)
- `POST http://host.docker.internal:9879/run/plane-claude` (JSON with `issue_id`, `issue_title`, `issue_description`, `issue_sequence_id`)
- `POST http://host.docker.internal:9879/run/plane-copilot` (same payload as plane-claude)

**Legacy compatibility ports** — same service also listens on the old ports for existing workflows:
- `http://host.docker.internal:9876/run-task` → `plane-claude`
- `http://host.docker.internal:9877/run-task` → `plane-copilot`
- `http://host.docker.internal:9878/run-task` → `scheduled`

**UFW rules required** — all four runner ports need UFW rules to allow Docker → host traffic. If a workflow times out connecting to the runner, check these rules exist:
```bash
sudo ufw allow in from 172.16.0.0/12 to {{SERVER_IP}} port 9878 comment "scheduled runner from Docker"
sudo ufw allow in from 192.168.0.0/16 to {{SERVER_IP}} port 9878 comment "scheduled runner from LAN Docker"
sudo ufw allow in from 172.16.0.0/12 to {{SERVER_IP}} port 9879 comment "unified runner from Docker"
sudo ufw allow in from 192.168.0.0/16 to {{SERVER_IP}} port 9879 comment "unified runner from LAN Docker"
# 9876 and 9877 were added earlier; verify all four with: sudo ufw status numbered | grep 987
```
Test reachability from inside n8n: `docker exec n8n wget -qO- --timeout=3 http://host.docker.internal:9878/health`

### Sending notifications via tg-notify
Use `http://tg-notify:8080/send` with credential `tg-notify API` (`WLERegIj33Xn9v90`). n8n and tg-notify share the `lemon-internal` Docker network. The credential is `httpHeaderAuth` type configured as `Authorization: Bearer <api_secret>`. **Never use `host.docker.internal:10020`** — tg-notify binds to `127.0.0.1` which is not reachable via the host gateway IP that n8n resolves `host.docker.internal` to. Always use the internal Docker hostname. If tg-notify is ever redeployed, confirm it still has `lemon-internal` in its `docker-compose.yml` — losing that network silently breaks all n8n notification workflows.

---

## Infrastructure

- **Container**: `n8n` (image: `docker.n8n.io/n8nio/n8n`)
- **Compose**: `~/docker/n8n/docker-compose.yml`
- **Data volume**: `n8n_n8n_data` → `/var/lib/docker/volumes/n8n_n8n_data/_data/`
- **DB**: SQLite at `database.sqlite` in the data volume
- **URL**: `https://n8n.{{DOMAIN}}` (no Authentik SSO — n8n has its own auth)
- **Host port**: `127.0.0.1:5678`

---

## Workflow JSON structure (minimal schedule → HTTP example)

```json
{
  "name": "My Workflow",
  "nodes": [
    {
      "id": "node-1",
      "name": "Schedule Trigger",
      "type": "n8n-nodes-base.scheduleTrigger",
      "typeVersion": 1.2,
      "position": [240, 300],
      "parameters": {
        "rule": { "interval": [{ "field": "cronExpression", "expression": "0 6 * * *" }] }
      }
    },
    {
      "id": "node-2",
      "name": "HTTP Request",
      "type": "n8n-nodes-base.httpRequest",
      "typeVersion": 4.2,
      "position": [480, 300],
      "parameters": {
        "method": "POST",
        "url": "http://host.docker.internal:9879/run/scheduled",
        "sendBody": true,
        "specifyBody": "json",
        "jsonBody": "={\"prompt\": \"do something\"}"
      }
    }
  ],
  "connections": {
    "Schedule Trigger": { "main": [[{ "node": "HTTP Request", "type": "main", "index": 0 }]] }
  },
  "settings": { "executionOrder": "v1" }
}
```

After creating, always activate:
```bash
curl -s -X POST "$BASE/workflows/<returned-id>/activate" -H "X-N8N-API-KEY: $N8N_API_KEY"
```

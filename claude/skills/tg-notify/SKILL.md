---
name: tg-notify
description: "Use when a script, app, cron job, or n8n workflow needs to send a Discord notification to the user, or when deploy/backup/alerts aren't arriving. Discord is the only active provider — Telegram code exists but is unused."
allowed-tools:
  - Bash
  - Read
  - Edit
---

# tg-notify Skill

`tg-notify` is a lightweight HTTP service that sends alert messages to Loukas via **Discord** (the only active provider). Any app, script, cron job, or n8n workflow POSTs to it. Telegram support is in the code but `PROVIDER=telegram` is not in use.

The `/send` API accepts an optional `channel` field to route to a specific Discord channel. Unknown or absent channel falls back to the default.

---

## Architecture

```
app / script / n8n
  └─ POST /send (Bearer token) + optional channel field
       └─ tg-notify (host port 10020, container port 8080 on lemon-internal)
            └─ Discord REST API
                 └─ Discord server channels
```

- **Repo**: `{{GITHUB_ORG}}/tg-notify` → `tg-notify.{{DOMAIN}}`
- **Compose**: `~/docker/tg-notify/`
- **Secrets**: OpenBao (`secret/apps/tg-notify/<KEY>`) first, `~/docker/tg-notify/secrets.env` (mode 600) as fallback
  - `API_SECRET` — bearer token used by all callers (always required)
  - `PROVIDER=discord` — **active**; `telegram` is present in code but unused
  - `DISCORD_BOT_TOKEN` — Discord bot token
  - `DISCORD_CHANNEL_ID` — default/fallback channel (`280779641118130176`)
  - `DISCORD_CHANNEL_ID_DEPLOYS` — `1519675559511199845` (#deploys)
  - `DISCORD_CHANNEL_ID_ALERTS` — `1519675613772775474` (#alerts)
  - `DISCORD_CHANNEL_ID_BACKUPS` — `1519675659553607772` (#backups)
  - `DISCORD_CHANNEL_ID_DIGESTS` — `1519678326124445796` (#digests)
  - `ALLOWED_USER_IDS` — Discord user IDs allowed to interact (buttons/slash/modals)
  - `DISCORD_GUILD_ID` — guild for slash-command registration (`280779641118130176`)
  - `CLAUDE_RUNNER_SECRET` — auth to claude-runner's `/run/*` endpoints
  - `PROMPT_DB_PATH` — SQLite prompt store (`/data/prompts.db`, bind mount `~/docker/tg-notify/data`)
  - `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID` — kept for easy rollback, not active
- **Auth**: Bearer token only — no Authentik SSO (`auth=none` in deploy.conf)
- **Ports / networks**: host-local `127.0.0.1:10020`; container port `8080` on Docker network `lemon-internal` for n8n/internal containers

---

## API

### POST /send
```
Authorization: Bearer <API_SECRET>
Content-Type: application/json

{
  "message": "text to send",
  "level":   "info | warn | error | success",     // optional, default: info
  "title":   "bold heading",                       // optional
  "channel": "deploys | alerts | backups | digests | <raw channel ID>",  // optional, default: general
  "buttons": [                                     // optional — Discord action row buttons
    { "label": "Restart foo", "action": "restart_container:foo", "style": "danger" },
    { "label": "Investigate", "prompt": "full-length Claude prompt — any size", "style": "primary" },
    { "label": "Dismiss",     "action": "dismiss",               "style": "secondary" }
  ],
  "menu": {                                        // optional — string-select dropdown (max 25 options)
    "placeholder": "Pick a fix…",
    "options": [
      { "label": "Fix A", "description": "safe option", "prompt": "apply fix A: …full detail…" },
      { "label": "Just restart", "action": "restart_container:foo" }
    ]
  }
}
```
Returns `{ "ok": true }` on success, `{ "error": "..." }` on failure.

Level maps to prefix emoji: ℹ️ info · ⚠️ warn · 🚨 error · ✅ success

#### Button / menu-option fields
| Field | Values | Notes |
|---|---|---|
| `label` | any string | Max 80 chars, shown on button |
| `action` | `restart_container:<name>`, `get_logs:<name>`, `dismiss`, `run_claude:<short prompt>`, `modal:ask[:<session_id>]` | See action reference below |
| `prompt` | any string, **any length** | Alternative to `action`: stored in the SQLite prompt store (`/data/prompts.db`), button gets a short `claude_ref:<id>`; click spawns a Claude session with the full prompt. **Preferred over `run_claude:` for anything non-trivial.** |
| `style` | `primary`, `secondary`, `success`, `danger` | Default: `secondary` |

Max 5 buttons per message. `ALLOWED_CONTAINERS` env holds real container names (compose apps use their `-api-1`/`-app-1` suffixed names) — check the runtime compose at `~/docker/tg-notify/docker-compose.yml` for the current list.

#### Button action reference

| Action | Effect | Notes |
|---|---|---|
| `dismiss` | Edits message to "Dismissed ✓", removes buttons | Immediate |
| `restart_container:<name>` | Strips the message's buttons (double-click guard), calls server-cmd `/restart <name>` | Deferred; follow-up shows output |
| `get_logs:<name>` | Calls server-cmd `/logs <name> 30` | Deferred; follow-up shows last 30 lines |
| `run_claude:<prompt>` | Spawns a Claude session (claude-runner `discord-ask`, Sonnet 5) | Prompt ≤ ~88 chars — use a `prompt` field instead for anything longer |
| `claude_ref:<id>` | Same, with the full prompt loaded from the store | Generated automatically from `prompt` fields — never hand-write |
| `modal:ask[:<session_id>]` | Opens a free-text modal; submission spawns (or `--resume`s) a Claude session | Completion messages add this automatically as "Ask follow-up" |

All Claude-bound clicks automatically get the **originating message's content prepended as context**, and the result is **posted back to the same channel** with "Ask follow-up" (resumes the session) and "Run again" buttons.

#### Slash commands (registered in the guild)

`/ask <prompt>`, `/status`, `/logs <container> [lines]`, `/restart <container>` — handled by the same `/interactions` endpoint. Re-register after changes with `register-discord-commands.js` (in the repo; needs `DISCORD_GUILD_ID`).

#### Interaction security

- `ALLOWED_USER_IDS` env — comma-separated Discord user IDs allowed to use buttons/menus/modals/slash commands (currently Loukas: `279399999073288192`). Others get an ephemeral "Not authorized".
- tg-notify authenticates to claude-runner with `X-Runner-Secret` (`CLAUDE_RUNNER_SECRET`, mirrored in the claude-runner systemd drop-in).

---

## When Claude should include buttons

**Always add buttons when sending to `"channel":"alerts"`** for a specific container. Standard pattern:

```json
"buttons": [
  {"label": "Restart <name>", "action": "restart_container:<name>", "style": "danger"},
  {"label": "View logs",      "action": "get_logs:<name>",          "style": "secondary"},
  {"label": "Dismiss",        "action": "dismiss",                   "style": "secondary"}
]
```

**Specific guidance by alert type:**

| Situation | Buttons to include |
|---|---|
| Container down / unhealthy | Restart + View logs + Dismiss |
| High memory / swap on a container | Restart + View logs + Dismiss |
| Deploy failure for a known container | View logs (restart not appropriate mid-deploy) |
| OpenBao sealed | Dismiss only (unsealing requires human action, not server-cmd) |
| Backup failure | Dismiss only (no server-cmd action for backups) |
| General info/digest messages | No buttons |

**Don't add buttons** for: success notifications, digest reports, or anything where there's no relevant action the user would want to take inline.

**Style guide:** `danger` for destructive actions (restart), `secondary` for read-only (logs, dismiss), `primary` or `success` for confirmations (Yes, do it).

---

## Confirmational questions ("Would you like me to…?")

When Claude needs user approval before taking an action, send a tg-notify message phrased as a question and include a `run_claude` button so the user can confirm with one click in Discord.

**Pattern:**
```json
{
  "embed": {
    "title": "❓ Restart photoprism?",
    "description": "Swap usage is at 2.1 GB. Would you like me to restart it?",
    "color": "warn",
    "footer": "lemon-server · awaiting confirmation"
  },
  "channel": "alerts",
  "buttons": [
    {"label": "Yes, restart", "action": "run_claude:restart the photoprism container and notify me when done", "style": "primary"},
    {"label": "Dismiss",      "action": "dismiss", "style": "secondary"}
  ]
}
```

**Prefer `prompt` fields over `run_claude:` actions** — no length limit, so load the prompt with everything a cold session needs (symptoms, timestamps, log excerpts, exact file paths). Example:

```json
{"label": "Yes, investigate", "style": "primary",
 "prompt": "photoprism swap hit 2.1GB at 03:12; docker logs show repeated indexing OOM. Check the compose mem limit at ~/docker/photoprism/, decide whether to raise it or restart, do it, and send a tg-notify summary when done."}
```

For multi-choice decisions use `menu` instead of several buttons — each option carries its own full prompt.

**Rules for Claude-bound prompts:**
- Be specific enough that a cold Claude session can act without extra context (the alert message text is prepended automatically, but don't rely on it alone)
- The result is posted back to the same channel automatically — no need to say "notify me"
- Do NOT use for actions already covered by `restart_container` / `get_logs` — those are faster

### GET /health
Returns `{ "ok": true }`. No auth required.

---

## Channel routing

| `channel` value | Discord channel | Who sends here |
|---|---|---|
| `"deploys"` | #deploys | `deploy.sh` success/failure |
| `"alerts"` | #alerts | `docker-health-monitor.sh`, `sealed-alert.sh` |
| `"backups"` | #backups | `backup.sh` success/failure |
| `"digests"` | #digests | digest/report workflows |
| raw numeric ID | that channel | claude-runner `discord-ask` completions (reply in originating channel) |
| absent / unknown | #general (default) | morning digest, skill-notify, `/ask` responses, n8n workflows |

---

## Sending from a shell script

```bash
API_SECRET=$(grep '^API_SECRET=' ~/docker/tg-notify/secrets.env | cut -d= -f2-)

# With channel routing
curl -s -X POST http://localhost:10020/send \
  -H "Authorization: Bearer $API_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"message":"Deploy succeeded","level":"success","title":"my-app","channel":"deploys"}'

# Without channel (goes to default)
curl -s -X POST http://localhost:10020/send \
  -H "Authorization: Bearer $API_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"message":"Something happened","level":"info","title":"my-app"}'
```

---

## Getting the API secret

```bash
grep '^API_SECRET=' ~/docker/tg-notify/secrets.env | cut -d= -f2-
```

---

## Sending from n8n

Use an **HTTP Request** node:
- Method: `POST`
- URL: `http://tg-notify:8080/send`
- Authentication: Header Auth → `Authorization: Bearer <API_SECRET>`
- Body (JSON):
  ```json
  { "message": "{{ $json.someField }}", "level": "info", "title": "n8n" }
  ```

n8n reaches `tg-notify` over the shared `lemon-internal` Docker network. Do not use `host.docker.internal:10020` from n8n; the host port is bound to loopback for host scripts.

---

## Built-in integrations

### Deploy pipeline (`~/deploy/deploy.sh`)
- ✅ success → `"channel":"deploys"`
- 🚨 failure → `"channel":"deploys"`

### Backup (`~/backup.sh`)
- ✅ success → `"channel":"backups"`
- 🚨 failure → `"channel":"backups"`

### Docker health monitor (`~/scripts/docker-health-monitor.sh`)
- 🚨 container down → `"channel":"alerts"` (de-duped via md5 state file)

### OpenBao sealed alert (`~/docker/openbao/sealed-alert.sh`)
- 🚨 sealed/unknown state → `"channel":"alerts"`
- ℹ️ recovery → `"channel":"alerts"`

---

## Adding a new integration

```bash
tg_notify() {
    local level="$1" title="$2" message="$3" channel="${4:-}"
    local secret
    secret=$(grep '^API_SECRET=' {{USER_HOME}}/docker/tg-notify/secrets.env | cut -d= -f2-)
    local channel_json=""
    [[ -n "$channel" ]] && channel_json=",\"channel\":\"$channel\""
    curl -sf -X POST http://localhost:10020/send \
        -H "Authorization: Bearer $secret" \
        -H "Content-Type: application/json" \
        -d "{\"level\":\"$level\",\"title\":\"$title\",\"message\":\"$message\"${channel_json}}" \
        > /dev/null 2>&1 || true
}
```

The `|| true` ensures notification failures never break the calling script.

## Adding a new Discord channel

1. Create the channel in Discord, copy its ID (Developer Mode → right-click → Copy Channel ID)
2. Add `DISCORD_CHANNEL_ID_<NAME>=<id>` to `~/docker/tg-notify/secrets.env` and `~/docker/tg-notify/docker-compose.yml`
3. Add the entry to `DISCORD_CHANNEL_MAP` in `~/tg-notify/index.js`
4. Push the source change → auto-deploys with the new channel available

---

## Verification

```bash
# Health check
curl http://localhost:10020/health

# Test all channels
API_SECRET=$(grep '^API_SECRET=' ~/docker/tg-notify/secrets.env | cut -d= -f2-)
for ch in deploys alerts backups; do
  curl -s -X POST http://localhost:10020/send \
    -H "Authorization: Bearer $API_SECRET" \
    -H "Content-Type: application/json" \
    -d "{\"message\":\"test\",\"level\":\"info\",\"title\":\"ping: $ch\",\"channel\":\"$ch\"}"
done

# Logs
docker logs tg-notify --tail 50
```

---

## Common issues

| Symptom | Fix |
|---|---|
| `401 Unauthorized` | Wrong or missing `API_SECRET` — check `~/docker/tg-notify/secrets.env` |
| `502 Bad Gateway` | Discord rejected the request — `docker logs tg-notify` shows the error. Check `DISCORD_BOT_TOKEN`, bot has Send Messages in the target channel, `DISCORD_CHANNEL_ID` is correct |
| Message goes to wrong channel | Check that `DISCORD_CHANNEL_ID_<NAME>` is set in both `secrets.env` and the runtime compose, and that the container was restarted after adding it |
| Container exits on boot | Missing/invalid env for the selected `PROVIDER` — `docker logs tg-notify` prints exactly which var is missing |
| n8n timeout to `host.docker.internal:10020` | Use `http://tg-notify:8080/send`; n8n and tg-notify share `lemon-internal` |
| Container not running | `docker restart tg-notify` |

---

## Switching back to Telegram

```bash
# Edit secrets.env
sed -i 's/^PROVIDER=discord/PROVIDER=telegram/' ~/docker/tg-notify/secrets.env
# Restart
cd ~/docker/tg-notify && docker compose up -d
```

No caller changes needed — the `/send` contract is identical for both providers. The `channel` field is ignored when `PROVIDER=telegram`.

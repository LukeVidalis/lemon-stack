---
name: server-cmd
description: Host-level command API for lemon-server — runs whitelisted shell/docker commands, called by the Telegram bot via n8n. How to add new commands, restart the service, and extend.
allowed-tools:
  - Bash
  - Read
  - Edit
---

# server-cmd Skill

`server-cmd` is a tiny Node.js HTTP API running as a **systemd service directly on the host** (not in Docker). This gives it native access to `docker`, shell scripts, and the filesystem — things containers can't easily do without socket mounts.

The Telegram food bot's n8n workflow calls it whenever a message starts with `/`, then replies with the output.

---

## Key facts

- **Repo**: `{{GITHUB_ORG}}/server-cmd` (local: `~/server-cmd/`)
- **Runs as**: systemd service `server-cmd.service`, user `lemon`
- **Binds**: `127.0.0.1:10021` (host-only, not routed through Caddy)
- **Auth**: Bearer token stored in `~/server-cmd/secret` (mode 600)
- **n8n credential**: `server-cmd API` (id: `wWCqKaCTkTKBD56d`)

---

## Service management

```bash
sudo systemctl status server-cmd
sudo systemctl restart server-cmd
sudo systemctl stop server-cmd
journalctl -u server-cmd -f          # live logs
```

After editing `~/server-cmd/index.js`:
```bash
sudo systemctl restart server-cmd
```

No deploy pipeline — changes take effect immediately on restart.

---

## Available commands (sent via Telegram)

| Command | What it does |
|---|---|
| `/status` | Running containers (docker ps) |
| `/containers` | All containers incl. stopped |
| `/restart <name>` | `docker restart <name>` |
| `/start <name>` | `docker start <name>` |
| `/stop <name>` | `docker stop <name>` |
| `/logs <name> [lines]` | Tail container logs (max 100) |
| `/disk` | `df -h / /home` |
| `/backup` | Fire-and-forget `~/backup.sh` |
| `/backuplog` | Last backup run summary |
| `/watchtower` | Watchtower update digest (last 7d) |
| `/ask <prompt>` | Spawn a headless Claude session (Sonnet 5); immediate ACK, response delivered async via tg-notify to #general. If sent as a **reply to a thread**, the original message is included as context for Claude. (Discord users: prefer the native `/ask` slash command handled by tg-notify's `/interactions` — it posts back to the invoking channel and supports follow-up modals.) |
| `/help` | Lists all commands |

---

## Adding a new command

Edit `~/server-cmd/index.js` and add a handler to the `COMMANDS` object:

```js
async mycommand([arg1, arg2]) {
  if (!arg1) return 'Usage: /mycommand <arg>';
  const out = await run(`some-shell-command ${arg1}`);
  return out || '(no output)';
},
```

Then restart:
```bash
sudo systemctl restart server-cmd
git -C ~/server-cmd add index.js && git -C ~/server-cmd commit -m "Add /mycommand" && git -C ~/server-cmd push
```

Rules:
- Handlers are async, receive `args` as a string array
- Return a string — it gets sent back as the Telegram reply (max 3900 chars, auto-truncated)
- Use `run(cmd, timeoutMs?)` for shell commands — throws on non-zero exit
- Never accept raw user input into shell commands without validation — container-name args must pass `validContainer()` (`/^[A-Za-z0-9][A-Za-z0-9_.-]*$/`); reuse it for any new command taking a name argument

---

## How n8n calls it

In **"My workflow"** (id: `U7gNedHh1UCjR0yC`):

```
Telegram Trigger → Authorised User? → Is Command? (starts with /)
                                             ↓ YES
                                        Run Command (HTTP POST /cmd)
                                             ↓
                                        Reply Command (Telegram)
                                             ↓ NO
                                        Basic LLM Chain → Send a text message
```

The **Run Command** node POSTs to `http://host.docker.internal:10021/cmd` with `{ "command": "<message text>", "reply_context": "<text of replied-to message or null>" }` using the `server-cmd API` credential. Only `/ask` uses `reply_context`; all other commands ignore it.

---

## API reference

### POST /cmd
```
Authorization: Bearer <secret>
Content-Type: application/json

{ "command": "/logs tg-notify 50", "reply_context": null }
→ { "output": "..." }
```

`reply_context` is optional. When present and non-empty, `/ask` prepends it to the Claude prompt as `Context (message being replied to): ...`.

### GET /health
```
→ { "ok": true }
```

---

## Secret

```bash
cat ~/server-cmd/secret          # read it
openssl rand -hex 32 > ~/server-cmd/secret  # rotate it (then update n8n credential)
```

If you rotate the secret, update the n8n credential **`server-cmd API`** (id: `wWCqKaCTkTKBD56d`) in n8n Settings → Credentials.

---

## Systemd unit

`/etc/systemd/system/server-cmd.service` — runs as user `lemon`, auto-restarts on failure.

Node path: `{{USER_HOME}}/.nvm/versions/node/v24.14.1/bin/node` (hardcoded in unit — update if nvm version changes).

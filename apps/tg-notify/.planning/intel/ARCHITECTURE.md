---
updated_at: 2026-05-18T00:00:00Z
generated_by: intel-updater
---

# Architecture

## What it does
tg-notify is a single-purpose Telegram notification microservice. It exposes one HTTP endpoint (`POST /send`) that any app, script, or n8n workflow on lemon-server can call to push a formatted message to Loukas's Telegram chat. It is the central notification hub — callers never hold a bot token.

## Tech stack
- **Runtime:** Node.js 22 (Alpine Docker image)
- **Framework:** Express 4.x (`"express": "^4.19.2"` in `package.json`)
- **Module system:** ESM (`"type": "module"`)
- **No build step** — source runs directly with `node index.js`

## Services / processes
- Single process: Express HTTP server on port 8080 (internal), bound to `127.0.0.1:10020` on host (see [DEPLOY.md](DEPLOY.md))

## External dependencies
- **Telegram Bot API** — `https://api.telegram.org/bot<token>/sendMessage` (outbound HTTPS, no inbound)
- **No database, no queue**
- Attached to `lemon-internal` Docker network so other containers reach it at `http://tg-notify:8080`

## Data flow
1. Caller POSTs `{ message, level?, title? }` with `Authorization: Bearer <API_SECRET>`
2. `auth()` middleware validates bearer token against `API_SECRET` env var
3. `sendTelegram()` builds HTML-formatted text (emoji prefix + optional bold title)
4. Outbound POST to Telegram Bot API with `parse_mode: 'HTML'`
5. Returns `{ ok: true }` or `{ error: "..." }` with appropriate HTTP status

## Auth model
Bearer token (`API_SECRET` env var) on `POST /send`; no Authentik SSO (deploy.conf `auth=none`). `GET /health` requires no auth.

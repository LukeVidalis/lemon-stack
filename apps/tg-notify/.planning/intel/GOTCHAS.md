---
updated_at: 2026-05-18T00:00:00Z
generated_by: intel-updater
---

# Gotchas

## Call `http://tg-notify:8080/send` from Docker containers, not the host port
The host-bound port `127.0.0.1:10020` is for shell scripts on the server only. Docker containers (n8n, other apps) must use `http://tg-notify:8080` over the `lemon-internal` network — otherwise the call fails or bypasses the network isolation. See CLAUDE.md Quirk #10.

## No Authentik SSO — bearer token is the only guard
`deploy.conf` sets `auth=none`, so Caddy does not apply forward auth. The public URL `tg-notify.{{DOMAIN}}` is accessible without SSO — it relies entirely on `API_SECRET`. Never remove the `auth` middleware from `POST /send`.

## Service crashes on missing env vars at startup, not at request time
`TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, and `API_SECRET` are validated at startup (`index.js:13–18`). A missing secret causes immediate `process.exit(1)` — the container won't start and won't pass health checks.

## `parse_mode: 'HTML'` in Telegram messages — escape user-controlled content
`sendTelegram()` passes `text` directly with `parse_mode: 'HTML'`. If a caller supplies `<` or `>` in `message` or `title`, Telegram may reject or misparse it. Callers are responsible for escaping; the service does not sanitize.

## No persistent storage or state
The service is fully stateless. Restarting the container loses nothing. There is no volume, no DB, nothing to back up for this service specifically.

## ESM-only (`"type": "module"`) — CommonJS require() won't work
`package.json` sets `"type": "module"`. Adding any CommonJS-style dependency or `require()` call will crash at startup. Keep all imports as `import` statements.

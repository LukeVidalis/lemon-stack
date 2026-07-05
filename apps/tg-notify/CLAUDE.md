# tg-notify

Centralized Telegram notification microservice. Any app or script on lemon-server POSTs to it to send a message to Loukas's Telegram.

## API

### POST /send
```
Authorization: Bearer <API_SECRET>
Content-Type: application/json

{ "message": "text", "level": "info|warn|error|success", "title": "optional bold title" }
```
Returns `{ "ok": true }` on success.

### GET /health
Returns `{ "ok": true }`. No auth required.

## Deployment

Auto-deploys to lemon-server via `{{GITHUB_ORG}}` GitHub org.
Push to `main` → live at `https://tg-notify.{{DOMAIN}}` (~2 min).

- No Authentik SSO (`auth=none` in deploy.conf) — bearer token handles auth
- Secrets at `~/docker/tg-notify/secrets.env` (mode 600)

## Auth choices
- **Multi-user:** no — always notifies one person (Loukas)
- **SSO-aware login flow:** no — internal API only
- **Logout button:** no — no frontend

## Secrets (~/docker/tg-notify/secrets.env)
```
TELEGRAM_BOT_TOKEN=<food bot token>
TELEGRAM_CHAT_ID={{TELEGRAM_CHAT_ID}}
API_SECRET=<random secret>
```

## Calling from shell scripts
```bash
curl -s -X POST https://tg-notify.{{DOMAIN}}/send \
  -H "Authorization: Bearer $TG_NOTIFY_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"message":"Deploy succeeded","level":"success","title":"tg-notify"}'
```

## Useful commands
- `docker logs tg-notify --tail 50`
- `docker restart tg-notify`

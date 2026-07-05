---
updated_at: 2026-05-24T00:00:00Z
generated_by: intel-updater
---

# Deploy

## Subdomain
`tg-notify.{{DOMAIN}}` — no `Caddyfile.fragment` in repo; uses single-service default Caddy routing.

## Ports
- Internal (container): `8080`
- Host binding: `127.0.0.1:10020` (from `~/deploy/ports.json` entry `"tg-notify": 10020`)
- See CLAUDE.md Critical Quirk #3 for why all ports bind 127.0.0.1

## Container image
- Base: `node:22-alpine` (single stage — no build stage, source runs directly)
- `npm ci --omit=dev` — only production deps installed
- No transpilation or bundling step

## Docker network
- Attached to `lemon-internal` network by deploy pipeline
- Internal callers: `http://tg-notify:8080/send` (do NOT use `host.docker.internal:10020`)
- See CLAUDE.md Critical Quirk #10 for n8n-specific guidance

## Secrets
**Migrated to OpenBao** (see CLAUDE.md Critical Quirk #2). Primary source: `secret/apps/tg-notify/<KEY>` in OpenBao (KV v2). Fallback: `~/docker/tg-notify/secrets.env` (mode 600) if Bao is unreachable/sealed.

Required env vars (all crash-required at startup):
- `TELEGRAM_BOT_TOKEN` — Telegram bot credential
- `TELEGRAM_CHAT_ID` — `{{TELEGRAM_CHAT_ID}}` (Loukas's chat)
- `API_SECRET` — bearer token callers must present

Optional:
- `PORT` — defaults to `8080`

## Authentik SSO
**None** — `deploy.conf` contains `auth=none`. Caddy does NOT add `import authentik` for this subdomain. Bearer token is the only auth.

## CI
`.github/workflows/deploy.yml` delegates entirely to the shared reusable workflow at `{{GITHUB_ORG}}/.github/.github/workflows/deploy.yml@main`. On push to `main`: build Docker image → deploy to server → update Caddy.

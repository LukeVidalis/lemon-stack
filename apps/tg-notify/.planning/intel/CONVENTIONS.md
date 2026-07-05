---
updated_at: 2026-05-18T00:00:00Z
generated_by: intel-updater
---

# Conventions

## Auth pattern
- `auth()` middleware in `index.js:22–27` validates `Authorization: Bearer <token>` against `API_SECRET` env var
- Bearer token comparison is direct (`token !== API_SECRET`) — not constant-time; acceptable for internal network
- `GET /health` is unauthenticated (no `auth` middleware applied)

## Naming
- Single flat file; no class or module naming conventions — all functions are lowercase camelCase
- Level values are literals: `"info"`, `"warn"`, `"error"`, `"success"` (defined in `LEVEL_PREFIX` at `index.js:20`)

## Error handling
- Startup: crashes immediately on missing required env vars (`process.exit(1)`, `index.js:14–18`)
- Request errors: plain JSON `{ error: "..." }` with appropriate HTTP status (400, 401, 502)
- Telegram API errors: caught, logged to stderr, returned as 502

## Logging
- Plain `console.error()` only — no structured logging, no correlation IDs
- Single log line on startup: `tg-notify listening on :PORT`
- Telegram errors logged to stderr before returning 502

## Message formatting
- HTML parse mode used with Telegram: `<b>title</b>` for bold titles (`index.js:48–50`)
- Emoji prefix per level: ℹ️ info, ⚠️ warn, 🚨 error, ✅ success

## Testing
- No test suite — service is too thin to warrant one
- Manual verification: `GET /health` and `POST /send` with curl (examples in `CLAUDE.md`)

## No database, no migration, no frontend.

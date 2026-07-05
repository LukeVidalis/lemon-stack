---
updated_at: 2026-05-24T00:00:00Z
generated_by: intel-updater
---

# Architecture

## Elevator pitch

`notify-service` is the centralized Web Push notification backend for lemon-server. Every PWA on `*.{{DOMAIN}}` subscribes here; every backend app and n8n workflow sends pushes via the internal network. All notifications are persisted so PWAs can render an in-app inbox even when the push was missed.

## Tech stack

- **.NET 10** / ASP.NET Core minimal APIs (`NotifyService.csproj`, `Directory.Build.props`)
- **EF Core + Npgsql** — Postgres 17 persistence (`AppDbContext.cs`)
- **WebPush** NuGet — VAPID-signed Web Push delivery (`PushSender.cs`)
- **OpenTelemetry** — traces (ASP.NET Core / HTTP / EF Core) + runtime metrics

## Services in this repo

Single container: `api` (ASP.NET Core on `:8080`). No DB sidecar — uses shared `postgres-shared` instance on `lemon-internal`.

## External dependencies

- **postgres-shared** — shared Postgres 17 instance on `lemon-internal`; DB provisioned with `~/docker/postgres-shared/provision-db.sh notify`; connection via `Host=postgres-shared` in `ConnectionStrings__Default`
- **Browser Push Services** (FCM, APNS, etc.) — WebPushClient calls external endpoints per subscription
- **lemon-internal Docker network** — exposes `api` as alias `notify` so peer apps call `http://notify:8080`
- No calls outbound to other ecosystem services (households, tg-notify, etc.)

## Data flow

1. PWA fetches `GET /vapid-public-key` (public, no auth) → gets VAPID public key
2. PWA calls `pushManager.subscribe()` in browser, POSTs subscription to `POST /subscribe` (SSO-auth)
3. Backend app / n8n POSTs to `POST /api/_internal/notify/` with `X-Internal-Secret`
4. `SendEndpoints` resolves target user's subscriptions from Postgres, persists a `Notification` row
5. `PushSender` fans out Web Push to all active subscriptions; dead ones (410/404) are pruned
6. PWA reads inbox via `GET /notifications` (SSO-auth), marks read via `POST /notifications/{id}/read`

## Auth model

Two modes: Authentik forward auth (`X-Authentik-Uid` → `NameIdentifier` claim) for user-facing routes; `X-Internal-Secret` constant-time compare (`InternalAuth`) for `_internal` routes. See [CONVENTIONS.md](CONVENTIONS.md).

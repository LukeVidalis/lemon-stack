---
updated_at: 2026-05-24T00:00:00Z
generated_by: intel-updater
---

# Gotchas

## VAPID keys are permanent — never regenerate without re-subscribing all users

Changing `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` invalidates every stored `PushSubscription` record. All browser push subscriptions become dead. Generate once via `dotnet run --project tools/GenVapid`, store in `~/docker/notify/.env`, never rotate.

## `.env` not `secrets.env` for this compose-based repo

This repo has `docker-compose.yml` at root → deploy pipeline uses `.env` (docker compose v2 auto-loads it), even though `api` is now the only service (DB moved to `postgres-shared`). See `deploy.conf` and `.env.example`.

## Build context is repo root, not `api/`

`docker-compose.yml` sets `context: .` with `dockerfile: api/Dockerfile`. This is required because `Directory.Build.props` and `Directory.Packages.props` live at root. If you add a new project, Dockerfile copies them from `/src/` at the WORKDIR level.

## CORS is intentionally `AllowAnyOrigin` when `Cors:AllowedOrigins` is empty

Unlike other {{GITHUB_ORG}} services (which block all origins when empty), notify-service falls through to `AllowAnyOrigin` — by design, since it is a shared multi-app backend. → `Program.cs:140–143`. Don't "fix" this to match the template behavior.

## `_internal` and `/health` are rate-limit exempt

`/api/_internal/*` and `/health*` bypass the fixed-window rate limiter (Program.cs:115–117). Internal push fan-out can generate legitimate bursts across all subscriber endpoints.

## Dead subscriptions pruned on 410/404 only — other errors are transient

`PushSender` removes subscriptions only on `HttpStatusCode.Gone` or `HttpStatusCode.NotFound`. Network errors and 5xx responses increment `failed` count but keep the subscription — assumed transient. → `Services/PushSender.cs:60–70`.

## `to` field resolves Uid first, then most-recent Username

`POST /api/_internal/notify/` resolves the target via `UserUid == req.To` first; if no match, falls back to `Username == req.To` ordered by `LastUsedAt DESC`. Send by Uid whenever possible; username fallback can hit the wrong user if they changed their Authentik username.

## Internal subscribe endpoint exists for cross-origin PWA enrollment

`POST /api/_internal/subscribe/` lets a backend (e.g. `friendly`) register a push subscription on behalf of a user whose SSO cookie belongs to a different origin. If `Uid` is null, it falls back to using `Username` as the stored `UserUid` — this can break the Uid-first lookup above. Always pass `Uid` when using this endpoint. → `Features/Internal/SubscribeEndpoints.cs:34`.

## `/api/_internal/user-summary` is a stub

`UserSummaryEndpoints.cs` returns a hardcoded `"TODO"` response. Dashboard will show an incomplete card until this is implemented. → `Features/Internal/UserSummaryEndpoints.cs`.

## No test project exists

There is no `tests/` directory in this repo (unlike dotnet-api-template). The only runtime validation is the CI smoke test against `/health`.

---
updated_at: 2026-05-18T02:00:00Z
generated_by: intel-updater
---

# Entry Points

| Task | Start at | Notes |
|------|----------|-------|
| Add a user-facing API endpoint | `api/Features/<Feature>/` → new `*Endpoints.cs`, call `Map*Endpoints()` from `Program.cs` | Follow `NotificationEndpoints.cs` pattern; use `.RequireAuthorization()` and extract uid from `ClaimTypes.NameIdentifier` |
| Add an internal (service-to-service) endpoint | `api/Features/Internal/` → add to existing or new file; wire in `Program.cs` | Add `.RequireInternalSecret()` on the group; exempt from rate limiting automatically |
| Add a DB entity / table | `api/Data/Entities.cs` → add class; `api/Data/AppDbContext.cs` → add `DbSet<T>`; then `dotnet ef migrations add <Name>` | Migrations run on startup; keep them idempotent; update `AppDbContextModelSnapshot.cs` |
| Change how users are authenticated | `api/Common/Auth/AuthentikAuthHandler.cs` | Maps `X-Authentik-*` headers to claims; claim names used in endpoints |
| Change internal secret validation | `api/Common/Internal/InternalAuth.cs` | Constant-time compare; env var is `INTERNAL_SUMMARY_SECRET` |
| Add a secret / env var | `docker-compose.yml` (add to `api.environment`) + `.env.example` + create in `~/docker/notify/.env` on server | See [DEPLOY.md](DEPLOY.md) for secrets table |
| Change Caddy routing (public paths, SSO bypass) | `Caddyfile.fragment` | `/vapid-public-key` and `/health` declared in `@public` matcher; add new public paths there |
| Implement `/api/_internal/user-summary` | `api/Features/Internal/UserSummaryEndpoints.cs` | Currently returns `"TODO"` stub; replace with real per-user query; contract defined in `/dashboard` skill |
| Change rate limiting thresholds | `appsettings.json` (`RateLimiting.PermitLimit`, `RateLimiting.WindowSeconds`) or env override | Internal and health paths are always exempt (hardcoded in `Program.cs:115–117`) |
| Regenerate VAPID keys | `dotnet run --project tools/GenVapid` | **Warning:** invalidates all existing subscriptions — all users must re-subscribe. See [GOTCHAS.md](GOTCHAS.md) |
| Send a push from another app | `POST http://notify:8080/api/_internal/notify/` with `X-Internal-Secret` header | App must be on `lemon-internal` Docker network; see README for full request schema |
| Register a push subscription from a cross-origin app | `POST http://notify:8080/api/_internal/subscribe/` with `X-Internal-Secret` | Pass `uid` field to avoid username-as-uid fallback bug; see `Features/Internal/SubscribeEndpoints.cs` |
| Trigger a redeploy without code changes | `git commit --allow-empty -m "redeploy" && git push` | Pipeline builds and restarts; never run `docker compose up` manually |
| Run the smoke test locally | `./scripts/smoke-test.sh notify.{{DOMAIN}} /health 120` | Requires the service to be live; CI runs this after every deploy |

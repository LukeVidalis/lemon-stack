---
updated_at: 2026-05-18T02:00:00Z
generated_by: intel-updater
---

# Conventions

## Naming

- Feature dirs under `api/Features/<FeatureName>/` with one `*Endpoints.cs` file per route group.
- Endpoints registered as `static` extension methods: `MapXxxEndpoints(this IEndpointRouteBuilder)`.
- Records (`record`) for request/response DTOs, co-located in the endpoints file that uses them.
- Entities in `api/Data/Entities.cs`; all in the `NotifyService.Data` namespace.

## Auth pattern

**User-facing routes** (`/subscribe`, `/unsubscribe`, `/notifications/*`):
- `.RequireAuthorization()` on the route group.
- `AuthentikAuthHandler` (`Common/Auth/AuthentikAuthHandler.cs`) reads `X-Authentik-Uid` → `ClaimTypes.NameIdentifier`, `X-Authentik-Username` → `ClaimTypes.Name`, `X-Authentik-Groups` (pipe-separated) → `ClaimTypes.Role`.
- Endpoints extract uid via `user.FindFirst(ClaimTypes.NameIdentifier)?.Value`.

**Internal routes** (`/api/_internal/*`):
- `.RequireInternalSecret()` endpoint filter (`Common/Internal/InternalAuth.cs`).
- Reads `X-Internal-Secret` header; compares against `INTERNAL_SUMMARY_SECRET` env var using constant-time compare (avoids timing oracle).
- Returns 503 when env var unset, 401 on mismatch.

**Public routes** (`/vapid-public-key`, `/health`):
- `.AllowAnonymous()` or no auth attribute. Listed explicitly in `Caddyfile.fragment` as `@public`.

## Error handling

- `ExceptionMiddleware` (`Common/Middleware/ExceptionMiddleware.cs`) — top-level catch → `Results.Problem()`.
- Per-endpoint validation uses inline `if` guards returning `Results.BadRequest(new { error = "..." })`.
- No global Result monad; minimal APIs return `IResult` directly.

## Logging

- Structured JSON console in production (`AddJsonConsole`), simple single-line in dev (`AddSimpleConsole`). → `Program.cs:36–56`
- `CorrelationMiddleware` injects `requestId` into every log scope and echoes it as `X-Request-Id` response header.
- Startup migration failure logs `MIGRATION_FAILED` at Critical then rethrows — Docker restarts and Loki captures it.

## Data access

- EF Core `AddDbContextPool<AppDbContext>` + `EnableRetryOnFailure(5, 10s)`. → `Program.cs:63–67`
- Transactions in retry context must use `db.Database.CreateExecutionStrategy()` (standard Npgsql requirement).
- Migrations run on startup (`MigrateAsync`) — no advisory lock (unlike dotnet-api-template default). Keep migrations idempotent.
- `NotificationAction` stored as `jsonb` column (`[Column(TypeName = "jsonb")]` in `Entities.cs:35`).

## Testing

No `tests/` project in this repo. Verified: only `api/` and `tools/GenVapid/` exist under the solution root. Smoke test via `scripts/smoke-test.sh` in CI polls `/health` after deploy.

## CORS

`Cors:AllowedOrigins` defaults to `[]` in `appsettings.json`. When empty in production, **intentionally falls through to `AllowAnyOrigin`** (multi-origin PWA backend design). Set explicit origins via env if lockdown is needed. → `Program.cs:132–144`

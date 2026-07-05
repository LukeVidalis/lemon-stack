---
updated_at: 2026-05-18T00:00:00Z
generated_by: intel-updater
---

# Conventions

## API style

- **Minimal APIs only** — no Controllers, no Swashbuckle. Route groups registered via extension methods (`MapAggregate`, `MapServices`) called in `api/Program.cs`.
- Each feature area owns its own `*Endpoints.cs` + supporting files under `api/Features/<Feature>/`.

## Auth pattern

- `AuthentikAuthHandler` (`api/Common/Auth/AuthentikAuthHandler.cs`) reads `X-Authentik-Username`, `X-Authentik-Email`, `X-Authentik-Uid`, `X-Authentik-Groups` (pipe-delimited) and builds a `ClaimsPrincipal`.
- Endpoints are guarded with `[Authorize]`; handler returns `NoResult` (not `Fail`) when headers are absent, so unauthenticated requests fall through to a 401.
- UID is the canonical user identity (`ClaimTypes.NameIdentifier` = `X-Authentik-Uid`); used as the query parameter to source apps.

## Internal secret

- Source fan-out authenticated by `X-Internal-Secret` header; value from `INTERNAL_SUMMARY_SECRET` env var (read at request time, not cached — so rotation takes effect without restart).
- Source apps guard `/api/_internal/user-summary` with this same secret. See CLAUDE.md § Operational notes.

## Registries (singletons)

- `DataSourceRegistry` and `ServicesRegistry` are `AddSingleton`; both read their config files once at startup.
- **To apply changes to `data-sources.json` or `services-config.json`, a redeploy is required.**

## Error handling

- No global exception filter. Exceptions in the fan-out (`FetchOne`) are caught per-source and returned as a `SourceResult` with `"status": "error"` — other cards still render.
- `Results.Problem(...)` used for the one structured error case (missing UID claim).

## Logging

- Single-line console logger (`AddSimpleConsole`); HH:mm:ss timestamp prefix; no scopes.
- Registries log how many sources/services were loaded at startup (good first thing to check in Loki).
- Fan-out logs `LogWarning` per slow/failed source; named logger `"Aggregate"`.

## Data access

- **No ORM, no DB.** State is owned entirely by source apps. Dashboard is pure pass-through.

## Testing

- **No test project.** The app is stateless and has no business logic that warrants unit tests. Integration-level correctness is verified by observing card states in the running dashboard.

## Frontend

- **State:** `useState`/`useEffect` only — no Redux, Zustand, etc.
- **API client:** all calls centralized in `web/src/api.ts`; same-origin fetch (no `VITE_API_BASE` needed); requests include `credentials: 'include'`.
- **Styling:** Tailwind CSS with custom color tokens (`border`, `muted`, `bad`, `warn`, `ok`) defined in `web/tailwind.config.js`.
- **Polling:** `App.tsx` calls `load()` on mount and then every 60 000 ms via `setInterval`.
- **No routing library** — single-page, single view.

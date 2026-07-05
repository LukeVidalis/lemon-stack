# dashboard

Master planner / god's-eye view of the lemon-server ecosystem.

## What it is

A .NET 9 + React 19 aggregator at `dashboard.{{DOMAIN}}`. SSO-protected
via Authentik (Caddy `import authentik`). Reads `X-Authentik-Uid` from the
incoming request, fans out to every enabled data source over the Docker host
network (`host.docker.internal:<port>/api/_internal/user-summary?uid=<uid>`)
with a shared `X-Internal-Secret` header, and renders one card per source.

User preferences (theme, card order, hidden slugs, refresh interval) are stored
server-side in SQLite (`/data/dashboard.db`, Docker volume `dashboard-data`).

## Architecture decisions

- **SQLite for prefs.** Single-admin usage; no separate Postgres DB needed. WAL
  mode, backed up daily via `~/backup.sh` + `nouchka/sqlite3 .backup`.
- **Static `data-sources.json` registry.** Explicit and reviewable. New sources
  register via PR.
- **Per-source timeout 1.5s.** Slow source ≠ broken dashboard.
- **SSE streaming.** `/api/aggregate/stream` emits per-source events for
  progressive rendering. `/api/aggregate` (non-streaming) stays as fallback +
  PWA cache seed.
- **20s fresh / 60s stale memory cache.** Cache survives source flaps.
- **`host.docker.internal:host-gateway` extra_hosts in compose.** Lets the API
  container reach `127.0.0.1:<port>` services on the host.
- **Direct localhost calls bypass Caddy/Authentik.** The shared
  `INTERNAL_SUMMARY_SECRET` is the only thing protecting these endpoints.
  Source apps live behind `127.0.0.1` bindings.

## Auth choices (recorded per /new-project convention)

- Multi-user: yes (data and prefs scoped per Authentik UID)
- SSO-aware login flow: yes (`/api/me` returns identity; UI shows username)
- Logout button: yes (links to `/outpost.goauthentik.io/sign_out`)

## Files

**API**
- `api/Features/Aggregate/AggregateEndpoints.cs` — `/api/me`, `/api/aggregate`, `/api/aggregate/stream`, `/api/aggregate/source/{slug}`
- `api/Features/Aggregate/DataSourceRegistry.cs` — loads + hot-reloads `data-sources.json`
- `api/data-sources.json` — registry; edit to add/remove/disable sources
- `api/Features/Services/ServicesEndpoints.cs` — `/api/services`
- `api/Features/Services/ServicesRegistry.cs` — merges `ports.json` + `services-config.json`
- `api/services-config.json` — static services + per-slug overrides
- `api/Features/Prefs/PrefsEndpoints.cs` — `GET/PUT /api/prefs`
- `api/Features/Prefs/PrefsStore.cs` — SQLite-backed prefs (Microsoft.Data.Sqlite)
- `api/Common/SourceClient/SourceClient.cs` — HTTP fan-out with retry, circuit breaker, timeout
- `api/Common/Auth/AuthentikAuthHandler.cs` — header → `ClaimsPrincipal`
- `api/Features/Health/HealthEndpoints.cs` — `/health/live`, `/health/ready`, `/health?deep=1`

**Web**
- `web/src/App.tsx` — app shell, routing, prefs context
- `web/src/components/SourceCard.tsx` — data card with per-card refresh + drag handle
- `web/src/components/ServiceGrid.tsx` — services link grid
- `web/src/hooks/usePrefs.ts` — prefs load/save with debounce + localStorage fallback
- `web/src/hooks/useAggregate.ts` — SSE consumer with stale-while-revalidate
- `web/src/components/Settings*.tsx` — theme toggle, card settings panel

## Services section

- **Dynamic discovery:** `~/deploy/ports.json` mounted read-only → auto-generates links.
- **Overrides:** `services-config.json` → `overrides` map (hidden, custom URL/name).
- **Static services:** `services-config.json` → `static` array.

## Operational notes

- Secret rotation: update `INTERNAL_SUMMARY_SECRET` in
  `~/docker/dashboard/.env` AND every source app's `~/docker/<repo>/.env`,
  then redeploy each.
- Adding a new data card app: see `README.md` § Adding a new data source.
- Debugging a source: `curl -H "X-Internal-Secret: $SECRET" http://127.0.0.1:<port>/api/_internal/user-summary?uid=<your-uid>`
- Wiping prefs DB: `docker run --rm -v dashboard-data:/data alpine rm /data/dashboard.db && docker compose restart api`

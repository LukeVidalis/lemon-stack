---
name: dashboard
description: "Use when working on the dashboard aggregator at dashboard.{{DOMAIN}} — registering a new app as a data source, implementing the /api/_internal/user-summary contract, rotating INTERNAL_SUMMARY_SECRET, or debugging cards showing DOWN / 'Failed to load data'."
allowed-tools:
  - Bash
  - Read
  - Edit
---

# Dashboard Skill

Dashboard at `dashboard.{{DOMAIN}}` aggregates per-user data from all lemon-server apps into a single card grid.

---

## Architecture

```
Browser → Caddy (import authentik) → Dashboard API (port 10011, host network)
                                          │ reads X-Authentik-Uid from header
                                          │ loads data-sources.json
                                          │ for each enabled source:
                                          │   GET 127.0.0.1:<port>/api/_internal/user-summary?uid=<uid>
                                          │   Header: X-Internal-Secret: $INTERNAL_SUMMARY_SECRET
                                          │ per-source timeout (default 1.5s), retry, circuit breaker
                                          │ 20s fresh cache / 60s stale cache
                                          │
                                          ├─── GET /api/aggregate → full batch response (cached)
                                          │
                                          └─── GET /api/aggregate/stream → SSE
                                                 one "source" event per resolved source
                                                 terminal "done" event
                                          ↓
                                     React 19 UI: one card per source
                                     + prefs/theme/drag-order persisted in SQLite
```

**Why host network mode?** Source apps bind on `127.0.0.1:<port>` (security model). The dashboard API container uses `network_mode: host` so it shares the host network namespace and can reach those ports directly. The web container stays bridged.

**Why not go through Caddy?** Would require forging Authentik headers (brittle) or OAuth clients per app. Direct `127.0.0.1` + shared secret is simpler and secure.

---

## Summary contract

Every participating app must expose:

```
GET /api/_internal/user-summary?uid=<authentik-uid>
Header: X-Internal-Secret: <shared secret>

200 → {
  "uid": "...",
  "title": "App Name",
  "primary": "One-line headline",
  "items": [{ "label": "...", "sub": "...", "tone": "ok|warn|bad|info" }],
  "metrics": [{ "label": "...", "value": 42, "tone": "ok|warn|bad|info" }],
  "deepLink": "https://<app>.{{DOMAIN}}/"
}
204 → user has no data (renders empty-state card)
401 → bad/missing secret (card shows DOWN)
503 → secret not configured (card shows DOWN)
```

- `items`: 0–5 small list items
- `metrics`: 0–3 number tiles
- `tone`: `ok` (green), `warn` (yellow), `bad` (red), `info` (muted)

---

## API endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/aggregate` | All sources, batch, cached (20s TTL + 60s stale). |
| GET | `/api/aggregate/stream` | SSE — one `source` event per source, then `done`. |
| GET | `/api/aggregate/source/{slug}` | Single source refresh, bypasses cache, updates cache. |
| GET | `/api/prefs` | Load prefs (theme, refresh interval, card overrides). |
| PUT | `/api/prefs` | Save prefs. |
| GET | `/api/services` | Discovered + static services list. |
| GET | `/api/buildinfo` | Git SHA + build timestamp. |
| GET | `/api/me` | Authentik identity from request headers. |
| GET | `/health/live` | Always `200` — liveness. |
| GET | `/health/ready` | `200` if SQLite + secret + registries OK — readiness. |
| GET | `/health?deep=1` | Full report with per-source reachability. |

---

## SQLite store

- **Path inside container:** `/data/dashboard.db`
- **Docker volume:** `dashboard-data` (named volume, declared in `docker-compose.yml`)
- **Schema:**
  - `prefs(uid TEXT, key TEXT, value TEXT, PRIMARY KEY (uid, key))` — theme, refresh interval, etc.
  - `card_overrides(uid TEXT, slug TEXT, hidden INT, sort_order INT, pinned INT, PRIMARY KEY (uid, slug))`
- **WAL mode** enabled on first use for concurrent reads.

### Backup

`~/backup.sh` (daily restic job) backs up the SQLite file as part of the DB dump phase:

```bash
# WAL-safe backup using nouchka/sqlite3
docker run --rm \
    -v dashboard-data:/data \
    nouchka/sqlite3 \
    sqlite3 /data/dashboard.db ".backup '/data/dashboard.bak.db'"
# then copy dashboard.bak.db out to DUMP_DIR and remove it
```

The resulting `dashboard.sqlite` is included in the restic snapshot alongside
Postgres dumps. Tolerant of missing volume (logs skip, doesn't fail the backup).

### Rotating / wiping prefs

```bash
# Wipe all prefs (resets to defaults on next load)
docker run --rm -v dashboard-data:/data alpine rm /data/dashboard.db
docker compose -f ~/docker/dashboard/docker-compose.yml restart api

# Export prefs before wipe (optional)
docker run --rm -v dashboard-data:/data alpine cat /data/dashboard.db > dashboard.db.bak
```

---

## Registry: data-sources.json

Lives in the dashboard repo at `api/data-sources.json`. Each entry:

```json
{
  "slug": "macros",
  "name": "Macros",
  "host": "127.0.0.1",
  "port": 10010,
  "path": "/api/_internal/user-summary",
  "icon": "utensils",
  "deepLink": "https://macros.{{DOMAIN}}/",
  "enabled": true
}
```

To disable a flaky source without redeploying it: set `"enabled": false` and push to dashboard repo. The registry hot-reloads on file change without a container restart.

---

## ⚠️ Gotcha: API port must be in ports.json

Because the api container uses `network_mode: host` (not a published port), the
deploy script doesn't auto-discover its port. The `Caddyfile.fragment` references
`{{API_PORT}}` which is substituted from `~/deploy/ports.json`.

**`~/deploy/ports.json` must contain both keys for dashboard:**
```json
"dashboard": { "api": 10011, "web": 10012 }
```

If `api` is missing, Caddy ends up with a literal `localhost:{{API_PORT}}`
and every `/api/*` request fails with "Failed to load data".

Verify after any redeploy: `grep -A5 'dashboard\.lemoncode' /etc/caddy/Caddyfile`
should show a numeric port, not `{{API_PORT}}`.

---

## Secret

The shared secret (`INTERNAL_SUMMARY_SECRET`) lives at:
- Dashboard: `~/docker/dashboard/.env`
- Each source app: `~/docker/<repo>/.env`

All must have the same value. Current secret is a 64-char hex string generated with `openssl rand -hex 32`.

### Rotation
1. Generate new secret: `openssl rand -hex 32`
2. Update `~/docker/dashboard/.env`
3. Update `~/docker/<repo>/.env` for every source app
4. Restart all containers: `docker compose -f ~/docker/<repo>/docker-compose.yml restart`

---

## Adding a new source app

1. Implement `GET /api/_internal/user-summary` in the app (see contract above).
   - For .NET apps: copy `Common/Internal/InternalAuth.cs` + `Features/Internal/UserSummaryEndpoints.cs` from macros.
   - Add `INTERNAL_SUMMARY_SECRET: ${INTERNAL_SUMMARY_SECRET}` to `docker-compose.yml` environment block.
2. Add `INTERNAL_SUMMARY_SECRET=<value>` to `~/docker/<repo>/.env` (same value as dashboard).
3. Add entry to `api/data-sources.json` in the dashboard repo and push.
4. Verify: `curl -H "X-Internal-Secret: $SECRET" "http://127.0.0.1:<port>/api/_internal/user-summary?uid=<your-uid>"`

---

## Verification commands

```bash
SECRET=$(grep INTERNAL_SUMMARY_SECRET ~/docker/dashboard/.env | cut -d= -f2)

# Test a source directly
curl -H "X-Internal-Secret: $SECRET" "http://127.0.0.1:10010/api/_internal/user-summary?uid=<your-uid>"

# Test bad secret → should return 401
curl -H "X-Internal-Secret: wrong" "http://127.0.0.1:10010/api/_internal/user-summary?uid=<your-uid>"

# Test dashboard aggregate (bypassing Caddy)
curl -H "X-Authentik-Uid: <your-uid>" -H "X-Authentik-Username: lemon" \
  "http://127.0.0.1:10011/api/aggregate"

# Test SSE stream
curl -N -H "X-Authentik-Uid: <your-uid>" -H "X-Authentik-Username: lemon" \
  "http://127.0.0.1:10011/api/aggregate/stream"

# Health checks
curl "http://127.0.0.1:10011/health/live"
curl "http://127.0.0.1:10011/health/ready"
curl "http://127.0.0.1:10011/health?deep=1"

# Build info
curl "http://127.0.0.1:10011/api/buildinfo"
```

Get your Authentik UID: `curl -s https://admin.{{DOMAIN}}/api/me | jq .uid`

---

## Current sources

> **Snapshot — the registry (`api/data-sources.json` in the dashboard repo) is the source of truth.**

| Slug | App | Port | Status |
|---|---|---|---|
| macros | Macros calorie tracker | 10010 | ✅ live |
| friendly | Friendly contact manager | 10002 | ✅ live |
| food-planner | Food Planner meal planner | 10004 | ✅ live |
| admin | Admin UI | 10006 | ✅ live |

---

## Repo

`{{GITHUB_ORG}}/dashboard` — deployed at `dashboard.{{DOMAIN}}`.
Local clone: `/tmp/dashboard/` (CI/CD runner checkout).

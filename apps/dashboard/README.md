# dashboard

God's-eye view of the lemon-server ecosystem. Aggregates per-user data from
every app via SSO.

- Live: https://dashboard.{{DOMAIN}}
- Stack: .NET 9 (api, port `${API_PORT}`) + React 19 + Vite 6 + Tailwind (web, port `${WEB_PORT}`)
- Auth: Authentik forward_auth via Caddy (`X-Authentik-*` headers)
- Storage: SQLite at `/data/dashboard.db` (Docker named volume `dashboard-data`) for user prefs and card ordering.

## Adding a new data source

1. The source app must expose `GET /api/_internal/user-summary?uid=<authentik-uid>`
   guarded by `X-Internal-Secret`. The dotnet-api-template ships a stub.
2. Add an entry to `api/data-sources.json`:
   ```json
   {
     "slug": "my-app",
     "name": "My App",
     "host": "host.docker.internal",
     "port": 10999,
     "path": "/api/_internal/user-summary",
     "icon": "star",
     "deepLink": "https://my-app.{{DOMAIN}}/",
     "enabled": true
   }
   ```
3. Make sure the source app's `~/docker/<repo>/secrets.env` contains the same
   `INTERNAL_SUMMARY_SECRET` value as `~/docker/dashboard/secrets.env`.
4. Redeploy the source app (push to main).
5. Push to this repo to redeploy the dashboard.

See `~/.claude/skills/dashboard/SKILL.md` on lemon-server for full details.

## Contract

Data sources return:

```json
{
  "uid": "...",
  "title": "Friendly",
  "primary": "3 friends overdue",
  "items": [
    { "label": "Mum", "sub": "last contact 42 days ago", "tone": "warn" }
  ],
  "metrics": [
    { "label": "Friends", "value": 27 },
    { "label": "Overdue", "value": 3, "tone": "warn" }
  ],
  "deepLink": "https://friendly.{{DOMAIN}}/"
}
```

Tones: `ok | warn | bad | info`.
Status `204` → empty card. Anything else → error badge, other cards still render.
Per-source timeout is 1.5s.

## API endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/aggregate` | Fetch all sources (cached, 20s TTL). |
| GET | `/api/aggregate/stream` | SSE stream — emits one `source` event per source as it resolves, then a `done` event. |
| GET | `/api/aggregate/source/{slug}` | Refresh a single source, bypasses cache. |
| GET | `/api/prefs` | Load user preferences (theme, card order, hidden slugs, refresh interval). |
| PUT | `/api/prefs` | Save user preferences. Body: same shape as GET response. |
| GET | `/api/services` | List all discovered + static services. |
| GET | `/api/buildinfo` | Git SHA + build timestamp injected at image build time. |
| GET | `/api/me` | Returns the Authentik identity from request headers. |
| GET | `/health/live` | Always `200 OK` — liveness probe. |
| GET | `/health/ready` | `200 OK` when SQLite + secret + registries are healthy. |
| GET | `/health?deep=1` | Full health report with per-source reachability. |

## SQLite store

User preferences and card overrides are stored in `/data/dashboard.db` inside
the `dashboard-data` Docker named volume.

Schema:
- `prefs(uid TEXT, key TEXT, value TEXT, PRIMARY KEY (uid, key))` — theme, refresh interval, etc.
- `card_overrides(uid TEXT, slug TEXT, hidden INT, sort_order INT, pinned INT, PRIMARY KEY (uid, slug))`

**Backup:** `~/backup.sh` backs up the SQLite file daily using a WAL-safe
`.backup` command via the `nouchka/sqlite3` image. The dump lands as
`dashboard.sqlite` in the restic snapshot alongside the Postgres dumps.

**Wipe prefs:**
```bash
docker run --rm -v dashboard-data:/data alpine rm /data/dashboard.db
docker compose -f ~/docker/dashboard/docker-compose.yml restart api
```

## PWA

The web client ships as a Progressive Web App:
- Install via the browser's "Add to home screen" / address bar install icon.
- App icons live at `web/public/icons/` (generated from `web/public/icon.svg`).
- A service worker pre-caches the app shell and serves the last aggregate response
  offline so the dashboard is usable on a flaky connection.

## Theme system

Theming uses CSS custom properties defined in `web/src/index.css`. The prefs
endpoint persists the active theme (`light | dark | auto`) server-side so it
follows the user across devices. Key variables:

```css
--color-bg         /* page background */
--color-surface    /* card background */
--color-text       /* primary text */
--color-accent     /* interactive elements */
--color-warn       /* warn tone */
--color-bad        /* bad/error tone */
```

Toggle via the sun/moon icon in the header or keyboard shortcut `t`.

---
updated_at: 2026-05-18T00:00:00Z
generated_by: intel-updater
---

# Gotchas

## api uses `network_mode: host` — no port isolation

The `api` container shares the host network stack. It must not bind a port already in use.
`API_PORT` must be set in `~/docker/dashboard/secrets.env`; if missing, .NET defaults to `:8080`
which will clash with any other service on 8080. Caddy's `{{API_PORT}}` substitution in
`Caddyfile.fragment` must match exactly what the api is listening on.

## `data-sources.json` uses `"host": "127.0.0.1"`, not `host.docker.internal`

Because the api runs on the host network, it reaches other services at `127.0.0.1:<port>` directly.
The CLAUDE.md and README show `host.docker.internal` as the template for new entries — that is only
valid for bridge-networked containers. Dashboard's api should always use `127.0.0.1`.

## Registry changes require a redeploy

`DataSourceRegistry` and `ServicesRegistry` are singletons loaded once at startup. Editing
`data-sources.json` or `services-config.json` has no effect until the api container restarts.
Always push to trigger a redeploy; don't just edit the file on the server.

## Secret rotation is multi-step and must be coordinated

`INTERNAL_SUMMARY_SECRET` must match across dashboard AND every source app. Update
`~/docker/dashboard/secrets.env`, then update each source app's `secrets.env`, then redeploy
each. Mismatch → source returns 401-equivalent → card shows error badge (dashboard fails open,
not down). See CLAUDE.md § Operational notes.

## Pipeline services appear automatically — hiding requires an explicit override

Any new service added to `~/deploy/ports.json` will appear in the services grid on next dashboard
load. To suppress a pipeline slug (e.g. staging apps), add `"slug": { "hidden": true }` to
`api/services-config.json → overrides` and push. `hello-world`, `login-portal`, and `dashboard`
itself are already hidden this way.

## No tests — correctness checked by running the dashboard

There is no test project. If you change fan-out logic or the `AuthentikAuthHandler`, verify by
observing card states in the live dashboard. The `SourceResult.status` field (`ok`/`empty`/
`timeout`/`error`) is the primary observable.

## CORS is `AllowAnyOrigin`

`Program.cs` registers an `AllowAnyOrigin` CORS policy. This is intentional — Authentik forward
auth at the Caddy layer is the actual security perimeter. Do not tighten CORS without understanding
that the API is not directly internet-accessible.

## SPA API base URL is always same-origin (no env var)

All `fetch` calls in `web/src/api.ts` use relative paths (`/api/...`). There is no `VITE_API_BASE`
or equivalent. Nginx proxies `/api/*` to the .NET API via Caddy → `API_PORT`. Do not add a base URL
var — it's unnecessary and would break the same-origin cookie/credential flow.

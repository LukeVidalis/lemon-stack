---
updated_at: 2026-05-17T12:00:00Z
generated_by: intel-updater
---

# Entry Points

| Task | Start at | Notes |
|------|----------|-------|
| Add an API route group | `api/src/index.js` + new file in `api/src/routes/` | Mount with `app.use('/api/<x>', router)`; one file per top-level path |
| Call a new Authentik endpoint | `api/src/authentik.js` | Add a function reusing the shared axios `client`; wrap errors with `apiError(...)` |
| Register a new ecosystem app for per-app permissions | `api/src/config/apps.json` | Add `{slug,name,baseUrl,icon}`; redeploy (registry loads at import) |
| Change Authentik provisioning (flows, outpost, providers) | `api/src/setup.js` | Runs on every boot; UUIDs are hard-coded constants at top of file |
| Add a frontend page | `web/src/pages/` + `web/src/App.jsx` | Add `<Route>` inside the shared `<Layout/>` |
| Add a reusable UI piece | `web/src/components/` | Plain React + Tailwind; no component library |
| Add a frontend API call | `web/src/api.js` | All calls go through `api.get/post/put/delete`; same-origin `/api/...` paths |
| Change auth header parsing | `api/src/routes/me.js` | Headers: `x-authentik-{username,name,email,groups,uid}` (groups pipe-delimited) |
| Add/change a secret | `docker-compose.yml` `environment:` + `~/docker/admin-ui/secrets.env` on server | Local `.env` for dev; deploy.sh injects from `secrets.env` in prod |
| Change Caddy routing | `Caddyfile.fragment` | Uses `{{API_PORT}}`/`{{WEB_PORT}}` placeholders templated by `deploy.sh` |
| Change ports | `~/deploy/ports.json` (server only) | Don't touch compose `ports:` — pipeline overrides them |
| Run the web app locally | `cd web && npm ci && npm run dev` | Vite dev server; needs a proxy or hitting prod API directly |
| Run the API locally | `cd api && npm ci && npm run dev` | `node --watch`; reads `.env` in repo root only if you `export` vars manually — Node does not auto-load |
| Build before push | `cd web && npm run build` | Required pre-push check (per global rule); API has no build |
| Trigger a redeploy without changes | `git commit --allow-empty -m "redeploy" && git push` | Never `docker build` on the server |
| View prod logs | Grafana → Loki: `{loki_project="admin-ui"}` | See `/logging` skill |
| Add to dashboard summary | `api/src/routes/internal.js` `/user-summary` | Returns `{ metrics: [{label,value,tone}] }`; gated by `INTERNAL_SUMMARY_SECRET` |

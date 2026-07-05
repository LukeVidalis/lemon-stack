# Change Checklist

Use this checklist for non-trivial edits in this repo.

1. Identify whether the change touches `api/`, `web/`, or deployment wiring.
2. If API behavior changes, confirm the affected `/api/...` route and any app-registry/config impact.
3. If UI behavior changes, confirm `web/src/api.js` and route/component usage still match backend behavior.
4. If deployment behavior changes, keep `docker-compose.yml`, `Caddyfile.fragment`, and workflow expectations consistent.
5. Build the web app with `cd web && npm run build` before finishing.

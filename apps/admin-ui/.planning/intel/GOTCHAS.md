---
updated_at: 2026-05-24T00:00:00Z
generated_by: intel-updater
---

# Gotchas

- **`.env` exists in the working tree with REAL secrets** (gitignored, so safe from `git push`, but visible on disk). `AUTHENTIK_API_TOKEN` and `ADMIN_API_SECRET` are plaintext. Do not echo this file in logs or paste in commits. Real prod secrets live in `~/docker/admin-ui/secrets.env` (server) — keep the two in sync if you rotate.
- **Compose declares `ports: "8080:8080"` / `"80:80"`** but those are ignored by the deploy pipeline — `deploy.sh` rewrites the published ports to `10006`/`10007` (host) when generating the runtime compose. The values in `docker-compose.yml` only matter for local-direct `docker compose up`.
- **External network name mismatch**: compose calls it `authentik` but the real Docker network is `authentik_default` (mapped via `name: authentik_default`). Don't rename without updating Authentik's compose.
- **No DB, no migrations**, but **`setup.js` is stateful** — `ensureProjectInfrastructure()` runs on every API boot and writes to Authentik (creates/updates providers, applications, outpost bindings). Restarts are not free; failures only log, they don't crash. Look for `[setup]` log lines in Loki.
- **Hard-coded Authentik PKs in `setup.js`**: `OUTPOST_PK`, `AUTH_FLOW_PK`, `INVALIDATION_FLOW_PK`. If Authentik is reinstalled/reset these UUIDs go stale — `setup.js` will then provision against the wrong flows. Update them in code, not config.
- **`admin-ui` excludes itself** from project lists in `routes/projects.js` (`EXCLUDED = ['login-portal', 'admin-ui']`) and uses a custom hostname mapping in `setup.js` `STATIC_APPS` (`admin` not `admin-ui`).
- **`apps.json` is empty in production** — only `_example: true` entry shipped. Adding a new app to the per-app permissions UI requires editing `api/src/config/apps.json` + redeploy (registry loads once at import; `reload()` exists but is not wired to any HTTP route).
- **No test suite**. `cd web && npm run build` is the only pre-push check. The API has no `npm test` — broken changes only surface on container start.
- **`@{{GITHUB_ORG}}/auth-react` requires GitHub Packages auth at build time**. `web/.npmrc` sets `@{{GITHUB_ORG}}:registry=npm.pkg.github.com` with `${GITHUB_PACKAGES_TOKEN}`. In prod deploy.sh passes `{{USER_HOME}}/.github-packages-token` as a BuildKit secret. For local `npm ci` in `web/`, you must export `GITHUB_PACKAGES_TOKEN` with a PAT that has `read:packages`. Without it `npm ci` will fail with a 401.
- **Frontend uses same-origin relative paths** (`fetch('/api/...')` via `web/src/api.js`). Works in prod because Caddy fronts both. For local dev you'd need a Vite proxy — none is configured.
- **`/api/_internal/user-summary` returns 503** (not 401) if `INTERNAL_SUMMARY_SECRET` is unset — that's intentional to distinguish "misconfigured" from "wrong secret".
- **CORS is wide open** (`app.use(cors())`) — the only thing keeping the API private is Caddy's `import authentik` block on `admin.{{DOMAIN}}`. Don't expose the API container port without auth in front.
- **`CLAUDE.md` is a pointer file** — actual shared instructions live in `.ai/context/` (also read by GitHub Copilot). Don't duplicate guidance into `CLAUDE.md`.

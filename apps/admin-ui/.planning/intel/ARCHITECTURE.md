---
updated_at: 2026-05-24T00:00:00Z
generated_by: intel-updater
---

# Architecture

Custom admin panel at `admin.{{DOMAIN}}` for managing Authentik users, groups, app access, and per-app permissions. Acts as a thin proxy + aggregator: fronts the Authentik REST API for identity/access, and fans out to ecosystem apps' own `/admin/permissions` HTTP contracts for per-app permission editing.

## Tech stack

- **API** (`api/`): Node.js `>=22`, Express `^4.21`, axios, cors. ESM (`"type": "module"`). No DB.
- **Web** (`web/`): React `^19`, react-router-dom `^7`, Vite `^6`, TailwindCSS `^3.4`, `@{{GITHUB_ORG}}/auth-react ^0.2.0` (useUser hook). No state library beyond plain hooks.
- **Containers**: `node:22-alpine` (API), `nginx:alpine` serving Vite `dist/` (web).

## Services in this repo

- `api` — Express on port 8080 (container), proxies Authentik + app admin APIs, exposes `/api/_internal/user-summary` for the dashboard aggregator.
- `web` — static SPA served by nginx on port 80 (container).

## External dependencies

- **Authentik** — primary backend, reached at `http://authentik-server:9000` (internal) via the `authentik_default` Docker network (joined as `authentik` external network in compose). API token required.
- **Resend** — outbound email for invite recovery links (`api/src/resend.js`).
- **Ecosystem app admin APIs** — apps registered in `api/src/config/apps.json` are called at their internal Docker hostnames with `X-Admin-Secret` header (`ADMIN_API_SECRET`).
- **`{{USER_HOME}}/deploy/ports.json`** — mounted read-only at `/data/ports.json` in the API container; used by `routes/projects.js` to enumerate deployed projects.

The API container is on `authentik_default` (named `authentik` here) plus the deploy-pipeline-injected `lemon-internal` network for ecosystem reachability.

## Data flow

- Browser hits `admin.{{DOMAIN}}` → Caddy (with `import authentik` SSO) injects `X-Authentik-*` headers.
- `/api/*` → API container (port 10006 on host). All other paths → web container (port 10007).
- API reads identity from `X-Authentik-*` headers (no token validation — Caddy is the gate).
- For Authentik operations API calls `http://authentik-server:9000/api/v3/...` with `AUTHENTIK_API_TOKEN`.
- For per-app permissions API calls `<app.baseUrl>/admin/{permissions,grants}` with `X-Admin-Secret`.
- On startup `ensureProjectInfrastructure()` in `api/src/setup.js` provisions/repairs Authentik providers, applications, and outpost bindings for each deployed project (idempotent).

## Auth model

Authentik forward-auth via Caddy domain block; app reads `X-Authentik-Username/Email/Groups/Uid` headers. See global CLAUDE.md `## Critical Quirks` #8. `/api/_internal/*` is gated separately by `INTERNAL_SUMMARY_SECRET` (constant-time compare in `routes/internal.js`).

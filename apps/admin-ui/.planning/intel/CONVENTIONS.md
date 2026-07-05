---
updated_at: 2026-05-24T00:00:00Z
generated_by: intel-updater
---

# Conventions

## Naming
- API files: lowercase, route file = mount path (`routes/users.js` → `/api/users`). All ESM (`import`/`export`).
- React: PascalCase components, one component per file. Pages under `web/src/pages/`, reusable bits under `web/src/components/`.

## Auth pattern
- **User identity**: read from `X-Authentik-Username/Email/Groups/Uid` request headers; no token validation in-app. Caddy is the gate. Example: `api/src/routes/me.js`.
- **Internal endpoint** (`/api/_internal/*`): shared-secret `X-Internal-Secret` header compared in constant time via `crypto.timingSafeEqual` (`api/src/routes/internal.js`). Env var: `INTERNAL_SUMMARY_SECRET`.
- **Outbound to ecosystem app admin APIs**: send `X-Admin-Secret: ${ADMIN_API_SECRET}` (e.g. `api/src/routes/permissions.js` → `headers()`).
- **Outbound to Authentik**: `Authorization: Bearer ${AUTHENTIK_API_TOKEN}` via shared axios client in `api/src/authentik.js`.

## Error handling
- Express centralised error middleware at the bottom of `api/src/index.js` returns `{ error, detail }`. No ProblemDetails.
- `authentik.js` wraps axios errors with `apiError(msg, err)` that copies `err.response?.status` onto `.status`. Routes call `next(err)` and let the middleware respond.
- Frontend `web/src/api.js` throws a custom `ApiError(message, status)` from a single `request()` helper; all callers go through `api.get/post/put/delete`.

## Logging
- One request-log middleware in `index.js`: `${ISO} ${method} ${url}` — plain `console.log`. No structured JSON, no correlation IDs. Promtail still ships stdout to Loki under `loki.project=admin-ui` (deploy.sh label injection).

## Data access
- **No DB.** State lives entirely in Authentik (via REST) plus ecosystem apps' own permission stores.
- `api/src/config/apps.json` is the only persistent file; edits require redeploy. App registry is loaded once at import (`app-registry.js`).
- `ports.json` is read on each request in `routes/projects.js` (no cache) — it's a mounted host file.

## Testing
- **None.** No tests, no test runner configured. Verification is manual via the SPA + curl.

## Frontend
- State: local `useState`/`useEffect` only — no Redux/Zustand/React Query.
- **User identity in UI**: `useUser()` from `@{{GITHUB_ORG}}/auth-react` (calls `/api/me` under the hood). Used in `web/src/components/Layout.jsx` to display logged-in user name/email and logout link (`/outpost.goauthentik.io/sign_out`).
- API client: `web/src/api.js` — base URL is empty (same-origin `/api/...` relative paths). Works in prod because Caddy fronts both services.
- Routing: `react-router-dom@7`, single `<Routes>` in `App.jsx` nested under shared `<Layout/>`.
- Styling: Tailwind utility classes; no shadcn/ui or component library.

## Build
- Web build runs in Dockerfile (2-stage). Per global rule, run `cd web && npm run build` locally before pushing.
- API has no build step; `node src/index.js` runs source directly.

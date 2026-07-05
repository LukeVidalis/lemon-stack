# Architecture

`admin-ui` is split into two deployable parts:

- `api/`: an Express service that fronts Authentik and app-specific admin APIs.
- `web/`: a Vite + React single-page app for the admin interface.

## API

- Entry point: `api/src/index.js`
- Core routes:
  - `/api/me`
  - `/api/users`
  - `/api/apps`
  - `/api/groups`
  - `/api/permissions`
  - `/api/projects`
- App integrations are registered in `api/src/config/apps.json` and loaded through `api/src/app-registry.js`.
- Startup runs `ensureProjectInfrastructure()` from `api/src/setup.js`, so API boot has side effects and may try to reach Authentik.

## Web

- Entry point: `web/src/main.jsx`
- Top-level routes are defined in `web/src/App.jsx`.
- HTTP calls are centralized in `web/src/api.js`.

## Deployment wiring

- `docker-compose.yml` runs the API on port `8080` and the web container on port `80`.
- `Caddyfile.fragment` routes `/api/*` to the API service and all other requests to the web service.
- The API expects Authentik-related environment variables and reads `{{USER_HOME}}/deploy/ports.json` as a mounted read-only file in Docker.

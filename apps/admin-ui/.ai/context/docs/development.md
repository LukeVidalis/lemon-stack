# Development

## Runtime expectations

- API targets Node.js `>=22` (`api/package.json`).
- Web uses Vite with npm (`web/package.json`).

## Common commands

### API

```bash
cd api
npm ci
npm run dev
```

### Web

```bash
cd web
npm ci
npm run dev
npm run build
```

## Configuration notes

- App registrations live in `api/src/config/apps.json`.
- Docker environment variables currently include:
  - `AUTHENTIK_URL`
  - `AUTHENTIK_EXTERNAL_URL`
  - `AUTHENTIK_API_TOKEN`
  - `ADMIN_API_SECRET`
- The web app talks to backend endpoints through relative `/api/...` paths.

## Change guidance

- Keep frontend routes, API routes, and reverse-proxy behavior aligned.
- If you add a new integrated app, update the registry and any related API/UI surfaces together.
- Prefer repo-local docs here over external or tool-specific instructions so both Claude and Copilot see the same context.

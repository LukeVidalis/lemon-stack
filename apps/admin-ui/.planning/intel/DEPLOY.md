---
updated_at: 2026-05-24T00:00:00Z
generated_by: intel-updater
---

# Deploy

## Subdomain
`admin.{{DOMAIN}}` — overridden in `deploy.conf` (`subdomain = admin`) instead of the default `admin-ui.{{DOMAIN}}`.

## Ports (host)
From `~/deploy/ports.json`:
- `api`: **10006** → container `:8080`
- `web`: **10007** → container `:80`

Containers bind to `127.0.0.1` only (global quirk #3).

## Containers / compose

`docker-compose.yml` defines two services:

- **api** — builds from `./api` (`node:22-alpine`, `npm ci --omit=dev`, `node src/index.js`). Mounts `{{USER_HOME}}/deploy/ports.json:/data/ports.json:ro`. Joins networks `default` and external `authentik` (real name `authentik_default`) so it can reach `authentik-server:9000`.
- **web** — builds from `./web` (multi-stage: Vite build → `nginx:alpine`). Uses BuildKit secret `github_packages_token` (from `{{USER_HOME}}/.github-packages-token` on host, declared in top-level `secrets:` in `docker-compose.yml`) to `npm ci` the `@{{GITHUB_ORG}}/auth-react` package from GitHub Packages. `web/.npmrc` maps the `@{{GITHUB_ORG}}` scope to `npm.pkg.github.com`.

The deploy pipeline generates a runtime compose in `~/docker/admin-ui/` from this file, allocates the per-service ports, injects `lemon-internal` network membership, and adds Loki labels (`loki.project=admin-ui`, `loki.environment=production`).

## Caddy routing

`Caddyfile.fragment` (custom, since multi-service):

```
handle /api/* { reverse_proxy localhost:{{API_PORT}} }
handle        { reverse_proxy localhost:{{WEB_PORT}} }
```

`{{API_PORT}}`/`{{WEB_PORT}}` are templated by `deploy.sh` from `ports.json`. The generated server block at `admin.{{DOMAIN}}` is wrapped with `import authentik` for SSO (global quirk #8).

## Secrets

Live in `~/docker/admin-ui/secrets.env` on the server (mode 600), injected by `deploy.sh` into the runtime compose `environment:` block. Required env vars (referenced in `docker-compose.yml`):

- `AUTHENTIK_URL` — defaulted to `http://authentik-server:9000` in compose
- `AUTHENTIK_EXTERNAL_URL` — defaulted to `https://auth.{{DOMAIN}}` in compose
- `AUTHENTIK_API_TOKEN` — Authentik admin API bearer
- `ADMIN_API_SECRET` — shared secret sent as `X-Admin-Secret` to ecosystem apps
- `INTERNAL_SUMMARY_SECRET` — gates `/api/_internal/user-summary` (dashboard contract)
- `RESEND_API_KEY` — outbound invite email

`PORTS_FILE` (default `/data/ports.json`) overrides the mounted ports file path if needed.

**Build-time only** — `github_packages_token` (from `{{USER_HOME}}/.github-packages-token`) is consumed by `web/Dockerfile` during `npm ci` and is not a runtime env var; deploy.sh already passes it.

## CI

`.github/workflows/deploy.yml` is a one-line caller:
```
uses: {{GITHUB_ORG}}/.github/.github/workflows/deploy.yml@main
```
on push to `main`. The shared workflow drives the self-hosted runner under `~/actions-runner/` → invokes `~/deploy/deploy.sh admin-ui`.

`copilot-setup-steps.yml` is a Copilot-coding-agent helper, not part of the deploy chain.

## Manual redeploy

`git commit --allow-empty -m "redeploy" && git push` (per global deployment rule — never run docker build manually).

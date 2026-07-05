---
updated_at: 2026-05-18T00:00:00Z
generated_by: intel-updater
---

# Deploy

## Live URL

`https://dashboard.{{DOMAIN}}` — SSO-protected via Caddy `import authentik`.

## Port allocation (`~/deploy/ports.json`)

```json
{ "web": 10012 }
```

`api` uses `network_mode: host` and is not port-mapped by the pipeline. Its listen port is
set by `ASPNETCORE_URLS` env var (defaults to `:8080` if `API_PORT` not set). `API_PORT` must
be configured in `~/docker/dashboard/secrets.env` to match the `{{API_PORT}}` placeholder in
`Caddyfile.fragment`. See [GOTCHAS.md](GOTCHAS.md) for the host-mode caveat.

## Container images

| Service | Build | Base |
|---------|-------|------|
| `api` | `api/Dockerfile` | `mcr.microsoft.com/dotnet/sdk:9.0` → `aspnet:9.0` |
| `web` | `web/Dockerfile` | `node:22-alpine` → `nginx:alpine` |

## Compose services

| Service | Network | Port |
|---------|---------|------|
| `api` | `network_mode: host` | host-direct; listens on `$API_PORT` (default 8080) |
| `web` | bridge | `127.0.0.1:10012:80` |

`~/deploy/ports.json` is mounted read-only into api at `/app/ports.json` for services discovery.

## Secrets (`~/docker/dashboard/secrets.env`)

| Var | Purpose |
|-----|---------|
| `INTERNAL_SUMMARY_SECRET` | Shared secret sent to source apps as `X-Internal-Secret` |
| `API_PORT` | Port the .NET API listens on (must match Caddyfile.fragment substitution) |
| `WEB_PORT` | Port nginx listens on (pipeline sets this to 10012) |

See CLAUDE.md § Critical Quirks — use `secrets.env` (not `.env`) to avoid docker-compose v1 `$` corruption.

## Caddy routing (`Caddyfile.fragment`)

```
handle /api/* { reverse_proxy localhost:{{API_PORT}} }
handle        { reverse_proxy localhost:{{WEB_PORT}} }
```

Pipeline substitutes `{{API_PORT}}` / `{{WEB_PORT}}` from `ports.json` / env at deploy time.

## CI

`.github/workflows/deploy.yml` — delegates entirely to `{{GITHUB_ORG}}/.github/.github/workflows/deploy.yml@main`
on push to `main`. Builds both images, pushes, and redeploys on lemon-server.

## Pre-push check

Run `npm run build` in `web/` before pushing (TypeScript compile + Vite build). .NET has no local
SDK available by default — `~/.dotnet/dotnet build` if SDK is on PATH. See CLAUDE.md §Pre-push rule.

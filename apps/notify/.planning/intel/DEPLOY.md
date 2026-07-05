---
updated_at: 2026-05-24T00:00:00Z
generated_by: intel-updater
---

# Deploy

## Subdomain

`notify.{{DOMAIN}}` — routing defined in `Caddyfile.fragment` (not default pattern).

## Port allocation (from `~/deploy/ports.json`)

| Service | Host port |
|---------|-----------|
| `api`   | `10016`   |

Caddy proxies inbound traffic to `localhost:10016`.

## Container image

Two-stage build (`api/Dockerfile`), build context is **repo root** (required for `Directory.Build.props` / `Directory.Packages.props`):

```
FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build    # restore + publish
FROM mcr.microsoft.com/dotnet/aspnet:10.0 AS runtime
ENTRYPOINT ["dotnet", "NotifyService.dll"]
ENV ASPNETCORE_URLS=http://+:8080
```

## Compose services (`docker-compose.yml`)

Single service — DB is the shared `postgres-shared` instance (not a sidecar):

| Service | Image | Networks |
|---------|-------|----------|
| `api` | built from repo | `default` + `lemon-internal` (alias: `notify`) |

`postgres-shared` on `lemon-internal` hosts the `notify` database. Provision with `~/docker/postgres-shared/provision-db.sh notify` (idempotent).

`lemon-internal` is external (pre-existing). Peer apps reach the service at `http://notify:8080`.

## Secrets (`~/docker/notify/.env` on server, mode 600)

Compose-based repo → uses `.env` (docker compose v2 auto-loads it). See CLAUDE.md Critical Quirks #7.

| Variable | Purpose |
|----------|---------|
| `DB_NAME` | Postgres database name (matches provisioned db on postgres-shared) |
| `DB_USER` | Postgres username |
| `DB_PASSWORD` | Postgres password |
| `INTERNAL_SUMMARY_SECRET` | Shared secret for `X-Internal-Secret`; same value used by callers |
| `VAPID_PUBLIC_KEY` | VAPID public key (generate once with `dotnet run --project tools/GenVapid`) |
| `VAPID_PRIVATE_KEY` | VAPID private key |
| `VAPID_SUBJECT` | VAPID contact URI (defaults to `mailto:admin@{{DOMAIN}}`) |
| `API_PORT` | Mapped host port (set by deploy pipeline to `10016`) |

## CI (`.github/workflows/deploy.yml`)

1. Push to `main` → shared `{{GITHUB_ORG}}/.github` deploy workflow (builds image, pushes, restarts on server).
2. Smoke test: `scripts/smoke-test.sh notify.{{DOMAIN}} /health 120` — polls for 120s.

## Caddy routing (`Caddyfile.fragment`)

- `GET /vapid-public-key` and `GET /health` → **public** (bypasses SSO).
- `/outpost.goauthentik.io/*` → Authentik outpost on `:9000`.
- All other paths → `forward_auth` to Authentik + proxy to `localhost:10016`.
- `deploy.conf`: `auth=none` — Caddyfile.fragment manages its own auth, skips the global `import authentik` wrapper.

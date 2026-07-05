# Authentik

Identity provider + forward-auth source for every SSO-protected subdomain.

## URLs (after install)

- `https://auth.{{DOMAIN}}` — login + admin UI
- `https://outpost.{{DOMAIN}}` — forward-auth endpoint (used by Caddy snippet)

## Default credentials

`setup.sh` reads `AUTHENTIK_BOOTSTRAP_PASSWORD` and `AUTHENTIK_BOOTSTRAP_TOKEN`
from your `parameters.env` (auto-generated random strings unless you override).
On first boot, Authentik creates the `admin` user with that password and the
bootstrap API token. Both are printed once at the end of `setup.sh` — save them
somewhere safe. After login, change the password and rotate the token under
**Directory → Tokens**.

## Blueprints

Files under `blueprints/` are mounted into `/blueprints/custom/` on the worker
and applied automatically on every startup. They are idempotent and version-pinned
to Authentik **2026.2.2**.

- `00-admin.yaml.template` — admin user + bootstrap API token
- `10-outpost-caddy.yaml.template` — proxy provider + application + outpost
  for the `(authentik)` Caddy snippet

To add custom flows/applications, drop more `.yaml` files into this directory
and restart the worker (`docker compose restart worker`).

## Database

Authentik connects to `postgres-shared` (DB `authentik`, owner role
`authentik_owner`). `setup.sh` provisions both via
`infra/postgres-shared/provision-db.sh`.

## Upgrade path

Blueprints are version-coupled. Before bumping the image tag in
`docker-compose.yml.template`:

1. Read the Authentik release notes for any blueprint schema changes.
2. Bump both `server` and `worker` to the same tag — they share state.
3. Authentik runs DB migrations on startup; the worker holds an advisory lock.
   `docker compose logs -f server worker` until both report `Booted`.

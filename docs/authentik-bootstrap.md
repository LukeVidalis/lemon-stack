# Authentik Bootstrap

Authentik is the SSO provider for every app behind Caddy's `forward_auth`. `setup.sh` brings it up automatically — this doc explains what's happening so you can debug or extend it.

## What setup.sh does

1. Renders `infra/authentik/docker-compose.yml.template` with your `{{DOMAIN}}` and DB credentials.
2. Brings up `authentik-server`, `authentik-worker`, `authentik-redis`, and provisions an `authentik` DB in `postgres-shared`.
3. Imports three blueprints from `infra/authentik/blueprints/`:
   - `00-admin.yaml` — creates the bootstrap admin user.
   - `10-outpost-caddy.yaml` — creates the proxy provider + outpost that Caddy talks to.
   - `20-default-flows.yaml` — default auth/authorize/invalidate flows.
4. Waits for `https://auth.{{DOMAIN}}/-/health/ready/` to return 200.

## Initial login

- URL: `https://auth.{{DOMAIN}}`
- Username: `{{ADMIN_USERNAME}}`
- Password: value of `AUTHENTIK_BOOTSTRAP_PASSWORD` from `setup/parameters.env`

**Rotate the password immediately** via Settings → User → Change password, then `lemon bao-set authentik/admin-password '<new>'`.

## Adding a new app to SSO

Apps deployed via the lemon-stack pipeline are added automatically by `deploy.sh`. To add an external service:

1. Authentik UI → Applications → Create
2. Provider: Proxy → Forward auth (single application) → External host `https://service.{{DOMAIN}}`
3. Bind to the `caddy` outpost (already created by blueprint `10`).
4. On the server: `lemon caddy-add service --forward-auth`.

## Blueprint convention

Blueprints in `infra/authentik/blueprints/` are version-controlled config-as-code. After editing one:

```bash
cd {{USER_HOME}}/docker/authentik
docker compose exec worker ak apply_blueprint /blueprints/<name>.yaml
```

Or restart the worker to re-apply all of them.

## Upgrading Authentik

Authentik blueprints are version-coupled — pin a specific image tag in `infra/authentik/docker-compose.yml.template`. To upgrade:

1. Read the [Authentik release notes](https://docs.goauthentik.io/docs/releases).
2. Bump the image tag.
3. Back up the `authentik` Postgres DB (`{{USER_HOME}}/backup.sh` does this).
4. `docker compose pull && docker compose up -d`.
5. Watch logs for migration completion.

## Common issues

| Symptom | Fix |
|---|---|
| Login loop on a new app | Restart `authentik-server` + `authentik-worker`, then Caddy. |
| Blueprint won't apply | Check worker logs: `docker compose logs worker --tail 200`. Likely a field-name mismatch with a new Authentik version. |
| Outpost shows "outdated" | Restart the outpost or pull a matching outpost image version. |

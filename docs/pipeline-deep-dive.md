# Deploy Pipeline — Deep Dive

End-to-end flow of what happens when you `git push` to an app repo connected to your lemon-stack server.

## High-level diagram

```
[ git push main ]
       │
       ▼
[ GitHub Actions: workflow_call → {{GITHUB_ORG}}/.github/workflows/deploy.yml ]
       │
       ├─► test job   (auto-detects npm/pytest/go/cargo/make)
       │
       ▼
[ deploy job (self-hosted runner on your lemon-stack server) ]
       │
       ├─► writes secrets.ENV_FILE → {{USER_HOME}}/docker/<repo>/.env (mode 600)
       │
       ▼
[ {{USER_HOME}}/deploy/deploy.sh <repo> <workspace> ]
       │
       ├─► reads deploy.conf (subdomain, port, health_check, env vars)
       ├─► bao-fetch.sh <repo>     → merges OpenBao secrets into .env
       ├─► docker build -t lemon-<repo>:<sha> .
       ├─► allocates port from {{USER_HOME}}/deploy/ports.json
       ├─► writes {{USER_HOME}}/docker/<repo>/docker-compose.yml
       ├─► docker compose up -d
       ├─► waits for health_check (default: TCP listen on container port)
       ├─► updates Caddy: lemon caddy-add <repo> --forward-auth
       └─► tags container :latest, prunes old image
       │
       ▼
[ scan job ]    Trivy → SARIF → GitHub Security
[ size-check ]  Warns if image grew >15%
[ lighthouse ]  Audits web apps directly (bypasses SSO)
```

## Key files

| File | Role |
|---|---|
| `{{USER_HOME}}/deploy/deploy.sh` | The 669-line orchestrator. Idempotent. |
| `{{USER_HOME}}/deploy/bao-fetch.sh` | Fetches secrets from OpenBao via AppRole. |
| `{{USER_HOME}}/deploy/ports.json` | Source of truth for port allocations (don't edit live — use `lemon port-alloc`). |
| `{{USER_HOME}}/docker/<repo>/` | Per-app working dir created by deploy. |
| `{{USER_HOME}}/docker/caddy/Caddyfile.d/<repo>.caddy` | Caddy snippet written by `lemon caddy-add`. |

## How a new subdomain becomes live

1. `deploy.sh` finalizes the container on its allocated port (say `:8042`).
2. Calls `lemon caddy-add <repo> --port 8042 --forward-auth`.
3. `lemon caddy-add` writes `{{USER_HOME}}/docker/caddy/Caddyfile.d/<repo>.caddy`:
   ```caddy
   <repo>.{{DOMAIN}} {
       import forward_auth_authentik
       reverse_proxy localhost:8042
   }
   ```
4. Reloads Caddy: `docker compose exec caddy caddy reload --config /etc/caddy/Caddyfile`.
5. Cloudflare Tunnel routes `<repo>.{{DOMAIN}}` to your server's Caddy port 443.

## Rollback

```bash
lemon rollback <repo>           # reverts to previous image tag
# or manually:
cd {{USER_HOME}}/docker/<repo>
docker compose down
docker tag lemon-<repo>:<previous-sha> lemon-<repo>:latest
docker compose up -d
```

## Adding a new step to the pipeline

Edit `deploy/github-reusable-workflow/.github/workflows/deploy.yml.template`, render with `setup/render-templates.sh`, push to your `.github` repo. All apps using the reusable workflow pick it up on next deploy.

## Performance

A typical Node app deploy on a 4-core homelab:

| Stage | Time |
|---|---|
| test | 30s–2min |
| build (warm cache) | 10–30s |
| deploy (incl. health check) | 5–15s |
| scan + size-check + lighthouse | 30–90s (parallel) |

## Limits & non-goals

- **Single-host**: deploy.sh is not multi-host. For multi-host, use Docker Swarm or k3s — out of scope for lemon-stack.
- **One image per repo**: multi-service repos work via `docker-compose.yml` in the repo (deploy.sh detects it).
- **No blue/green by default**: deploys are a quick `docker compose up -d` swap. For zero-downtime, add a second port in `deploy.conf` and a small Caddy snippet.

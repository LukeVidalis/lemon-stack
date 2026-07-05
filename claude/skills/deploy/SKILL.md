---
name: deploy
description: "Use when deploying or removing a project on lemon-server, when a deploy/workflow fails or hangs in queued, when managing ports.json or app secrets (OpenBao/secrets.env), or when a deployed app is unreachable after push"
allowed-tools:
  - Bash
  - Read
  - Write
  - Edit
  - Grep
  - Glob
---

<objective>
Manage the lemon-server auto-deploy pipeline. This skill covers:
- Deploying a project manually (bypass GitHub Actions)
- Checking deployment status
- Troubleshooting failed deploys
- Removing a deployed project
- Managing the port registry
</objective>

<context>
## Architecture

The auto-deploy pipeline works as follows:
1. User pushes to `main` on any repo in the `{{GITHUB_ORG}}` GitHub org
2. GitHub Actions runs the reusable workflow from `{{GITHUB_ORG}}/.github`
3. The self-hosted runner on lemon-server executes `~/deploy/deploy.sh`
4. deploy.sh builds a Docker image, assigns a port (10000-10999), starts the container, and auto-configures Caddy
5. The app is live at `https://<repo-name>.{{DOMAIN}}` via Cloudflare Tunnel

For multi-service projects (repos with `docker-compose.yml` instead of a single Dockerfile), deploy.sh detects the compose file, extracts routable services (those with `ports:`), allocates host ports for each service atomically, builds images via `docker compose build`, generates a runtime compose in `~/docker/<repo>/`, and configures Caddy with either a `Caddyfile.fragment` from the repo or a default `/api/*` + `/*` routing pattern.

## Key Files

| File | Purpose |
|---|---|
| `~/deploy/deploy.sh` | Main deploy script — builds, deploys, configures Caddy |
| `~/deploy/ports.json` | Port registry — maps project names to host ports (int for single-service, dict for multi-service) |
| `/etc/caddy/Caddyfile` | Reverse proxy config — deploy.sh manages entries automatically |
| `/etc/sudoers.d/deploy-caddy` | Allows lemon user to reload Caddy without password |

## GitHub Org

- **Org:** `{{GITHUB_ORG}}`
- **Template repo:** `{{GITHUB_ORG}}/template` — use "Use this template" on GitHub
- **Reusable workflow:** `{{GITHUB_ORG}}/.github/.github/workflows/deploy.yml`
- **Runner:** `lemon-server` — registered at org level, systemd service `actions.runner.{{GITHUB_ORG}}.lemon-server`

## Common Operations

```bash
# Check runner status
systemctl status actions.runner.{{GITHUB_ORG}}.lemon-server

# View port assignments
cat ~/deploy/ports.json

# View recent deploys for a project
gh run list --repo {{GITHUB_ORG}}/<project> --limit 5

# View deploy logs for a specific run
gh run view <run-id> --log --repo {{GITHUB_ORG}}/<project>

# Check a deployed container
docker ps --filter name=<project>
docker logs <project> --tail 50

# Manual deploy (bypass GitHub Actions)
~/deploy/deploy.sh <project-name> <path-to-source>

# Remove a deployed project
~/deploy/deploy.sh <project-name> unused --remove

# Test a deployed app locally
curl http://localhost:<port>

# Multi-service: check all containers for a project
docker ps --filter label=com.docker.compose.project=<project>

# Multi-service: view per-service logs
docker compose --project-name <project> logs <service> --tail 50

# Multi-service: view runtime compose
cat ~/docker/<project>/docker-compose.yml

# Multi-service: view port allocation
python3 -c "import json; d=json.load(open('$HOME/deploy/ports.json')); print(json.dumps(d.get('<project>'), indent=2))"
```

## Troubleshooting

**Workflow stuck in "queued":**
- Check runner is online: `gh api /orgs/{{GITHUB_ORG}}/actions/runners --jq '.runners[]'`
- If repo is public: verify runner group allows public repos: `gh api /orgs/{{GITHUB_ORG}}/actions/runner-groups --jq '.runner_groups[]'`
- Restart runner: `sudo systemctl restart actions.runner.{{GITHUB_ORG}}.lemon-server`

**Container starts but app unreachable:**
- Check container is bound to correct port: `docker ps --filter name=<project>`
- Check Caddy has the entry: `grep <project> /etc/caddy/Caddyfile`
- Check Caddy is running: `sudo systemctl status caddy`
- Test locally: `curl http://localhost:<port>`

**Cloudflare subdomain not resolving:**
- The `*.{{DOMAIN}}` wildcard is configured — no per-subdomain Cloudflare step. If it doesn't resolve, the problem is the Caddy block or DNS cache, not Cloudflare.
- For LAN clients, flush Unbound's negative cache: `sudo unbound-control flush_zone {{DOMAIN}} && docker exec pihole pihole reloaddns`

**Multi-service project not deploying:**
- Verify `docker-compose.yml` exists at repo root (NOT `Dockerfile`)
- Check services have `ports:` entries using env var convention: `127.0.0.1:${SVC_PORT:-default}:container_port`
- Runtime compose is at `~/docker/<project>/docker-compose.yml` — check image names match `<repo>-<service>:latest`
- If Caddy routing is wrong, check for `Caddyfile.fragment` in the repo root with `{{SVC_PORT}}` placeholders
- View allocated ports: `cat ~/deploy/ports.json | python3 -m json.tool`

## Authentication (SSO)

All deployed projects get Authentik SSO automatically via `import authentik` in their Caddy block. Users log in once at `auth.{{DOMAIN}}` and stay authenticated across every `*.{{DOMAIN}}` subdomain.

**Opt out** (project has its own auth, e.g. n8n): add to `deploy.conf`:
```
auth = none
```

Next deploy will omit `import authentik` from the Caddy entry. See `/auth` skill for full details on reading user identity headers (`X-Authentik-*`), user management, and bypass rules.

## Logging

Every container deployed via this pipeline has its logs automatically shipped to Loki and visible in Grafana.

- **No config required** — Promtail auto-discovers all Docker containers via Docker socket SD
- **Loki labels** — deploy.sh injects `loki.project=<repo>` and `loki.environment=production` labels into every generated compose file, so you can filter by project in Grafana
- **View logs:** `https://grafana.{{DOMAIN}}` → Explore → select Loki → filter by `{loki_project="<repo>"}`
- **CLI fallback:** `docker logs <container> --tail 50 -f`

## Security Notes

- All containers bind to `127.0.0.1` only — never expose ports to the network
- **Secrets: OpenBao first, file fallback** (plan 12). Source of truth is OpenBao at `secret/apps/<repo>/<KEY>`. deploy.sh's `load_secrets()` calls `~/deploy/bao-fetch.sh <repo>` first and falls back to `~/docker/<repo>/secrets.env` (mode 600, NOT `.env`) if Bao is sealed/unreachable. New apps:
  1. `~/docker/openbao/bao-bootstrap-approle.sh <repo>` — creates per-app policy + AppRole, writes `~/docker/<repo>/.bao-{role,secret}-id` (mode 600).
  2. `~/docker/openbao/bao-set.sh <repo> KEY value` (or `... KEY -` for stdin) for each secret. Or `bao-import-env.sh <repo>` to bulk-import an existing `secrets.env`.
  3. Deploy as normal — deploy.sh picks up Bao automatically. No code change in the app.

  Troubleshooting: `bao-fetch.sh` exit codes — `3` no creds, `4` Bao unreachable, `5` AppRole login failed, `6` no keys for app. On any non-zero, deploy.sh falls back to `secrets.env` and logs a warning. If Bao is sealed: `~/docker/openbao/unseal.sh`. Full ops doc: `openbao-secrets.md` in Obsidian Lemon-vault.
- The runner is scoped to `{{GITHUB_ORG}}` only
- deploy.sh only has sudoers for Caddy operations
- SSO is on by default for new projects (see above)
</context>

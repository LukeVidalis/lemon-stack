---
name: new-project
description: "Use when scaffolding a brand-new project/repo in {{GITHUB_ORG}} that should auto-deploy to <name>.{{DOMAIN}}. For existing code that just needs deploy wiring, use /ship instead."
allowed-tools:
  - Bash
  - Read
  - Write
  - Edit
  - Grep
  - Glob
---

<objective>
Scaffold a new project that auto-deploys to lemon-server on push to main.

The user provides: a project name (and optionally a tech stack / description).
This skill creates a working repo with Dockerfile, deploy workflow, and pushes it to the org.
First push triggers deployment — the app is live at `https://<name>.{{DOMAIN}}`.
</objective>

<process>
1. **Get project name** from user input (becomes repo name AND subdomain)
2. **Determine tech stack** — ask if not obvious (Node, Python, Go, .NET, static site, etc.)
   - **If .NET API**: use the GitHub template repo `{{GITHUB_ORG}}/dotnet-api-template` instead of scaffolding from scratch. Run `./setup.sh <ProjectName>` after cloning. Skip the Dockerfile Templates section below — the template already has everything wired.
   - **If React + Node API (TypeScript)**: use `{{GITHUB_ORG}}/react-app-template`. Hono server + Vite/React/TS/Tailwind v4 client in one image, Postgres + Kysely + node-pg-migrate, vitest + testcontainers, Authentik middleware, internal-auth, rate limit, correlation, health, ecosystem clients (notify/tg/households/email). Create with `gh repo create {{GITHUB_ORG}}/<name> --template {{GITHUB_ORG}}/react-app-template --private --clone`, then `cd <name> && ./setup.sh <name> --reset-git`. Skip the Dockerfile Templates section below — the template already has everything wired (including the dashboard `/api/_internal/user-summary` contract stub, so step 8 only needs the data-sources.json registration).
2b. **Ask about auth requirements** — always prompt the user with these three questions before scaffolding:
   - **Multi-user?** Will different users see/own different data, or is everyone treated identically?
     - If **yes**: the app should read `X-Authentik-Username` / `X-Authentik-Uid` headers to scope data per user. Use `X-Authentik-Uid` as the stable foreign key (UUID, never changes even if username does).
     - If **no**: no user identity needed in the app — SSO still protects access but the app is single-context.
   - **SSO-aware login flow?** Should the app show a login/loading screen that resolves the identity before rendering, or just trust the headers silently?
     - If **yes**: add a `/api/auth/me` endpoint that reads and returns Authentik headers, and a thin frontend auth context that calls it on load.
     - If **no**: just read headers directly in whatever endpoints need them.
   - **Logout button?** Should there be an in-app logout button?
     - If **yes**: add a button/link that POSTs to `/api/auth/logout` (or directly navigates to `/outpost.goauthentik.io/sign_out`). This clears the Authentik session across all `*.{{DOMAIN}}` apps.
     - Logout endpoint pattern (any backend):
       ```
       POST /api/auth/logout  →  redirect 302 to /outpost.goauthentik.io/sign_out
       ```
     - Or frontend-only (no backend needed):
       ```html
       <a href="/outpost.goauthentik.io/sign_out">Log out</a>
       ```
   **Document the answers in the scaffold** — record the choices in the project's `CLAUDE.md` so future agents know what was decided.
3. **Create the project locally** in `/tmp/<name>/`:
   - Scaffold appropriate Dockerfile for the stack
   - Add `.github/workflows/deploy.yml` (the 4-line caller):
     ```yaml
     name: Deploy
     on:
       push:
         branches: [main]
     jobs:
       deploy:
         uses: {{GITHUB_ORG}}/.github/.github/workflows/deploy.yml@main
     ```
   - Add `.gitignore` appropriate for the stack
   - Add minimal app code that responds on port 8080 (or specify in deploy.conf)
   - Add `deploy.conf` only if non-default port or subdomain needed
   - Add `CLAUDE.md` with deploy context (see template below)
4. **Create GitHub repo** in the org:
   ```bash
   cd /tmp/<name>
   git init && git add -A && git commit -m "Initial scaffold"
   gh repo create {{GITHUB_ORG}}/<name> --private --source=. --push
   ```
   **Must be `--private`.** The reusable workflow lives in `{{GITHUB_ORG}}/.github`, which is a private repo. GitHub only lets private consumers invoke a private reusable workflow — if the new repo is public, every push fails instantly with a 0-second `startup_failure` and no job logs (symptom: `gh run list` shows `completed failure` with `0s` duration and `gh run view` reports "This run likely failed because of a workflow file issue"). Fix is `gh repo edit {{GITHUB_ORG}}/<name> --visibility private --accept-visibility-change-consequences`, then push an empty commit to retrigger.
   If the user explicitly asks for a public repo, the `.github` repo would first need to be made public (or the reusable workflow forked into a public repo).
5. **Verify deployment** — watch the workflow run:
   ```bash
   gh run list --repo {{GITHUB_ORG}}/<name> --limit 1
   gh run watch <run-id> --repo {{GITHUB_ORG}}/<name>
   ```
6. **Confirm live** — test locally:
   ```bash
   # Get assigned port
   cat ~/deploy/ports.json | python3 -c "import json,sys; print(json.load(sys.stdin)['<name>'])"
   curl http://localhost:<port>
   ```
7. **Ask about backups** — does this project persist any data?
   - If **no persistent data** (stateless app): nothing to do, `~/docker/<name>/` is already covered by the daily backup.
   - If **yes** (has a database or important volumes):
     - Identify the DB type (SQLite, Postgres, MySQL) and container name
     - Add a dump block to `~/backup.sh` following the pattern for existing services
     - For Postgres: `docker exec <db-container> sh -c 'PGPASSWORD="$POSTGRES_PASSWORD" pg_dump -U <user> <dbname>'`
     - For SQLite in a volume: `docker run --rm --volumes-from <container> -v "$DUMP_DIR:/dump" alpine cp /path/to/db.sqlite /dump/<name>.sqlite`
     - For SQLite bind-mounted to `~/docker/<name>/`: already backed up via the file backup — no extra step needed
     - See `backups.md` in the Obsidian vault for the full backup setup and pattern reference
8. **Register with dashboard** — every new app should be dashboard-ready:
   - For .NET apps: the template already includes `Features/Internal/UserSummaryEndpoints.cs` with a stub. Fill it in with real data — see `/dashboard` skill for the contract.
   - For other stacks: implement `GET /api/_internal/user-summary?uid=<uid>` checking `X-Internal-Secret` header against `INTERNAL_SUMMARY_SECRET` env var (constant-time comparison). Return the summary contract JSON.
   - Add `INTERNAL_SUMMARY_SECRET=${INTERNAL_SUMMARY_SECRET}` to the service's `environment:` block in `docker-compose.yml`.
   - Copy `INTERNAL_SUMMARY_SECRET` value from `~/docker/dashboard/.env` into `~/docker/<name>/.env` (mode 600).
   - Add an entry to `api/data-sources.json` in the `{{GITHUB_ORG}}/dashboard` repo and push.
   - Verify: `curl -H "X-Internal-Secret: $SECRET" "http://127.0.0.1:<port>/api/_internal/user-summary?uid=<your-uid>"`
9. **Report to user:** container status, port, URL (`https://<name>.{{DOMAIN}}`), whether backups are configured, and whether dashboard integration is wired up

## Important Notes

- Single-service apps must listen on port 8080 inside the container (default). Override with `container_port` in `deploy.conf`. Multi-service apps define their own ports in `docker-compose.yml`.
- All containers bind `127.0.0.1` only on the host side.
- If the project needs secrets: OpenBao is the source of truth — on the server run `~/docker/openbao/bao-bootstrap-approle.sh <name>` then `~/docker/openbao/bao-set.sh <name> KEY value` per secret. `~/docker/<name>/secrets.env` (mode 600) is the fallback deploy.sh uses if Bao is sealed/unreachable. Compose-level env substitution still uses `~/docker/<name>/.env`. See `/deploy` skill.
- Cloudflare wildcard `*.{{DOMAIN}}` IS configured — new subdomains reach Caddy automatically; no Zero Trust dashboard step needed. The Caddy block (created by deploy.sh) is all that's required.
- If subdomain doesn't resolve for LAN clients, flush Unbound: `sudo unbound-control flush_zone {{DOMAIN}} && docker exec pihole pihole reloaddns`

## Dockerfile Templates

### Node.js
```dockerfile
FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
EXPOSE 8080
CMD ["node", "index.js"]
```

### Python (Flask/FastAPI)
```dockerfile
FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
EXPOSE 8080
CMD ["python", "app.py"]
```

### Go
```dockerfile
FROM golang:1.23-alpine AS build
WORKDIR /app
COPY go.* ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -o server .

FROM alpine:3.20
COPY --from=build /app/server /server
EXPOSE 8080
CMD ["/server"]
```

### Static Site (Nginx)
```dockerfile
FROM nginx:alpine
COPY . /usr/share/nginx/html
EXPOSE 8080
CMD ["nginx", "-g", "daemon off;", "-c", "/etc/nginx/nginx.conf"]
```

## CLAUDE.md Template (auto-include in every project)

Replace `<REPO_NAME>` with the actual repo name:

```markdown
## Deployment

Auto-deploys to lemon-server via `{{GITHUB_ORG}}` GitHub org.
Push to `main` → live at `https://<REPO_NAME>.{{DOMAIN}}` (~2 min).

### How it works
- GitHub Actions calls the org-wide reusable workflow
- Self-hosted runner on lemon-server builds the Docker image and deploys
- Caddy reverse proxy routes the subdomain automatically

### Requirements
- `Dockerfile` in repo root (app must listen on port 8080)
- Push to `main` branch triggers deploy

### Secrets
- Managed on lemon-server at `~/docker/<REPO_NAME>/secrets.env` (mode 600)
- Injected as environment variables at deploy time
- Never commit secrets to the repo

### Authentication (SSO)
- Authentik SSO is enabled automatically — users log in once at `auth.{{DOMAIN}}`
- Your app can read the authenticated user from `X-Authentik-Username` / `X-Authentik-Email` / `X-Authentik-Groups` / `X-Authentik-Uid` headers
- To opt out (project has its own auth), add `auth=none` to `deploy.conf`
- See `/auth` skill for details

### Auth choices made for this project
- **Multi-user:** <!-- yes (scoped by X-Authentik-Uid) / no (single shared context) -->
- **SSO-aware login flow:** <!-- yes (/api/auth/me + frontend auth context) / no (headers read inline) -->
- **Logout button:** <!-- yes (redirects to /outpost.goauthentik.io/sign_out) / no -->

### Logging
- Logs are automatically shipped to Loki — no config needed
- View at `https://grafana.{{DOMAIN}}` → Explore → filter `{loki_project="<REPO_NAME>"}`
- CLI: `docker logs <REPO_NAME> --tail 50`

### Useful commands (from lemon-server)
- `docker logs <REPO_NAME> --tail 50` — view logs
- `docker restart <REPO_NAME>` — restart container
- `~/deploy/deploy.sh <REPO_NAME> <path> --remove` — teardown
```

## Multi-Service Project

For projects with multiple services (e.g. API + frontend + database), use a `docker-compose.yml` instead of a Dockerfile at the repo root.

### Required structure
```
my-project/
├── docker-compose.yml          # Defines all services
├── api/
│   ├── Dockerfile
│   └── ...
├── web/
│   ├── Dockerfile
│   └── ...
├── Caddyfile.fragment          # Optional: custom Caddy routing
└── .github/workflows/deploy.yml # Same 4-line caller
```

### Compose conventions

- External services (reachable via Caddy) use env-var port bindings:
  ```yaml
  ports:
    - "127.0.0.1:${API_PORT:-8080}:8080"
  ```
- Internal services (db, redis) have **no** `ports:` entry — they stay Docker-internal
- deploy.sh auto-allocates host ports and injects them as `API_PORT`, `WEB_PORT`, etc.

### Caddyfile.fragment (optional)

Place in repo root for custom Caddy routing. Use `{{SVC_PORT}}` placeholders:
```caddy
	handle /api/* {
		reverse_proxy localhost:{{API_PORT}}
	}
	handle {
		reverse_proxy localhost:{{WEB_PORT}}
	}
```

Without a fragment, deploy.sh generates default routing: `/api/*` → api service, `/*` → web service.

### Secrets

Same as single-service: use `ENV_FILE` GitHub secret. The workflow writes it to `~/docker/<repo>/.env`, and docker compose reads it automatically for `${VAR}` substitution.
</process>

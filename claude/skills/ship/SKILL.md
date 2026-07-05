---
name: ship
description: "Use when the user has an EXISTING codebase and says 'ship it' / 'deploy this' / 'put this on the server' — adds Dockerfile, workflow, and repo, then pushes live. For scaffolding from scratch use /new-project instead."
allowed-tools:
  - Bash
  - Read
  - Write
  - Edit
  - Grep
  - Glob
---

<objective>
Take an existing project (current working directory) and make it deploy-ready for lemon-server.
Handles everything: Dockerfile, workflow, CLAUDE.md, GitHub repo creation, and push.
After push, the app is live at `https://<name>.{{DOMAIN}}` in ~2 minutes.

This is the "I have code, ship it" command. Zero manual steps.
</objective>

<process>
1. **Determine project name** — use the current directory name (or `deploy.conf` subdomain if present). Confirm with user if ambiguous.

2. **Detect the stack** — check for these files in order:
   - `package.json` → Node.js
   - `requirements.txt` / `pyproject.toml` / `Pipfile` → Python
   - `go.mod` → Go
   - `Cargo.toml` → Rust
   - `index.html` (no package.json) → Static site
   - `Dockerfile` already exists → use as-is, skip to step 4

3. **Add Dockerfile** if missing. Node.js, Python, Go, and Static Site templates live in the `/new-project` skill ("Dockerfile Templates" section — read `~/.claude/skills/new-project/SKILL.md` if not loaded); use those verbatim, adjusting CMD for the detected framework (scripts.start/main for Node; uvicorn/gunicorn for Python). Rust (not in new-project):

   ### Rust
   ```dockerfile
   FROM rust:1.79-alpine AS build
   WORKDIR /app
   COPY Cargo.* ./
   RUN mkdir src && echo "fn main(){}" > src/main.rs && cargo build --release && rm -rf src
   COPY . .
   RUN cargo build --release

   FROM alpine:3.20
   COPY --from=build /app/target/release/<binary> /app/server
   EXPOSE 8080
   CMD ["/app/server"]
   ```

4. **Add `.github/workflows/deploy.yml`** if missing:
   ```yaml
   name: Deploy
   on:
     push:
       branches: [main]
   jobs:
     deploy:
       uses: {{GITHUB_ORG}}/.github/.github/workflows/deploy.yml@main
   ```

5. **Add `CLAUDE.md`** if missing — with project-specific deploy context:
   ```markdown
   ## Deployment

   Auto-deploys to lemon-server via `{{GITHUB_ORG}}` GitHub org.
   Push to `main` → live at `https://<NAME>.{{DOMAIN}}` (~2 min).

   ### How it works
   - GitHub Actions calls the org-wide reusable workflow
   - Self-hosted runner on lemon-server builds the Docker image and deploys
   - Caddy reverse proxy routes the subdomain automatically

   ### Requirements
   - `Dockerfile` in repo root (app must listen on port 8080)
   - Push to `main` branch triggers deploy

   ### Secrets
   - Managed on lemon-server at `~/docker/<NAME>/secrets.env` (mode 600)
   - Injected as environment variables at deploy time
   - Never commit secrets to the repo
   ```

6. **Ensure `.gitignore`** exists and includes standard entries (node_modules, .env, __pycache__, etc.)

7. **Create GitHub repo** in the org (if not already there). **Must be `--private`** — the reusable workflow lives in the private `{{GITHUB_ORG}}/.github` repo, and public repos can't invoke a private reusable workflow (every push fails instantly with a 0-second `startup_failure` and no job logs). If a repo was accidentally created public: `gh repo edit {{GITHUB_ORG}}/<name> --visibility private --accept-visibility-change-consequences`, then push an empty commit.
   ```bash
   # Check if repo exists
   gh repo view {{GITHUB_ORG}}/<name> &>/dev/null
   if [ $? -ne 0 ]; then
     gh repo create {{GITHUB_ORG}}/<name> --private --source=. --push
   else
     # Repo exists — just set remote and push
     git remote get-url origin &>/dev/null || git remote add origin https://github.com/{{GITHUB_ORG}}/<name>.git
     git push -u origin main
   fi
   ```

8. **Initialize git if needed**, commit all files, push:
   ```bash
   git init  # if not a repo yet
   git add -A
   git commit -m "Ship: deploy-ready for lemon-server"
   git branch -M main
   # Then create/push per step 7
   ```

9. **Report:**
   - URL: `https://<name>.{{DOMAIN}}`
   - Deploy status: link to Actions run
   - "Live in ~2 minutes"

## Important Notes

- App MUST listen on port 8080 inside the container (default). Override with `container_port` in `deploy.conf`.
- If the app needs a different port, create `deploy.conf` with `container_port = <port>`.
- If the project needs secrets: OpenBao is the source of truth (`~/docker/openbao/bao-bootstrap-approle.sh <name>` then `bao-set.sh <name> KEY value` on the server); `~/docker/<name>/secrets.env` (mode 600) is the fallback deploy.sh uses when Bao is sealed/unreachable. See `/deploy` skill.
- This skill works from ANY machine with `gh` authenticated to {{GITHUB_ORG}}.
- Do NOT verify deployment locally (curl localhost) — that only works on the server itself.
</process>

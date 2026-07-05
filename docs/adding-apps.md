# Adding Your Own Apps

This guide walks you through adding a new app to your lemon-stack server so that pushing to `main` auto-deploys it behind Authentik SSO at `https://<your-app>.{{DOMAIN}}`.

## Prerequisites

- `setup.sh` has completed successfully.
- `lemon server-health` reports OK.
- The `.github` reusable workflow repo exists at `https://github.com/{{GITHUB_ORG}}/.github` (see `deploy/github-reusable-workflow/README.md`).
- Self-hosted runner is registered and online (check: `gh api /orgs/{{GITHUB_ORG}}/actions/runners`).

## Step 1 — Scaffold the repo

Easiest path: copy the scaffold.

```bash
cp -r ~/lemon-stack/deploy/template-repo ~/my-new-app
cd ~/my-new-app
git init && git add . && git commit -m "init"
gh repo create {{GITHUB_ORG}}/my-new-app --private --source=. --push
```

Render the workflow caller (replaces `{{GITHUB_ORG}}`):

```bash
mv .github/workflows/deploy.yml.template .github/workflows/deploy.yml
sed -i 's/{{GITHUB_ORG}}/{{GITHUB_ORG}}/' .github/workflows/deploy.yml
```

## Step 2 — Customize the Dockerfile

The default Dockerfile assumes Node 22. Edit it for your stack — the only hard requirement is **the container must listen on port 8080** (or whatever you set as `container_port` in `deploy.conf`).

## Step 3 — Optional: `deploy.conf`

```ini
subdomain = my-app          # default: repo name
container_port = 8080
health_check = /health      # deploy waits for HTTP 2xx here before swapping traffic
env = DATABASE_URL,REDIS_URL  # comma-separated names; values read from ENV_FILE secret
```

## Step 4 — Optional: secrets via `ENV_FILE`

In the repo's GitHub settings → Secrets → Actions, add `ENV_FILE` with the contents of your `.env`. The pipeline writes this to `{{USER_HOME}}/docker/<repo>/.env` mode 600 before bringing the container up.

For more sensitive secrets, prefer OpenBao (`lemon bao-set <key> <value>`); the deploy pipeline fetches them via `bao-fetch.sh` at runtime.

## Step 5 — Push

```bash
git push
```

Watch the run: `gh run watch`. On success:

- Caddy proxies `https://my-new-app.{{DOMAIN}}` → your container, gated by Authentik forward auth.
- `lemon caddy-routes` shows the new route.
- Trivy + Lighthouse reports appear in the Actions log.

## Troubleshooting

- **Health check times out:** ensure `health_check` returns 2xx without auth (most apps need an unauthenticated `/health`).
- **Image too large warning:** the pipeline doesn't fail the deploy, but consider multi-stage builds.
- **SSO loop:** Authentik outpost may need a restart — `cd {{USER_HOME}}/docker/authentik && docker compose restart server worker`.

See `docs/troubleshooting.md` for more.

# template-repo

Scaffold for a new lemon-stack app. Copy this directory (or use `gh repo create --template`) to bootstrap a project that auto-deploys to your lemon-stack server.

## Layout

| File | Purpose |
|---|---|
| `Dockerfile` | Build instructions — edit for your stack (Node, Python, Go, .NET, etc.) |
| `deploy.conf` | Optional overrides (subdomain, port, health check, env vars) |
| `.github/workflows/deploy.yml.template` | Auto-deploy on push to `main` via your org-wide reusable workflow |
| `.gitignore` | Common excludes |

## Usage

1. Copy the directory to a new repo:
   ```bash
   cp -r ~/lemon-stack/deploy/template-repo my-new-app
   cd my-new-app
   git init && git add . && git commit -m "init"
   gh repo create <your-org>/my-new-app --private --source=. --push
   ```
2. Render the workflow template (replaces `{{GITHUB_ORG}}`):
   ```bash
   cd ~/lemon-stack && ./setup/render-templates.sh
   ```
   Or for a one-off repo, just `sed -i "s/{{GITHUB_ORG}}/your-org/" .github/workflows/deploy.yml.template && mv .github/workflows/deploy.yml{.template,}`
3. Push — the runner picks it up, builds the image, and the deploy.sh on the host wires Caddy + SSO.

See `docs/adding-apps.md` for the full walkthrough.

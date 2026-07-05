# github-reusable-workflow

This directory mirrors the GitHub repo structure for your org's `.github` repository, which hosts a **reusable workflow** that all your lemon-stack apps call from their own `deploy.yml`.

## How it works

1. You create a repo named `.github` under your GitHub org (`https://github.com/{{GITHUB_ORG}}/.github`).
2. Copy the contents of this directory into that repo (after running `setup/render-templates.sh`).
3. Individual app repos use the 4-line caller in `deploy/template-repo/.github/workflows/deploy.yml.template`:
   ```yaml
   jobs:
     deploy:
       uses: {{GITHUB_ORG}}/.github/.github/workflows/deploy.yml@main
   ```
4. The reusable workflow runs on your self-hosted runner (registered by `setup.sh`), executing tests, building the image, calling `{{USER_HOME}}/deploy/deploy.sh`, then Trivy + size + Lighthouse checks.

## Pipeline steps

| Job | Purpose |
|---|---|
| `test` | Auto-detects npm/pytest/go/cargo/make and runs your tests |
| `deploy` | Writes `.env` from `secrets.ENV_FILE`, calls `deploy.sh <repo> <workspace>` |
| `scan` | Trivy CVE scan → uploads SARIF to GitHub Security tab |
| `size-check` | Warns if image grew >15% vs previous deploy |
| `lighthouse` | Runs Lighthouse against the container directly (bypasses SSO) |

## One-time setup per app

In the app repo's GitHub settings → Secrets → Actions:
- `ENV_FILE` (optional) — contents of your `.env` (multi-line secret). Deploy writes it to `{{USER_HOME}}/docker/<repo>/.env` mode 600 before bringing up the container.

See `docs/pipeline-deep-dive.md` for the full architecture.

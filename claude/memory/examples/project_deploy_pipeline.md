---
type: project
subject: deploy-pipeline
created_at: 2026-05-25T00:00:00Z
updated_at: 2026-05-25T00:00:00Z
---

# Auto-deploy pipeline shape

Pushes to the `{{GITHUB_ORG}}` GitHub org trigger the self-hosted runner at `~/actions-runner/`, which runs `~/deploy/deploy.sh` against the pushed repo.

Pipeline flow:
1. Runner clones the repo onto the host.
2. `deploy.sh` detects whether the repo has a root `docker-compose.yml` (multi-service) or just a `Dockerfile` (single image).
3. **Secrets**: `load_secrets()` calls `~/deploy/bao-fetch.sh <repo>` first (OpenBao at `bao.{{DOMAIN}}`), falls back to `~/docker/<repo>/secrets.env` (mode 600) if Bao is sealed/unreachable.
4. Port assignment from `~/deploy/ports.json` (per-service for compose repos, single for Dockerfile repos).
5. Image build, runtime compose generation under `~/docker/<repo>/`, `docker compose up -d`.
6. Caddy config block reload — routes `<repo>.{{DOMAIN}}` to the new container.
7. Authentik forward-auth applied automatically via Caddy `import authentik` unless the repo opts out.

**Never** run `docker build` or `docker compose up` manually to deploy. Push to `main` and let the pipeline own the live image.

To force a redeploy without code changes: `git commit --allow-empty -m "redeploy" && git push`.

---
updated_at: 2026-05-18T00:00:00Z
generated_by: intel-updater
---

# Layout

The entire service is a flat repo — no subdirectories beyond CI and git.

```
tg-notify/
  index.js                  # Entire service: Express setup, auth middleware, /send + /health endpoints
  package.json              # Deps (express only) + "start" script
  package-lock.json         # Lockfile (npm ci uses this in Docker build)
  Dockerfile                # node:22-alpine, single stage, npm ci --omit=dev
  deploy.conf               # auth=none (bypasses Authentik SSO in Caddy)
  CLAUDE.md                 # Project docs: API contract, secrets layout, usage examples
  .github/
    workflows/
      deploy.yml            # Reusable workflow call to {{GITHUB_ORG}}/.github deploy
```

No `src/`, no `lib/`, no test directory. Everything is in `index.js` (~65 lines).

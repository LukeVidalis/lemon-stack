# apps/ — reference implementations

These are templated mirrors of first-party apps from the reference server:
notification hub (`tg-notify`), Web Push (`notify`), per-user dashboard
(`dashboard`), Authentik admin panel (`admin-ui`), agent runtime
(`claude-runner`), and cross-session agent memory (`memory-index`).

> **Snapshot notice:** unlike `claude/skills/`, `deploy/`, `bin/`, and
> `infra/` — which are drift-checked against the live reference server —
> these mirrors are point-in-time snapshots (May 2026) and the upstream
> apps have evolved since. Treat them as working reference implementations
> of the stack's contracts (SSO headers, `/api/_internal/user-summary`,
> notification API, deploy conventions), not as the latest version of each
> app. Bringing them under drift-check is on the roadmap.

Each app deploys through the standard pipeline: push it to a repo in your
GitHub org and it goes live at `<repo>.your-domain.tld`.

---
name: lemon-stack
description: "Use BEFORE editing anything under ~/.claude/skills, ~/.claude/agents, ~/deploy, ~/bin, or ~/docker/<infra-svc> — and after such edits to promote portable changes to the public ~/lemon-stack mirror via promote.sh. Also use when drift-check or the leak guard fires."
allowed-tools:
  - Bash
  - Read
  - Edit
---

# lemon-stack — keep the public mirror in sync with this host

This host (`lemon-server`) and the public `~/lemon-stack/` repo are two trees
that must stay aligned. This skill encodes the workflow for editing anything
that lives in both.

## The two trees

| Tree | Path | Source of truth for |
|------|------|---------------------|
| **Live host** | `~/.claude/skills/`, `~/.claude/agents/`, `~/deploy/`, `~/bin/`, `~/docker/<svc>/` | Day-to-day operation. Edit + test here. |
| **lemon-stack repo** | `~/lemon-stack/claude/`, `~/lemon-stack/deploy/`, `~/lemon-stack/bin/`, `~/lemon-stack/infra/` | Anything portable to a fresh install. Ships publicly. |

## The flow: live-first, then promote

1. **Edit + test on the live host.** Fast iteration loop — no template rendering.
2. **Classify the change:**
   - **Portable** — applies to any lemon-stack install (most skill updates,
     deploy script fixes, infra compose tweaks, agent specs, helper scripts).
   - **Host-only** — applies only to this server (dashboard inventory, personal
     telemetry scripts, machine-specific migration patches, gsd-* personal
     agents, current container/port lists).
3. **If portable, promote immediately:**
   ```bash
   cd ~/lemon-stack
   ./scripts/promote.sh <live-path> [<live-path> ...]
   git diff --cached                    # review staged changes
   git commit -m "<msg>"
   git push origin main
   ```
4. **If host-only**, leave it on the host. Optionally add a `# host-only` comment
   so the next agent doesn't second-guess.

## Path mapping (what `promote.sh` knows)

| Live path | Repo target |
|-----------|-------------|
| `~/.claude/skills/<name>/...` | `claude/skills/<name>/...` |
| `~/.claude/agents/<name>.md` | `claude/agents/<name>.md` |
| `~/deploy/<file>` | `deploy/<file>.template` |
| `~/bin/<file>` | `bin/<file>.template` |
| `~/docker/<svc>/...` (only if `infra/<svc>/` already exists upstream) | `infra/<svc>/....template` |

Anything outside this mapping is skipped — pipeline-deployed apps under
`~/docker/<repo>/` are *outputs* of `deploy.sh`, not source, and must never
be promoted.

## Templating

`promote.sh` runs `scripts/template-skill.sh` on every promoted file, which
substitutes personal identifiers with `{{VAR}}` placeholders (domain, user
home, GitHub org/username, admin email, server IP, Telegram chat ID, Plane
IDs). After templating, `scripts/check-templates.sh` runs as a leak guard. If
any personal data slips through, `promote.sh` unstages and exits non-zero.

The actual personal values live in `scripts/identifiers.env` (gitignored,
this host only — never commit it); both the templatizer and the leak guard
derive their substitutions/patterns from it via `scripts/identifiers.lib.sh`.
CI gets the same values from the `LEAK_GUARD_IDENTIFIERS` repo secret.

If you introduce a new personal identifier that isn't covered: add an
`IDENT_*` var to `scripts/identifiers.env` AND `scripts/identifiers.example.env`,
wire it into `scripts/identifiers.lib.sh` (both `_ident_sed_args` and
`leak_patterns`), then refresh the GitHub secret:
`gh secret set LEAK_GUARD_IDENTIFIERS -R <owner>/lemon-stack < scripts/identifiers.env`.
`verify-template-coverage.sh` fails CI if a declared var isn't wired in.

## When the leak guard fires

If `promote.sh` exits with `LEAK DETECTED`:

1. Read the offending lines it printed.
2. If the identifier is *truly* generic (e.g. a public package version), tweak
   `template-skill.sh` to skip it — but think twice.
3. If it's personal, either templatize manually (replace with `{{VAR}}` in the
   target file) or decide the file is host-only after all and don't promote.
4. Re-run `promote.sh`.

## Drift safety net (already in place)

- **Post-deploy** — `deploy.sh` runs `drift-check/scripts/scan.sh --scope <repo>
  --notify-on-drift` for the repo that just deployed.
- **Weekly cron** — `~/lemon-stack/scripts/drift-check.sh` compares
  skills/infra/deploy across the two trees and tg-notifies on drift.

If drift-check fires for something you forgot to promote, just run
`promote.sh <live-path>` and push.

## Common operations cheat-sheet

```bash
# Edited a skill on the host:
cd ~/lemon-stack
./scripts/promote.sh ~/.claude/skills/deploy/SKILL.md

# Edited a helper script in ~/bin/:
./scripts/promote.sh ~/bin/generate-claude-md.sh

# Edited deploy pipeline:
./scripts/promote.sh ~/deploy/deploy.sh

# Edited infra compose:
./scripts/promote.sh ~/docker/n8n/docker-compose.yml

# Multiple at once:
./scripts/promote.sh ~/.claude/skills/deploy/SKILL.md ~/deploy/deploy.sh

# Preview without writing:
./scripts/promote.sh --dry-run <live-path>

# Just write, don't `git add`:
./scripts/promote.sh --no-stage <live-path>
```

## Anti-patterns

- ❌ Editing `lemon-stack/*.template` directly and trying to re-render down to
  the host. Slow, error-prone, and bypasses the leak guard's natural flow.
- ❌ Promoting `~/docker/<some-pipeline-app>/docker-compose.yml`. These are
  generated by `deploy.sh` and will get clobbered on next deploy.
- ❌ Pushing without running `git diff --cached`. The leak guard catches known
  patterns but can't catch a new secret you've never declared.
- ❌ Skipping `promote.sh` "just this once" — that's how drift starts.

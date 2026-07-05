---
name: drift-check-upstream
description: "Compare live host state vs lemon-stack's rendered templates; summarise differences and explain whether to sync"
allowed-tools:
  - Bash
  - Read
---

# drift-check-upstream skill

Wraps `scripts/drift-check.sh` in this repo. Runs three layers of comparison:

1. **Skills** — `claude/skills/*` vs `~/.claude/skills/*`
2. **Infra** — `infra/<c>/docker-compose.yml` vs `~/docker/<c>/docker-compose.yml`
3. **Deploy** — `deploy/{deploy,bao-fetch}.sh` vs `~/deploy/{deploy,bao-fetch}.sh`

## When invoked

Triggered by phrases like "check for drift", "what changed on the host", "am I
out of sync with upstream lemon-stack", or scheduled via cron.

## Steps

1. `cd ~/lemon-stack && ./scripts/drift-check.sh --verbose`
2. Read the output. For each reported drift:
   - **Skill drift**: usually means a skill was edited on the host. Diff with
     `diff ~/lemon-stack/claude/skills/<name>/SKILL.md ~/.claude/skills/<name>/SKILL.md`.
     Decide: does the change belong upstream? If yes, port the edit into
     `claude/skills/<name>/SKILL.md` (re-template any personal data) and commit.
     If no, re-install: `cd ~/lemon-stack && bash setup/install-skills.sh --force`.
   - **Infra drift**: usually means a `docker-compose.yml` was edited live (often
     during incident response). Diff and decide whether to port upstream or
     re-render (`./setup.sh --render-only` then copy the rendered file in).
   - **Deploy drift**: same as infra. Deploy script changes should almost always
     land upstream — the repo is the source of truth.
3. Report a 1-paragraph summary back to the user: how many drifts, in which
   layer, recommended action.

## Cron entry

Suggested weekly:

```cron
0 9 * * MON cd $HOME/lemon-stack && TELEGRAM_BOT_TOKEN=... TELEGRAM_CHAT_ID=... ./scripts/drift-check.sh --notify --verbose >> ~/drift-check.log 2>&1
```

## Output format

```
🌀 drift-check found N difference(s)
  • <layer>: <name>
  • ...
recommendation: <one sentence>
```

If no drift, simply: `✅ no drift — host matches upstream`.

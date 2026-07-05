# CLAUDE.md

This repository uses shared, repo-local agent context in `.ai/context/`.

## Start here

1. Read `.ai/context/README.md`.
2. Then read:
   - `.ai/context/docs/architecture.md`
   - `.ai/context/docs/development.md`
   - `.ai/context/skills/change-checklist.md`

## Important

- Treat `.ai/context/**` as the source of truth for shared instructions.
- Do not duplicate those instructions here unless a Claude-specific compatibility note is required.
- Because the shared context lives in the repository, Copilot and Claude can both read the same files after checkout.

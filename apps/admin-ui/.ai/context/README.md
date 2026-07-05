# Shared AI Context

This directory is the canonical, repo-local context for coding agents working in `admin-ui`.

## How to use this context

1. Start with `docs/architecture.md`.
2. Read `docs/development.md` before changing local tooling, environment assumptions, or deployment wiring.
3. Use `skills/change-checklist.md` as the repo-specific implementation checklist.

## Source of truth

- Keep shared instructions here instead of duplicating them across agent-specific files.
- `CLAUDE.md` is only a compatibility entrypoint that points back to this directory.
- If these files change, both Claude and Copilot can read the same repo content directly after checkout. No separate refresh step is required.

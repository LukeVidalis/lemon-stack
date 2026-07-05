---
type: feedback
subject: update-docs-after-changes
created_at: 2026-05-25T00:00:00Z
updated_at: 2026-05-25T00:00:00Z
---

# Update server docs after any change

After any change that affects how the server is operated — new service, new port, new compose, new secret pattern, new SSO wiring — update both:

1. **`~/.claude/CLAUDE.md`** (the agent's first-read context)
2. **The Obsidian vault** (if installed) — single source of truth for human-readable docs

Specifically:
- Update the Critical Quirks section if the change introduces a non-obvious gotcha
- Update the Skills Reference if a new skill ships
- Copy the relevant note into the vault via `sudo docker cp <file> obsidian:/config/obsidian/<VaultName>/`

The cost of stale docs compounds: every future session burns extra tool calls on rediscovery. Update at the time of change, not "later."

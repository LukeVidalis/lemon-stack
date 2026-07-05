# Agent memory system

Lightweight persistent context that survives across Claude Code sessions. Four conventional file types:

| Prefix | Purpose | Lifetime |
|---|---|---|
| `user_*.md` | Durable preferences of the human you work for | Forever, until the user contradicts |
| `feedback_*.md` | Operating habits you should follow on this server | Forever |
| `project_*.md` | Facts about a specific app/service on this server | Until the project changes shape |
| `reference_*.md` | Static lookup tables (state IDs, label IDs, well-known ports) | Forever |

## File format

```markdown
---
type: feedback
subject: deployment-discipline
created_at: 2026-05-25T10:00:00Z
updated_at: 2026-05-25T10:00:00Z
---

# Short title

Body (markdown, 1-30 lines). Be concise. Include a *why* if non-obvious.
```

Each file references should also have a one-line entry in `MEMORY.md` so the index stays browsable.

## When to write

Write a new memory after:

- The user states a general preference (not a one-off task instruction)
- You discover a non-obvious gotcha that cost you tool calls (and would cost the next agent the same)
- A new service is added and its access pattern is non-trivial
- You learn a stable lookup value (workflow state UUID, container label, port number)

## When NOT to write

- One-off task instructions ("for this PR…")
- Anything qualified with "for now" / "this session" / "temporarily"
- Secrets, credentials, tokens, API keys
- Personal information (health, finance, etc.) the user shares in passing

## When to read

Skim `MEMORY.md` at the start of any session that involves:

- The server / infra / deploys
- Conventions or coding style
- A specific service you've worked on before

Read individual memory files only if the index entry suggests relevance.

## Examples

Examples ship in `examples/` for reference — **delete or overwrite them** once you write real memories. Don't keep examples in the live memory dir long-term.

## Install location

`setup/install-memory.sh` copies this directory to `~/.claude/memory/` (or whatever path Claude Code's memory loader expects on your version). After install, agents read/write there, not here.

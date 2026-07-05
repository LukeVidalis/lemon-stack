# memory-index ({{PLANE_PROJECT_PREFIX}}-50)

SQLite + FTS5 cross-session memory store for the `server-maintainer` agent. Lets agents and humans recall prior incidents, decisions, and run outcomes via `lemon memory search "..."`.

## Files

| File | Lives at on the host |
|------|----------------------|
| `schema.sql`                                | `~/.claude/memory/schema.sql` |
| `ingest.py`                                 | `~/.claude/memory/ingest.py` |
| `systemd/lemon-memory-ingest.service.template` | `/etc/systemd/system/lemon-memory-ingest.service` (rendered) |
| `systemd/lemon-memory-ingest.path.template`    | `/etc/systemd/system/lemon-memory-ingest.path` (rendered) |

## Install

```bash
cd apps/memory-index
./install.sh
```

The script copies the backend, renders the two systemd units (substituting `{{USER_HOME}}`), enables the path-unit, and runs an initial `--no-llm` ingest so `lemon memory stats` shows non-zero counts immediately.

## Runtime

- DB at `~/.claude/memory/memory.db` (WAL, git-ignored).
- The path-unit watches `~/.claude/projects/-home-lemon/memory/` and `~/claude-runner/logs/trajectories/` and triggers the service on any change. The service `sleep 5`s first to coalesce write bursts.
- Trajectory ingest invokes `claude --model haiku` to render a 2–3 sentence searchable blurb per run; capped at 8 KB input. Incomplete runs (no `session_summary` line) skip Haiku and fall back to a deterministic blurb.

See `~/.claude/skills/memory/SKILL.md` and `Lemon-vault/memory-index.md` for query examples, troubleshooting, and the architecture diagram.

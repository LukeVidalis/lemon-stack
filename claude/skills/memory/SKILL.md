---
name: memory
description: "Query the SQLite FTS5 server-maintainer memory index (curated notes + run trajectories) so prior incidents and decisions are reliably recallable across sessions"
allowed-tools:
  - Bash
  - Read
---

# memory

Searchable cross-session memory for `lemon-server`. Backed by SQLite + FTS5 at `~/.claude/memory/memory.db`. Built for [{{PLANE_PROJECT_PREFIX}}-50](https://plane.{{DOMAIN}}) — see the Obsidian vault note `Server/memory-index.md` for the architecture diagram.

## When to use

- Before opening a Plane ticket for an apparent incident — check whether it's a recurrence (`lemon memory search "<container or error>"`).
- When the user asks "have we hit this before?" / "what happened last time X?".
- During the `server-maintainer` agent's run order (step 0) to ground investigations in prior context.
- To audit how a recurring problem was previously resolved (filter `--type trajectory`).

## What's indexed

| `source_type` | Origin | LLM blurb? |
|---|---|---|
| `memory_note`  | `~/.claude/projects/-home-lemon/memory/*.md` (curated notes) | No — first paragraph (or YAML `description:`) is the summary |
| `trajectory`   | `~/claude-runner/logs/trajectories/*.jsonl` (per-run JSONL) | Yes — Haiku renders a 2-3 sentence searchable blurb from the `session_summary` line + tool calls |

Deferred (schema leaves room — add later without migration): Plane comments, raw `~/.claude/sessions/*.jsonl`, vector/semantic embeddings.

## CLI

```bash
lemon memory search "<query>" [--limit 10] [--type memory_note|trajectory] [--since 2026-05-01]
lemon memory show <id>
lemon memory stats
lemon memory ingest [--since EPOCH] [--no-llm] [--path FILE]
lemon memory reindex      # rebuild FTS from documents
```

The query is FTS5 syntax — supports `AND` / `OR` / `NOT`, phrase matching with `"..."`, prefix with `term*`. Default ranking is BM25 weighted **title:5, summary:2, raw_text:1**.

`--text` (global flag) renders the compact human view; default is JSON for the agent.

## Ingest semantics

- Idempotent on `(source_type, source_path, mtime)` — re-running is cheap.
- A new trajectory file with no `session_summary` line (incomplete run) is indexed with a deterministic fallback blurb; Haiku is **not** called.
- Haiku prompt is capped at 8 KB of source text to keep latency + token cost bounded (~few calls/day on a healthy server).
- Failures during a single source never abort the whole pass — they bump `errors` in the report.

## Triggering

Auto-ingest via system-level path-unit `lemon-memory-ingest.path`:

```
PathModified={{USER_HOME}}/claude-runner/logs/trajectories
PathModified={{USER_HOME}}/.claude/projects/-home-lemon/memory
Unit=lemon-memory-ingest.service
```

The service has a 5 s `ExecStartPre=sleep 5` to coalesce bursts. Verify with:

```bash
systemctl status lemon-memory-ingest.path lemon-memory-ingest.service
journalctl -u lemon-memory-ingest.service --since "1 hour ago"
```

## Schema

```
documents(id, source_type, source_path, source_id, title, raw_text, summary,
          mtime, ingested_at, meta_json)
documents_fts USING fts5(title, summary, raw_text)  -- contentless, rowid = documents.id
```

Triggers keep FTS in sync on insert/update/delete. Source of truth is `documents`.

## Troubleshooting

| Problem | Fix |
|---|---|
| Stale titles / summaries after changing extraction logic | `touch <file>` to bump mtime then `lemon memory ingest`, or full rebuild via `rm ~/.claude/memory/memory.db && lemon memory ingest` |
| FTS out of sync with `documents` | `lemon memory reindex` |
| Haiku call hanging | `lemon memory ingest --no-llm` to backfill cheaply, then re-run without the flag |
| Path-unit not firing | `systemctl restart lemon-memory-ingest.path`; ensure both watched dirs exist |

## Operational invariants

- DB lives at `~/.claude/memory/memory.db` (WAL mode). Never committed.
- Schema in `~/.claude/memory/schema.sql`; ingest logic in `~/.claude/memory/ingest.py`.
- CLI lives in the `lemon` package (`~/lemon-cli/lemon_cli/commands/memory.py`) and is mirrored into `~/lemon-stack` via `./scripts/promote.sh`.
- Trajectories already pass through the secret denylist (`~/claude-runner/lib/trajectory-denylist.sh`) before being written to disk, so what we index is pre-redacted.

# claude-runner

Unified HTTP service that replaces the three single-purpose runners
previously at `~/scheduled-claude/`, `~/plane-claude/`, and
`~/plane-copilot/`.

One Python process, one systemd unit (`claude-runner.service`),
one log tree.

## Layout

```
~/claude-runner/
  runner.py              # HTTP server, route dispatch
  handlers/
    scheduled.sh         # ex scheduled-claude/handler.sh
    plane-claude.sh      # ex plane-claude/handler.sh
    plane-copilot.sh     # ex plane-copilot/handler.sh
  lib/
    trajectory-hook.py   # PostToolUse hook: one JSONL line per tool call
    trajectory-hook.sh   # thin wrapper invoked from ~/.claude/settings.json
    trajectory-init.sh   # sourced by handlers: writes session_start, traps session_end
    trajectory-summary.sh# helper to emit session_summary from handler (fallback)
    trajectory-denylist.sh# emits secret values to redact (consumed by hook)
  logs/
    scheduled/
    plane-claude/
    plane-copilot/
    trajectories/        # JSONL audit trail, one file per run
  README.md
```

## Trajectory logging

Each handler invocation writes a JSON-lines audit trail to
`~/claude-runner/logs/trajectories/<UTC-ts>-<handler>-<label>-<runid>.jsonl`
with four kinds of entries:

| kind | when | fields |
|---|---|---|
| `session_start` | handler start | handler, agent, label, work_dir, prompt (truncated), pid, run_id |
| `tool_call` | each Claude tool invocation (PostToolUse hook) | tool, input (redacted), output_preview |
| `session_summary` | agent emits, or handler synthesises | investigated[], changed[], outcome, plane_ticket, tg_summary |
| `session_end` | handler EXIT trap | exit_code, duration_s, total_tool_calls |

Per-tool capture requires a `PostToolUse` hook in `~/.claude/settings.json`
pointing at `lib/trajectory-hook.sh` — the lemon-stack `claude/settings.json`
template already wires this up. The hook is a silent no-op when `$TRAJECTORY_FILE`
is unset, so it only fires inside claude-runner sessions.

Secrets are redacted via `lib/trajectory-denylist.sh` (values pulled from
`~/docker/*/secrets.env`, `~/.restic-env`, etc.) plus regex for common patterns
(`Bearer ...`, `ghp_...`, `hvs.…`, `AKIA…`, `xox[baprs]-…`).

Quick queries:

```bash
# all incidents in the last 7 days
find ~/claude-runner/logs/trajectories -mtime -7 -name "*.jsonl" \
  -exec jq -c 'select(.kind=="session_summary" and .outcome=="incident")' {} +

# most common tool sequences
jq -r 'select(.kind=="tool_call") | .tool' \
  ~/claude-runner/logs/trajectories/*.jsonl | sort | uniq -c | sort -rn
```

Copilot handlers only get `session_start`/`session_summary`/`session_end`
frames (no per-tool entries — Copilot CLI has no equivalent hook system).

## API

### Unified endpoint (port 9879)

```
POST /run/{handler}
Headers: X-Runner-Secret: ...     (optional, only enforced if CLAUDE_RUNNER_SECRET is set)
Body:    application/json
```

The JSON body is mapped to the handler's environment:

| body key             | env var             | used by              |
|----------------------|---------------------|----------------------|
| `prompt`             | `CLAUDE_PROMPT`     | `scheduled`          |
| `work_dir`           | `CLAUDE_WORK_DIR`   | `scheduled`          |
| `label`              | `CLAUDE_LABEL`      | `scheduled`          |
| `issue_id`           | `ISSUE_ID`          | `plane-claude`, `plane-copilot` |
| `issue_title`        | `ISSUE_TITLE`       | `plane-*`            |
| `issue_description`  | `ISSUE_DESCRIPTION` | `plane-*`            |
| `issue_sequence_id`  | `ISSUE_SEQUENCE_ID` | `plane-*`            |

Plus `CLAUDE_EXTRA_JSON` (full raw JSON body) and `CLAUDE_HANDLER`.

Returns `202 {"status": "accepted", "handler": "..."}` and spawns the
handler as a detached subprocess.

### Legacy compatibility ports

For backwards compatibility with existing n8n workflows, the same
service also listens on:

| port | handler        | legacy secret header             | legacy secret env       |
|------|----------------|----------------------------------|-------------------------|
| 9876 | plane-claude   | `X-Plane-Claude-Secret`          | `PLANE_CLAUDE_SECRET`   |
| 9877 | plane-copilot  | `X-Plane-Copilot-Secret`         | `PLANE_COPILOT_SECRET`  |
| 9878 | scheduled      | `X-Scheduled-Claude-Secret`      | `SCHEDULED_CLAUDE_SECRET` |

Each accepts the original `POST /run-task` shape. **n8n workflows do
not need to change.**

### Health check

```
GET /health   -> 200 {"status": "ok"}
```

(Available on every port.)

## systemd

Single unit: `/etc/systemd/system/claude-runner.service`.

```bash
sudo systemctl status claude-runner
sudo journalctl -u claude-runner -f
tail -f ~/claude-runner/logs/**/*.log
```

The old units (`scheduled-claude`, `plane-claude`, `plane-copilot`) are
stopped and disabled. Their source dirs are archived at
`~/archived/<name>-pre-consolidation/`.

## Test

```bash
# health
curl -s http://127.0.0.1:9879/health

# scheduled (new API)
curl -s -X POST http://127.0.0.1:9879/run/scheduled \
  -H 'Content-Type: application/json' \
  -d '{"prompt":"echo hi","work_dir":"{{USER_HOME}}","label":"smoke"}'

# scheduled (legacy n8n endpoint)
curl -s -X POST http://127.0.0.1:9878/run-task \
  -H 'Content-Type: application/json' \
  -d '{"prompt":"echo hi","work_dir":"{{USER_HOME}}","label":"smoke"}'
```

#!/bin/bash
# Scheduled Claude Code handler
# Called by runner.py with env vars:
#   CLAUDE_PROMPT, CLAUDE_WORK_DIR, CLAUDE_LABEL

set -euo pipefail

CLAUDE="${CLAUDE_BIN:-{{USER_HOME}}/.local/bin/claude}"
LOG_DIR="{{USER_HOME}}/claude-runner/logs/scheduled"
mkdir -p "$LOG_DIR"

LABEL="${CLAUDE_LABEL:-scheduled}"
WORK_DIR="${CLAUDE_WORK_DIR:-{{USER_HOME}}}"
PROMPT="${CLAUDE_PROMPT:-}"
MODEL="${CLAUDE_MODEL:-haiku}"
AGENT_ARGS=()
if [[ -n "${CLAUDE_AGENT:-}" ]]; then
    AGENT_ARGS+=(--agent "$CLAUDE_AGENT")
fi

LOG_FILE="$LOG_DIR/${LABEL}-$(date -u +%Y%m%dT%H%M%S).log"
exec > >(tee -a "$LOG_FILE") 2>&1
echo "[$(date -u)] Starting scheduled Claude session: $LABEL"
echo "[$(date -u)] Working directory: $WORK_DIR"
echo "[$(date -u)] Model: $MODEL${CLAUDE_AGENT:+ | Agent: $CLAUDE_AGENT}"

# Trajectory logging (JSONL audit trail) — exports TRAJECTORY_FILE,
# enables the PostToolUse hook in ~/.claude/settings.json, registers
# session_start/session_end frames. See {{USER_HOME}}/claude-runner/lib/.
export CLAUDE_HANDLER="${CLAUDE_HANDLER:-scheduled}"
source {{USER_HOME}}/claude-runner/lib/trajectory-init.sh
source {{USER_HOME}}/claude-runner/lib/trajectory-summary.sh
echo "[$(date -u)] Trajectory: $TRAJECTORY_FILE"

cd "$WORK_DIR"

CLAUDE_OUTPUT=$("$CLAUDE" \
    --model "$MODEL" \
    "${AGENT_ARGS[@]}" \
    --dangerously-skip-permissions \
    --no-session-persistence \
    -p "$PROMPT" \
    2>&1) && EXIT_CODE=0 || EXIT_CODE=$?

echo "[$(date -u)] Claude exited with code: $EXIT_CODE"

# Trajectory: synthesize a session_summary if the agent didn't emit one.
if [ $EXIT_CODE -eq 0 ]; then
    _traj_emit_summary "done" "scheduled:${LABEL} ok" ""
else
    _traj_emit_summary "error" "scheduled:${LABEL} exit=${EXIT_CODE}" ""
fi

# Send result to Telegram via tg-notify
SUMMARY=$(echo "$CLAUDE_OUTPUT" | tail -c 1500)
if [ $EXIT_CODE -eq 0 ]; then
    MESSAGE="✅ *Scheduled Claude: ${LABEL}*

${SUMMARY}

_Log: ${LOG_FILE}_"
else
    MESSAGE="❌ *Scheduled Claude failed: ${LABEL}*

Exit code: ${EXIT_CODE}

$(echo "$CLAUDE_OUTPUT" | tail -c 500)

_Log: ${LOG_FILE}_"
fi

API_SECRET=$(grep '^API_SECRET=' {{USER_HOME}}/docker/tg-notify/secrets.env | cut -d= -f2)
curl -s -X POST http://127.0.0.1:10020/send \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $API_SECRET" \
    -d "{\"message\": $(echo "$MESSAGE" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))'), \"parse_mode\": \"Markdown\"}" \
    2>/dev/null || true

echo "[$(date -u)] Done."

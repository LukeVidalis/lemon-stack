#!/usr/bin/env bash
# Source me from a claude-runner handler to enable trajectory logging.
#
# Exports:
#   TRAJECTORY_FILE          — per-run JSONL file path
#   TRAJECTORY_RUN_ID        — short uuid identifying this run
#   TRAJECTORY_DENYLIST_FILE — cached secret denylist (auto-cleaned)
#
# Writes a `session_start` line immediately, and registers an EXIT trap
# that writes `session_end` with exit code, duration, and tool-call count.
#
# The hook (~/.claude/settings.json → PostToolUse → trajectory-hook.sh)
# only fires when TRAJECTORY_FILE is set, so sourcing this script is the
# single switch that turns trajectory logging on for a run.

# Don't `set -e` here — we never want trajectory plumbing to abort a handler.

TRAJECTORY_DIR="${TRAJECTORY_DIR:-{{USER_HOME}}/claude-runner/logs/trajectories}"
mkdir -p "$TRAJECTORY_DIR" 2>/dev/null || true

_traj_handler="${CLAUDE_HANDLER:-unknown}"
_traj_label="${CLAUDE_LABEL:-${ISSUE_SEQUENCE_ID:-${ISSUE_ID:-run}}}"
# Sanitize label for filenames
_traj_label_safe="$(printf '%s' "$_traj_label" | tr -c 'A-Za-z0-9._-' '-' | cut -c1-40)"
TRAJECTORY_RUN_ID="$(uuidgen 2>/dev/null | cut -c1-8 || printf '%s' "$RANDOM-$$")"
_traj_ts="$(date -u +%Y%m%dT%H%M%SZ)"

export TRAJECTORY_FILE="$TRAJECTORY_DIR/${_traj_ts}-${_traj_handler}-${_traj_label_safe}-${TRAJECTORY_RUN_ID}.jsonl"
export TRAJECTORY_RUN_ID
export TRAJECTORY_DENYLIST_FILE="/tmp/trajectory-denylist.${TRAJECTORY_RUN_ID}"

# Build the denylist once up front so the hook doesn't race on first tool call
{{USER_HOME}}/claude-runner/lib/trajectory-denylist.sh > "$TRAJECTORY_DENYLIST_FILE" 2>/dev/null || : > "$TRAJECTORY_DENYLIST_FILE"
chmod 600 "$TRAJECTORY_DENYLIST_FILE" 2>/dev/null || true

_traj_start_epoch="$(date +%s)"

# session_start
python3 - "$TRAJECTORY_FILE" "$TRAJECTORY_DENYLIST_FILE" <<'PY' 2>/dev/null || true
import json, os, sys, re, datetime

deny_path = sys.argv[2]
secrets = []
try:
    with open(deny_path) as f:
        for line in f:
            s = line.rstrip("\n")
            if len(s) >= 8:
                secrets.append(s)
except Exception:
    pass

REGEX = [
    (re.compile(r"Bearer\s+[A-Za-z0-9._\-]{20,}"), "Bearer «redacted»"),
    (re.compile(r"ghp_[A-Za-z0-9]{30,}"), "«redacted:ghp»"),
    (re.compile(r"github_pat_[A-Za-z0-9_]{40,}"), "«redacted:github_pat»"),
    (re.compile(r"hvs\.[A-Za-z0-9._\-]+"), "«redacted:hvs»"),
    (re.compile(r"AKIA[0-9A-Z]{16}"), "«redacted:aws»"),
    (re.compile(r"xox[baprs]-[A-Za-z0-9\-]{10,}"), "«redacted:slack»"),
]

def redact(s):
    if not isinstance(s, str):
        return s
    for secret in secrets:
        if secret and secret in s:
            s = s.replace(secret, "«redacted:secret»")
    for pat, repl in REGEX:
        s = pat.sub(repl, s)
    return s

entry = {
    "ts": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    "kind": "session_start",
    "run_id": os.environ.get("TRAJECTORY_RUN_ID"),
    "handler": os.environ.get("CLAUDE_HANDLER", "unknown"),
    "label": os.environ.get("CLAUDE_LABEL", ""),
    "work_dir": os.environ.get("CLAUDE_WORK_DIR", os.getcwd()),
    "issue_id": os.environ.get("ISSUE_ID", ""),
    "issue_sequence_id": os.environ.get("ISSUE_SEQUENCE_ID", ""),
    "issue_title": redact(os.environ.get("ISSUE_TITLE", ""))[:500],
    "prompt": redact(
        (os.environ.get("CLAUDE_PROMPT", "") or os.environ.get("ISSUE_DESCRIPTION", ""))
    )[:4096],
    "pid": os.getpid(),
}
with open(sys.argv[1], "a", encoding="utf-8") as f:
    f.write(json.dumps(entry, ensure_ascii=False) + "\n")
PY

_traj_finalize() {
    local exit_code=$?
    local end_epoch
    end_epoch="$(date +%s)"
    local duration=$(( end_epoch - _traj_start_epoch ))
    local tool_calls=0
    if [ -f "$TRAJECTORY_FILE" ]; then
        tool_calls="$(grep -c '"kind": "tool_call"' "$TRAJECTORY_FILE" 2>/dev/null || echo 0)"
    fi
    python3 - "$TRAJECTORY_FILE" "$exit_code" "$duration" "$tool_calls" <<'PY' 2>/dev/null || true
import json, sys, datetime
entry = {
    "ts": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    "kind": "session_end",
    "exit_code": int(sys.argv[2]),
    "duration_s": int(sys.argv[3]),
    "total_tool_calls": int(sys.argv[4]),
}
with open(sys.argv[1], "a", encoding="utf-8") as f:
    f.write(json.dumps(entry, ensure_ascii=False) + "\n")
PY
    rm -f "$TRAJECTORY_DENYLIST_FILE" 2>/dev/null || true
    return $exit_code
}
trap _traj_finalize EXIT

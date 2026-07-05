#!/usr/bin/env bash
# Helper for handlers: emit a synthesized `session_summary` JSONL entry.
# Idempotent — if the inner agent already wrote one, skip.
#
# Usage:
#   source {{USER_HOME}}/claude-runner/lib/trajectory-summary.sh
#   _traj_emit_summary "<outcome>" "<tg_summary>" "[plane_ticket_id]"
#
# outcome values (convention): clean | fixed | incident | error | done | failed

_traj_emit_summary() {
    local outcome="${1:-unknown}"
    local tg_summary="${2:-}"
    local plane_ticket="${3:-}"
    [ -z "${TRAJECTORY_FILE:-}" ] && return 0
    [ -f "$TRAJECTORY_FILE" ] || return 0
    if grep -q '"kind": "session_summary"' "$TRAJECTORY_FILE" 2>/dev/null; then
        return 0
    fi
    python3 - "$TRAJECTORY_FILE" "$outcome" "$tg_summary" "$plane_ticket" <<'PY' 2>/dev/null || true
import json, sys, datetime
entry = {
    "ts": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    "kind": "session_summary",
    "investigated": [],
    "changed": [],
    "outcome": sys.argv[2],
    "plane_ticket": (sys.argv[4] or None),
    "tg_summary": sys.argv[3][:1000],
    "synthesized_by": "handler",
}
with open(sys.argv[1], "a", encoding="utf-8") as f:
    f.write(json.dumps(entry, ensure_ascii=False) + "\n")
PY
}

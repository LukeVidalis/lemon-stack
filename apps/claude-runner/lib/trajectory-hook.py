#!/usr/bin/env python3
"""Claude Code PostToolUse hook → append one redacted JSONL line.

Reads hook context as JSON on stdin. No-op when $TRAJECTORY_FILE is unset.
Never raises — hook failures must not break the Claude session.
"""
import json
import os
import re
import sys
import datetime
import fcntl


def main() -> int:
    out_path = os.environ.get("TRAJECTORY_FILE")
    if not out_path:
        return 0

    try:
        raw = sys.stdin.read(1048576)
    except Exception:
        raw = ""
    if not raw.strip():
        return 0

    try:
        hook = json.loads(raw)
    except Exception:
        hook = {"_parse_error": True, "raw_preview": raw[:500]}

    deny_path = os.environ.get(
        "TRAJECTORY_DENYLIST_FILE", f"/tmp/trajectory-denylist.{os.getpid()}"
    )
    secrets: list[str] = []
    try:
        with open(deny_path) as f:
            for line in f:
                s = line.rstrip("\n")
                if len(s) >= 8:
                    secrets.append(s)
    except Exception:
        pass

    regex_redactions = [
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
        for pat, repl in regex_redactions:
            s = pat.sub(repl, s)
        return s

    def walk(obj):
        if isinstance(obj, dict):
            return {k: walk(v) for k, v in obj.items()}
        if isinstance(obj, list):
            return [walk(v) for v in obj]
        return redact(obj)

    def truncate(obj, cap=2048):
        try:
            s = obj if isinstance(obj, str) else json.dumps(obj, default=str)
        except Exception:
            s = str(obj)
        if len(s) <= 2 * cap:
            return s
        return s[:cap] + f"\n…«truncated {len(s) - 2 * cap} bytes»…\n" + s[-cap:]

    tool_name = hook.get("tool_name") or hook.get("tool") or "unknown"
    tool_input_raw = hook.get("tool_input") or hook.get("input") or {}
    tool_input = walk(tool_input_raw)
    tool_response = (
        hook.get("tool_response") or hook.get("response") or hook.get("output") or {}
    )

    extra = {}
    if isinstance(tool_response, dict):
        for k in ("exit_code", "returncode", "duration_ms", "duration", "is_error"):
            if k in tool_response:
                extra[k] = tool_response[k]

    entry = {
        "ts": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "kind": "tool_call",
        "tool": tool_name,
        "session_id": hook.get("session_id"),
        "input": (
            tool_input
            if len(json.dumps(tool_input, default=str)) < 4096
            else truncate(tool_input)
        ),
        "output_preview": redact(truncate(tool_response)),
    }
    entry.update(extra)

    line = json.dumps(entry, default=str, ensure_ascii=False) + "\n"

    try:
        with open(out_path, "a", encoding="utf-8") as f:
            try:
                fcntl.flock(f.fileno(), fcntl.LOCK_EX)
            except Exception:
                pass
            f.write(line)
    except Exception:
        pass
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception:
        sys.exit(0)

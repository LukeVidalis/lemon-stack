#!/usr/bin/env bash
# Claude Code PostToolUse hook wrapper. Delegates to trajectory-hook.py.
# Always exits 0 — a hook failure must never break the Claude session.
exec python3 {{USER_HOME}}/claude-runner/lib/trajectory-hook.py

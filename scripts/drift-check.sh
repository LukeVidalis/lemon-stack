#!/usr/bin/env bash
# drift-check.sh — compare live state on this host vs what lemon-stack's
# templates expect. Output: short summary + non-zero exit on drift.
#
# Five layers:
#  1. Skills:   claude/skills/*  vs  ~/.claude/skills/*
#  2. Agents:   claude/agents/*  vs  ~/.claude/agents/*
#  3. Bin:      bin/*.template   vs  ~/bin/<file>
#  4. Infra:    infra/<c>/docker-compose.yml.template  vs  ~/docker/<c>/docker-compose.yml
#  5. Deploy:   deploy/{deploy,bao-fetch}.sh.template  vs  ~/deploy/{deploy,bao-fetch}.sh
#
# Comparison is always: templatize(live) vs repo. Does NOT require
# setup/parameters.env — fully self-contained.
#
# Designed for cron — silent on no-drift (no output unless --verbose), tg-notify
# on drift if TELEGRAM_BOT_TOKEN+TELEGRAM_CHAT_ID exported and --notify flag set.

set -uo pipefail

cd "$(dirname "$0")/.."

VERBOSE=0; NOTIFY=0
for a in "$@"; do
  case "$a" in
    --verbose|-v) VERBOSE=1 ;;
    --notify)     NOTIFY=1 ;;
  esac
done

DRIFT=()
note() { DRIFT+=("$1"); }

# Normalises live files so they can be fairly compared against the repo,
# which stores {{VAR}} placeholders instead of personal values.
# Substitutions come from scripts/identifiers.env via identifiers.lib.sh.
source scripts/identifiers.lib.sh
_ident_require || exit 2
_templatize() { templatize_stream "$1"; }

# --- Skills ---
if [[ -d $HOME/.claude/skills ]]; then
  for d in claude/skills/*/; do
    name=$(basename "$d")
    live="$HOME/.claude/skills/$name/SKILL.md"
    repo="$d/SKILL.md"
    [[ -f $live ]] || continue  # skill in repo but not on this host — not drift
    if ! diff -q "$repo" <(_templatize "$live") >/dev/null 2>&1; then
      note "skill drift: $name"
    fi
  done
fi

# --- Agents ---
if [[ -d $HOME/.claude/agents ]]; then
  for f in claude/agents/*.md; do
    [[ -f $f ]] || continue
    name=$(basename "$f")
    live="$HOME/.claude/agents/$name"
    [[ -f $live ]] || continue
    if ! diff -q "$f" <(_templatize "$live") >/dev/null 2>&1; then
      note "agent drift: $name"
    fi
  done
fi

# --- Bin scripts ---
for f in bin/*.template; do
  [[ -f $f ]] || continue
  base=$(basename "${f%.template}")
  live="$HOME/bin/$base"
  [[ -f $live ]] || continue
  if ! diff -q "$f" <(_templatize "$live") >/dev/null 2>&1; then
    note "bin drift: $base"
  fi
done

# --- Infra compose files ---
for f in infra/*/docker-compose.yml.template; do
  [[ -f $f ]] || continue
  component=$(basename "$(dirname "$f")")
  live="$HOME/docker/$component/docker-compose.yml"
  [[ -f $live ]] || continue
  if ! diff -q "$f" <(_templatize "$live") >/dev/null 2>&1; then
    note "infra drift: $component/docker-compose.yml"
  fi
done

# --- Deploy scripts ---
for f in deploy/*.template; do
  [[ -f $f ]] || continue
  base=$(basename "${f%.template}")
  live="$HOME/deploy/$base"
  [[ -f $live ]] || continue
  if ! diff -q "$f" <(_templatize "$live") >/dev/null 2>&1; then
    note "deploy drift: $base"
  fi
done

if [[ ${#DRIFT[@]} -eq 0 ]]; then
  [[ $VERBOSE -eq 1 ]] && echo "drift-check: clean"
  exit 0
fi

echo "drift-check: ${#DRIFT[@]} difference(s):"
for d in "${DRIFT[@]}"; do echo "  - $d"; done

if [[ $NOTIFY -eq 1 && -n "${TELEGRAM_BOT_TOKEN:-}" && -n "${TELEGRAM_CHAT_ID:-}" ]]; then
  body="🌀 lemon-stack drift on $(hostname): ${#DRIFT[@]} differences. Run drift-check -v on the host for detail."
  curl -fsS -X POST \
    "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
    -d chat_id="${TELEGRAM_CHAT_ID}" -d text="$body" >/dev/null || true
fi

exit 1

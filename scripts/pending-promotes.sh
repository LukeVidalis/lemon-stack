#!/usr/bin/env bash
# pending-promotes.sh — show live host files that differ from their repo targets.
# Answers "what have I edited on the host but not yet promoted?"
#
# Usage:
#   ./scripts/pending-promotes.sh           # list diffs
#   ./scripts/pending-promotes.sh --verbose # show unified diff for each
#
# Exit codes:
#   0 — everything in sync
#   1 — one or more files need promoting

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

VERBOSE=0
[[ "${1:-}" == "--verbose" || "${1:-}" == "-v" ]] && VERBOSE=1

# Build mapping: repo-target -> live-path (inverse of promote.sh mapping)
declare -a PAIRS  # "repo_target|live_path"

# Skills: claude/skills/*/SKILL.md -> ~/.claude/skills/*/SKILL.md
for f in claude/skills/*/SKILL.md; do
  [[ -f $f ]] || continue
  name=$(echo "$f" | sed 's|claude/skills/\([^/]*\)/.*|\1|')
  PAIRS+=("$f|$HOME/.claude/skills/$name/SKILL.md")
done

# Agents: claude/agents/*.md -> ~/.claude/agents/*.md
for f in claude/agents/*.md; do
  [[ -f $f ]] || continue
  base=$(basename "$f")
  PAIRS+=("$f|$HOME/.claude/agents/$base")
done

# Deploy scripts: deploy/*.template -> ~/deploy/<file>
for f in deploy/*.template; do
  [[ -f $f ]] || continue
  base=$(basename "${f%.template}")
  PAIRS+=("$f|$HOME/deploy/$base")
done

# Bin scripts: bin/*.template -> ~/bin/<file>
for f in bin/*.template; do
  [[ -f $f ]] || continue
  base=$(basename "${f%.template}")
  PAIRS+=("$f|$HOME/bin/$base")
done

# Infra compose: infra/<svc>/docker-compose.yml.template -> ~/docker/<svc>/docker-compose.yml
for f in infra/*/docker-compose.yml.template; do
  [[ -f $f ]] || continue
  svc=$(echo "$f" | sed 's|infra/\([^/]*\)/.*|\1|')
  PAIRS+=("$f|$HOME/docker/$svc/docker-compose.yml")
done

pending=0

# Normalise live files so they can be fairly compared against the repo,
# which stores {{VAR}} placeholders instead of personal values.
# Substitutions come from scripts/identifiers.env via identifiers.lib.sh.
source scripts/identifiers.lib.sh
_ident_require || exit 2
_templatize() { templatize_stream "$1"; }

for pair in "${PAIRS[@]}"; do
  IFS='|' read -r repo live <<<"$pair"
  [[ -f $live ]] || continue   # live file not present on this host — skip

  # Templatize the live file (replace actual values with {{VAR}}) and compare
  # against the repo file (which already stores {{VAR}} placeholders).
  if ! diff -q \
    "$repo" \
    <(_templatize "$live") \
    >/dev/null 2>&1; then
    echo "PENDING: $live → $repo"
    if [[ $VERBOSE -eq 1 ]]; then
      diff -u \
        "$repo" \
        <(_templatize "$live") || true
      echo
    fi
    pending=$((pending + 1))
  fi
done

if [[ $pending -eq 0 ]]; then
  echo "pending-promotes: all tracked files are in sync."
  exit 0
fi

echo
echo "pending-promotes: $pending file(s) need promoting."
echo "Run: cd ~/lemon-stack && ./scripts/promote.sh <live-path>"
exit 1

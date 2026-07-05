#!/usr/bin/env bash
# check-structural-sections.sh — verify that structural CLAUDE.md sections
# are present in both the lemon-stack template and the user's personal instance.
#
# Usage:
#   ./scripts/check-structural-sections.sh                        # default paths
#   PERSONAL_CLAUDE=~/.claude/CLAUDE.md ./scripts/check-structural-sections.sh

set -euo pipefail

TEMPLATE="${TEMPLATE_CLAUDE:-$(dirname "$0")/../claude/CLAUDE.md.template}"
PERSONAL="${PERSONAL_CLAUDE:-$HOME/.claude/CLAUDE.md}"

# Sections that must appear in BOTH files.
# These are structural (agent philosophy, directives, system pointers) —
# not personal (paths, IDs, quirks specific to one install).
STRUCTURAL_SECTIONS=(
  "## Agent role"
  "## Plane audit trail"
  "## Agent guidelines"
  "## Skills reference"
  "## Memory system"
  "## Project intel files"
)

ok=true

check_file() {
  local file="$1"
  local label="$2"
  if [[ ! -f "$file" ]]; then
    echo "SKIP $label — file not found: $file"
    return
  fi
  local missing=()
  for section in "${STRUCTURAL_SECTIONS[@]}"; do
    # Case-insensitive match
    if ! grep -qi "^${section}" "$file" 2>/dev/null; then
      missing+=("$section")
    fi
  done
  if [[ ${#missing[@]} -eq 0 ]]; then
    echo "PASS $label"
  else
    echo "FAIL $label — missing sections:"
    for s in "${missing[@]}"; do echo "     $s"; done
    ok=false
  fi
}

check_file "$TEMPLATE" "lemon-stack template (claude/CLAUDE.md.template)"
check_file "$PERSONAL" "personal (~/.claude/CLAUDE.md)"

if $ok; then
  echo "All structural sections present in both files."
  exit 0
else
  echo "One or more structural sections are out of sync."
  exit 1
fi

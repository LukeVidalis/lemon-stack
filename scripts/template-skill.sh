#!/usr/bin/env bash
# template-skill.sh — apply standard personal-data → {{VAR}} substitutions to a file.
# Used by promote.sh (and ad-hoc) to keep skills/docs clean.
# Substitution values come from scripts/identifiers.env via identifiers.lib.sh.

set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "usage: $0 <file>" >&2
  exit 2
fi

source "$(dirname "$0")/identifiers.lib.sh"
templatize_file "$1"

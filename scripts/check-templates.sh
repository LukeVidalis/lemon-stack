#!/usr/bin/env bash
# check-templates.sh — scan repo for personal-data leakage.
# Exits non-zero on any hit; wired into CI and the pre-commit hook.
#
# The actual identifiers live in scripts/identifiers.env (gitignored) so the
# guard itself never publishes what it guards. Without that file the scan is
# skipped (exit 0) so fork CI doesn't fail — CI writes the maintainer's file
# from the LEAK_GUARD_IDENTIFIERS repo secret.

set -euo pipefail

cd "$(dirname "$0")/.."
source scripts/identifiers.lib.sh

if [[ $IDENTIFIERS_LOADED -ne 1 ]]; then
  echo "check-templates: SKIPPED — scripts/identifiers.env not found (see identifiers.example.env)."
  exit 0
fi

# Paths excluded from the scan (the gitignore and changelog example sections).
EXCLUDES=(
  ':!.gitignore'
  ':!CHANGELOG.md'
)

fail=0
while IFS= read -r pat; do
  if git ls-files -- "${EXCLUDES[@]}" 2>/dev/null | xargs -r grep -nE "$pat" 2>/dev/null; then
    echo "LEAK: pattern '$pat' found in repo — must be templated as {{VAR}}." >&2
    fail=1
  fi
done < <(leak_patterns)

if [[ $fail -eq 0 ]]; then
  echo "check-templates: OK — no personal data detected."
fi
exit $fail

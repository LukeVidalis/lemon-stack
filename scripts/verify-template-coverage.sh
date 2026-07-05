#!/usr/bin/env bash
# verify-template-coverage.sh — assert every identifier declared in
# identifiers.example.env is wired into identifiers.lib.sh (both the
# templatize substitutions and the leak patterns derive from the same vars,
# so wiring there guarantees guard/templatizer parity).
# Run in CI or before adding new personal identifiers.
set -euo pipefail
cd "$(dirname "$0")/.."

FAIL=0
while IFS= read -r line; do
  [[ $line =~ ^(IDENT_[A-Z_]+)= ]] || continue
  var="${BASH_REMATCH[1]}"
  if ! grep -q "\$$var\b" scripts/identifiers.lib.sh; then
    echo "MISSING: $var declared in identifiers.example.env but never used in identifiers.lib.sh" >&2
    FAIL=1
  fi
done < scripts/identifiers.example.env

# And the reverse: every IDENT_ var the lib consumes must be documented.
while IFS= read -r var; do
  if ! grep -q "^$var=" scripts/identifiers.example.env; then
    echo "MISSING: $var used in identifiers.lib.sh but not documented in identifiers.example.env" >&2
    FAIL=1
  fi
done < <(grep -oE '\$IDENT_[A-Z_]+' scripts/identifiers.lib.sh | tr -d '$' | sort -u)

[[ $FAIL -eq 0 ]] && echo "verify-template-coverage: OK"
exit $FAIL

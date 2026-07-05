#!/usr/bin/env bash
# render-templates.sh — substitute {{VAR}} placeholders in every *.template file
# in the repo using values from setup/parameters.env, writing the rendered file
# alongside (drops the .template suffix).
#
# Idempotent — re-running overwrites previous renders. Missing variables leave
# the placeholder intact (with a warning) so the leak is obvious.

set -euo pipefail

cd "$(dirname "$0")/.."

PARAMS="${PARAMS:-setup/parameters.env}"
if [[ ! -f $PARAMS ]]; then
  echo "render-templates: $PARAMS not found. Copy setup/parameters.example.env or run setup.sh." >&2
  exit 1
fi

# Load params into the environment. Use a subshell to filter comments/blanks safely.
set -a
# shellcheck disable=SC1090
source <(grep -E '^[A-Z_][A-Z0-9_]*=' "$PARAMS")
set +a

# Build a sed expression list from every KEY=VALUE in parameters.env.
SED_ARGS=()
missing=()
while IFS='=' read -r key val; do
  [[ -z $key || $key == \#* ]] && continue
  if [[ -z "${val:-}" ]]; then
    missing+=("$key")
  fi
  # Escape sed delimiter and ampersand in value.
  esc=$(printf '%s' "$val" | sed -e 's/[\/&|]/\\&/g')
  SED_ARGS+=(-e "s|{{$key}}|$esc|g")
done < <(grep -E '^[A-Z_][A-Z0-9_]*=' "$PARAMS")

rendered=0
mapfile -t templates < <(find infra deploy claude apps bin -name '*.template' 2>/dev/null)
for t in "${templates[@]}"; do
  out="${t%.template}"
  sed "${SED_ARGS[@]}" "$t" > "$out"
  rendered=$((rendered + 1))
done

echo "render-templates: rendered $rendered file(s)."

# Surface any leftover {{...}} placeholders so the user knows something's still unbound.
leftover=$(grep -rlE '\{\{[A-Z_][A-Z0-9_]*\}\}' \
  $(find infra deploy claude apps bin -type f ! -name '*.template' ! -name '*.md' 2>/dev/null) \
  2>/dev/null || true)
if [[ -n $leftover ]]; then
  echo "render-templates: WARNING — unresolved {{VAR}} placeholders remain in:" >&2
  echo "$leftover" | sed 's/^/  /' >&2
fi

if [[ ${#missing[@]} -gt 0 ]]; then
  echo "render-templates: WARNING — these parameters are blank in $PARAMS: ${missing[*]}" >&2
fi

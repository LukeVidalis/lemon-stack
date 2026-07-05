#!/usr/bin/env bash
# component-selector.sh — given the COMPONENTS list in parameters.env, print the
# infra directories that should be brought up. Core components always included.

set -euo pipefail

cd "$(dirname "$0")/.."

PARAMS="${PARAMS:-setup/parameters.env}"
[[ -f $PARAMS ]] || { echo "missing $PARAMS" >&2; exit 1; }

COMPONENTS=$(grep -E '^COMPONENTS=' "$PARAMS" | head -1 | cut -d= -f2-)

# Core — always installed (in startup order).
CORE=(cloudflare postgres-shared authentik caddy)

# Bring-up order matters: cloudflare first (so DNS resolves), then postgres-shared
# (authentik depends on it), then authentik, then caddy (so it can forward-auth).
# Optional components come after the core stack is healthy.

echo "core:"
for c in "${CORE[@]}"; do echo "  infra/$c"; done

echo "optional:"
IFS=',' read -r -a OPT <<<"$COMPONENTS"
for c in "${OPT[@]}"; do
  [[ -z $c ]] && continue
  if [[ -d "infra/$c" ]]; then
    echo "  infra/$c"
  else
    echo "WARN: unknown component '$c' (no infra/$c directory)" >&2
  fi
done

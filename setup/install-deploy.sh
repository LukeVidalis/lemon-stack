#!/usr/bin/env bash
# install-deploy.sh — render deploy/ templates into ~/deploy/ and seed ports.json.

set -euo pipefail

cd "$(dirname "$0")/.."
PARAMS=setup/parameters.env
[[ -f $PARAMS ]] || { echo "missing $PARAMS"; exit 1; }
# shellcheck disable=SC1090
set -a; source <(grep -E '^[A-Z_][A-Z0-9_]*=' "$PARAMS"); set +a

DEST="$HOME/deploy"
mkdir -p "$DEST"

# render-templates.sh already drops the rendered files alongside the templates —
# move them into ~/deploy/ for the runner to invoke.
bash setup/render-templates.sh >/dev/null

for f in deploy.sh bao-fetch.sh; do
  if [[ -f deploy/$f ]]; then
    install -m 755 "deploy/$f" "$DEST/$f"
    echo "installed $DEST/$f"
  fi
done

if [[ ! -f "$DEST/ports.json" ]]; then
  cp deploy/ports.example.json "$DEST/ports.json" 2>/dev/null || echo '{}' > "$DEST/ports.json"
  echo "seeded $DEST/ports.json"
fi

#!/usr/bin/env bash
# install-bin.sh — render bin/ templates into $HOME/bin/.
#
# Installs helper scripts used by deploy.sh and the intel-updater workflow:
#   - generate-claude-md.sh   deterministic per-repo CLAUDE.md generator
#   - backfill-claude-md.sh   bulk regenerate across deployed repos
#   - intel-refresh-tick.sh   queue-driven intel refresh worker

set -euo pipefail

cd "$(dirname "$0")/.."
PARAMS=setup/parameters.env
[[ -f $PARAMS ]] || { echo "missing $PARAMS"; exit 1; }
# shellcheck disable=SC1090
set -a; source <(grep -E '^[A-Z_][A-Z0-9_]*=' "$PARAMS"); set +a

DEST="$HOME/bin"
mkdir -p "$DEST"

# render-templates.sh drops rendered files alongside the .template inputs.
bash setup/render-templates.sh >/dev/null

installed=0
for tmpl in bin/*.template; do
  [[ -e $tmpl ]] || continue
  rendered="${tmpl%.template}"
  name=$(basename "$rendered")
  if [[ -f $rendered ]]; then
    install -m 755 "$rendered" "$DEST/$name"
    installed=$((installed + 1))
  fi
done
echo "bin: installed=$installed into $DEST"

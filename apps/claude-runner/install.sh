#!/usr/bin/env bash
# install.sh — install claude-runner as a systemd service.
# Copies the templated files under ~/claude-runner/, renders the systemd
# unit, creates log dirs, enables + starts the service.
#
# Run AFTER setup.sh has rendered apps/claude-runner/ (so the {{VARS}} are
# replaced). If you're running this standalone, source setup/parameters.env
# first and pipe the files through setup/render-templates.sh.

set -euo pipefail
cd "$(dirname "$0")"

DEST="${HOME}/claude-runner"
mkdir -p "$DEST/handlers" "$DEST/lib" "$DEST/logs/scheduled" "$DEST/logs/plane-claude" "$DEST/logs/plane-copilot" "$DEST/logs/trajectories" "$DEST/n8n-workflows"

cp runner.py "$DEST/runner.py"
cp handlers/*.sh "$DEST/handlers/"
chmod +x "$DEST/handlers/"*.sh
if [[ -d lib ]]; then
  cp lib/*.sh lib/*.py "$DEST/lib/" 2>/dev/null || true
  chmod +x "$DEST/lib/"*.sh 2>/dev/null || true
fi
cp -n secrets.example.env "$DEST/secrets.env" 2>/dev/null || true
chmod 600 "$DEST/secrets.env" 2>/dev/null || true
cp README.md "$DEST/README.md"

if [[ -d n8n-workflows ]]; then
  cp n8n-workflows/*.json "$DEST/n8n-workflows/" 2>/dev/null || true
fi

# Render the systemd unit. If render-templates.sh isn't available, just sed the
# two vars from the current shell.
UNIT_SRC="claude-runner.service.template"
UNIT_DST="/etc/systemd/system/claude-runner.service"
if grep -q '{{' "$UNIT_SRC"; then
  : "${ADMIN_USERNAME:=$(whoami)}"
  : "${USER_HOME:=$HOME}"
  sed -e "s|{{ADMIN_USERNAME}}|${ADMIN_USERNAME}|g" \
      -e "s|{{USER_HOME}}|${USER_HOME}|g" \
      "$UNIT_SRC" | sudo tee "$UNIT_DST" >/dev/null
else
  sudo install -m 644 "$UNIT_SRC" "$UNIT_DST"
fi

sudo systemctl daemon-reload
sudo systemctl enable --now claude-runner.service

echo
echo "✓ claude-runner installed at $DEST"
echo "✓ systemd unit at $UNIT_DST"
echo "✓ trajectory log dir at $DEST/logs/trajectories"
echo "✓ status:"
systemctl --no-pager --lines=3 status claude-runner.service || true
echo
echo "Edit $DEST/secrets.env to set PLANE_API_KEY etc., then:"
echo "  sudo systemctl restart claude-runner"
echo
echo "Trajectory logging: enable per-tool capture by adding a PostToolUse"
echo "hook to ~/.claude/settings.json (the lemon-stack claude/settings.json"
echo "template includes this). One JSONL line per tool call goes to"
echo "\$TRAJECTORY_FILE under $DEST/logs/trajectories/. See README."

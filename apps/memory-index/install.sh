#!/usr/bin/env bash
# install.sh — install the SQLite FTS5 memory index for the server-maintainer
# agent. See README.md and ~/.claude/skills/memory/SKILL.md.
#
# Originally built for {{PLANE_PROJECT_PREFIX}}-50.
#
# Steps:
#   1. Drop schema.sql + ingest.py under ~/.claude/memory/
#   2. Render and install systemd path + service units
#   3. Enable + start the path unit (it triggers the service on file change)
#   4. Run an initial ingest so the index isn't empty
#
# Prerequisites: the `lemon` CLI already on PATH with the `memory` subcommand
# (ship via ~/lemon-cli/lemon_cli/commands/memory.py).

set -euo pipefail
cd "$(dirname "$0")"

DEST="${HOME}/.claude/memory"
mkdir -p "$DEST"
install -m 644 schema.sql "$DEST/schema.sql"
install -m 755 ingest.py  "$DEST/ingest.py"

: "${USER_HOME:=$HOME}"
: "${PLANE_PROJECT_PREFIX:={{PLANE_PROJECT_PREFIX}}}"
render() {
  sed -e "s|{{USER_HOME}}|${USER_HOME}|g" \
      -e "s|{{PLANE_PROJECT_PREFIX}}|${PLANE_PROJECT_PREFIX}|g" "$1"
}

render systemd/lemon-memory-ingest.service.template \
  | sudo tee /etc/systemd/system/lemon-memory-ingest.service >/dev/null
render systemd/lemon-memory-ingest.path.template \
  | sudo tee /etc/systemd/system/lemon-memory-ingest.path >/dev/null

sudo systemctl daemon-reload
sudo systemctl enable --now lemon-memory-ingest.path

# Initial backfill — --no-llm keeps this cheap; Haiku will kick in on the next
# trajectory write.
"${USER_HOME}/bin/lemon" memory ingest --no-llm || true
"${USER_HOME}/bin/lemon" memory stats || true

echo
echo "memory index installed. Try:  lemon memory search 'openbao'"

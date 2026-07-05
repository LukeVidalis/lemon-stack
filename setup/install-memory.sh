#!/usr/bin/env bash
# install-memory.sh — install the memory scaffold under ~/.claude/memory/
#
# Copies claude/memory/MEMORY.md + README.md and the examples/ dir. Idempotent;
# never overwrites an existing MEMORY.md (your own writes win).

set -euo pipefail
cd "$(dirname "$0")/.."

SRC="claude/memory"
DEST="${HOME}/.claude/memory"

mkdir -p "$DEST" "$DEST/examples"

# README always overwritten (it's docs, not user data)
cp -f "$SRC/README.md" "$DEST/README.md"

# Index only seeded on first install
if [[ ! -f "$DEST/MEMORY.md" ]]; then
  cp "$SRC/MEMORY.md" "$DEST/MEMORY.md"
  echo "  ✓ seeded $DEST/MEMORY.md"
else
  echo "  · kept existing $DEST/MEMORY.md"
fi

# Examples always synced — they're templates, not memories
cp -f "$SRC/examples/"*.md "$DEST/examples/"
echo "  ✓ synced $(ls "$SRC/examples" | wc -l) example file(s) into $DEST/examples/"

cat <<EOF

Memory scaffold installed at: $DEST

Next steps:
- Agents will read $DEST/MEMORY.md at session start when relevant.
- Add new memories as $DEST/<type>_<subject>.md and an index entry in MEMORY.md.
- Examples in $DEST/examples/ are templates, not active memories — delete them
  once you have real ones, or keep them as format reference.
EOF

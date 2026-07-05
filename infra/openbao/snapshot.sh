#!/usr/bin/env bash
# Daily Raft snapshot of OpenBao. Captured by ~/backup.sh restic run.
# Cron: 0 2 * * * {{USER_HOME}}/docker/openbao/snapshot.sh >> {{USER_HOME}}/docker/openbao/snapshots/snapshot.log 2>&1
set -euo pipefail

TS=$(date -u +%Y%m%dT%H%M%SZ)
SNAP_DIR={{USER_HOME}}/docker/openbao/snapshots
KEEP=7

# Sealed check first — sealed Bao cannot snapshot
sealed=$(curl -sf http://127.0.0.1:8200/v1/sys/seal-status \
  | python3 -c "import json,sys;print(json.load(sys.stdin)['sealed'])")
if [[ "$sealed" != "False" ]]; then
  echo "[$(date -uIs)] SKIP snapshot: bao is sealed" >&2
  exit 1
fi

TOKEN=$(cat {{USER_HOME}}/.bao/token)
curl -sf -H "X-Vault-Token: $TOKEN" \
  -o "$SNAP_DIR/bao-${TS}.snap" \
  http://127.0.0.1:8200/v1/sys/storage/raft/snapshot

# Symlink "latest" for restic
ln -sf "bao-${TS}.snap" "$SNAP_DIR/latest.snap"

# Retain only the most recent KEEP snapshots (restic handles long-term)
ls -1t "$SNAP_DIR"/bao-*.snap 2>/dev/null | tail -n +$((KEEP + 1)) | xargs -r rm -f

echo "[$(date -uIs)] OK snapshot: bao-${TS}.snap ($(stat -c%s "$SNAP_DIR/bao-${TS}.snap") bytes)"

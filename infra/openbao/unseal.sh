#!/usr/bin/env bash
# Unseal OpenBao using keys from init.json (mode 600).
# Manual run after host reboot, or invoked by bao-sealed-alert cron via host-cmd.
set -euo pipefail

INIT_FILE="${BAO_INIT_FILE:-{{USER_HOME}}/docker/openbao/init.json}"
BAO_ADDR="${BAO_ADDR:-http://127.0.0.1:8200}"

if [[ ! -r "$INIT_FILE" ]]; then
  echo "ERROR: cannot read $INIT_FILE" >&2
  exit 1
fi

status=$(curl -sf "$BAO_ADDR/v1/sys/seal-status")
sealed=$(echo "$status" | python3 -c 'import json,sys;print(json.load(sys.stdin)["sealed"])')
if [[ "$sealed" != "True" ]]; then
  echo "OpenBao already unsealed."
  exit 0
fi

threshold=$(echo "$status" | python3 -c 'import json,sys;print(json.load(sys.stdin)["t"])')

for i in $(seq 0 $((threshold - 1))); do
  key=$(python3 -c "import json;print(json.load(open('$INIT_FILE'))['keys_base64'][$i])")
  curl -sf -X POST -d "{\"key\":\"$key\"}" "$BAO_ADDR/v1/sys/unseal" >/dev/null
done

curl -sf "$BAO_ADDR/v1/sys/seal-status" | python3 -c "import json,sys; d=json.load(sys.stdin); print('sealed=' + str(d['sealed']))"

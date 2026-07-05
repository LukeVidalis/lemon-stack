#!/usr/bin/env bash
# Set or rotate a single secret in OpenBao.
#
# Usage:
#   bao-set.sh <app> <KEY> <VALUE>
#   bao-set.sh <app> <KEY> -                  # read VALUE from stdin (preferred for secrets)
#
# After this, redeploy the consumer (empty-commit push for pipeline apps, or
# manual restart for non-pipeline apps) for the new value to take effect.
set -euo pipefail

APP="${1:-}"; KEY="${2:-}"; VAL="${3:-}"
if [[ -z "$APP" || -z "$KEY" ]]; then
  echo "usage: $0 <app> <KEY> <VALUE|->" >&2
  exit 1
fi
[[ ! "$KEY" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] && { echo "invalid KEY: $KEY" >&2; exit 1; }

if [[ "$VAL" == "-" || -z "$VAL" ]]; then
  read -r -s -p "value for $APP/$KEY: " VAL
  echo
fi

BAO_ADDR="${BAO_ADDR:-http://127.0.0.1:8200}"
TOKEN="$(cat "${BAO_TOKEN_FILE:-{{USER_HOME}}/.bao/token}")"
H="X-Vault-Token: $TOKEN"

body=$(V="$VAL" python3 -c "import json,os;print(json.dumps({'data':{'value':os.environ['V']}}))")
http_code=$(curl -sS -o /tmp/bao-set.out -w "%{http_code}" -X POST -H "$H" \
  -d "$body" "$BAO_ADDR/v1/secret/data/apps/$APP/$KEY")
if [[ "$http_code" != "200" ]]; then
  echo "FAIL: HTTP $http_code -- $(cat /tmp/bao-set.out)" >&2
  exit 2
fi

version=$(python3 -c "import json;print(json.load(open('/tmp/bao-set.out'))['data']['version'])")
rm -f /tmp/bao-set.out
echo "OK: secret/apps/$APP/$KEY now version $version"
echo "    → redeploy $APP to apply (e.g. empty-commit push, or restart container)"

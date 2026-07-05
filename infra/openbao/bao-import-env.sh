#!/usr/bin/env bash
# Import a project's secrets.env into OpenBao at secret/apps/<app>/<KEY>.
# Each KEY becomes its own KV v2 entry with a single 'value' field — matches
# bao-fetch.sh's read convention.
#
# Usage:  bao-import-env.sh <app> [path-to-secrets.env]
# Default path: {{USER_HOME}}/docker/<app>/secrets.env
# Idempotent: re-running overwrites existing values (KV v2 keeps version history).
set -euo pipefail

APP="${1:-}"
[[ -z "$APP" ]] && { echo "usage: $0 <app> [secrets.env path]" >&2; exit 1; }

SRC="${2:-{{USER_HOME}}/docker/$APP/secrets.env}"
[[ -r "$SRC" ]] || { echo "ERROR: cannot read $SRC (try with sudo)" >&2; exit 2; }

BAO_ADDR="${BAO_ADDR:-http://127.0.0.1:8200}"
TOKEN="$(cat "${BAO_TOKEN_FILE:-{{USER_HOME}}/.bao/token}")"
H="X-Vault-Token: $TOKEN"

count=0
while IFS= read -r line || [[ -n "$line" ]]; do
  # skip blanks and comments
  [[ -z "${line// }" || "${line#"${line%%[![:space:]]*}"}" == \#* ]] && continue
  # split on first =
  key="${line%%=*}"
  val="${line#*=}"
  # trim possible surrounding quotes on value
  if [[ "$val" =~ ^\".*\"$ ]]; then val="${val:1:-1}"; fi
  if [[ "$val" =~ ^\'.*\'$ ]]; then val="${val:1:-1}"; fi
  # validate key
  [[ ! "$key" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] && { echo "skip invalid key: $key" >&2; continue; }

  body=$(V="$val" python3 -c "import json,os;print(json.dumps({'data':{'value':os.environ['V']}}))")
  http_code=$(curl -sS -o /tmp/bao-import.out -w "%{http_code}" -X POST -H "$H" \
    -d "$body" "$BAO_ADDR/v1/secret/data/apps/$APP/$key")
  if [[ "$http_code" != "200" ]]; then
    echo "FAIL $key: HTTP $http_code -- $(cat /tmp/bao-import.out)" >&2
    exit 3
  fi
  echo "  imported $key"
  count=$((count + 1))
done < "$SRC"

rm -f /tmp/bao-import.out
echo "OK: imported $count keys for '$APP' into secret/apps/$APP/"

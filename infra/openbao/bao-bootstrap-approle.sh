#!/usr/bin/env bash
# Bootstrap an AppRole + policy for a single app.
#
# Usage:  bao-bootstrap-approle.sh <app>
# Effect:
#   - Creates/updates policy app-<app> allowing read on secret/data/apps/<app>/*
#     and list on secret/metadata/apps/<app>/*
#   - Creates/updates approle/role/<app> bound to that policy
#   - Writes role_id  -> ~/docker/<app>/.bao-role-id      (mode 600)
#   - Writes secret_id-> ~/docker/<app>/.bao-secret-id    (mode 600, rotated each run)
set -euo pipefail

APP="${1:-}"
if [[ -z "$APP" ]] || [[ ! "$APP" =~ ^[a-z][a-z0-9_-]*$ ]]; then
  echo "usage: $0 <app>" >&2
  exit 1
fi

BAO_ADDR="${BAO_ADDR:-http://127.0.0.1:8200}"
TOKEN_FILE="${BAO_TOKEN_FILE:-{{USER_HOME}}/.bao/token}"
TOKEN="$(cat "$TOKEN_FILE")"
H="X-Vault-Token: $TOKEN"

APP_DIR="{{USER_HOME}}/docker/$APP"
mkdir -p "$APP_DIR"

# 1. Policy (idempotent — PUT replaces)
POLICY=$(cat <<EOF
path "secret/data/apps/${APP}/*" {
  capabilities = ["read"]
}
path "secret/metadata/apps/${APP}/*" {
  capabilities = ["list", "read"]
}
path "secret/data/shared/*" {
  capabilities = ["read"]
}
EOF
)
POLICY_JSON=$(python3 -c "import json,sys;print(json.dumps({'policy':sys.stdin.read()}))" <<<"$POLICY")
curl -sf -X PUT -H "$H" -d "$POLICY_JSON" "$BAO_ADDR/v1/sys/policies/acl/app-${APP}" >/dev/null

# 2. AppRole (idempotent)
curl -sf -X POST -H "$H" -d "{
  \"token_policies\": [\"app-${APP}\"],
  \"token_ttl\": \"15m\",
  \"token_max_ttl\": \"30m\",
  \"secret_id_ttl\": \"0\",
  \"secret_id_num_uses\": 0
}" "$BAO_ADDR/v1/auth/approle/role/${APP}" >/dev/null

# 3. Fetch role_id
ROLE_ID=$(curl -sf -H "$H" "$BAO_ADDR/v1/auth/approle/role/${APP}/role-id" \
  | python3 -c "import json,sys;print(json.load(sys.stdin)['data']['role_id'])")

# 4. Generate a new secret_id (rotates every run — by design)
SECRET_ID=$(curl -sf -X POST -H "$H" "$BAO_ADDR/v1/auth/approle/role/${APP}/secret-id" \
  | python3 -c "import json,sys;print(json.load(sys.stdin)['data']['secret_id'])")

umask 077
printf '%s' "$ROLE_ID"   > "$APP_DIR/.bao-role-id"
printf '%s' "$SECRET_ID" > "$APP_DIR/.bao-secret-id"
chmod 600 "$APP_DIR/.bao-role-id" "$APP_DIR/.bao-secret-id"

echo "OK: AppRole '$APP' provisioned."
echo "    role_id   -> $APP_DIR/.bao-role-id"
echo "    secret_id -> $APP_DIR/.bao-secret-id (rotated this run)"
echo "    policy    -> app-${APP} (read secret/data/apps/${APP}/* + secret/data/shared/*)"

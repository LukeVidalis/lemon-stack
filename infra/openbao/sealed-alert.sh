#!/usr/bin/env bash
# Alert via tg-notify when OpenBao is sealed (e.g. after host reboot).
# Cron: */5 * * * * {{USER_HOME}}/docker/openbao/sealed-alert.sh
set -euo pipefail

STATE_FILE=/tmp/.bao-sealed-alert-state
status=$(curl -sf --max-time 4 http://127.0.0.1:8200/v1/sys/seal-status 2>/dev/null) || {
  current="unreachable"
  message="OpenBao API at 127.0.0.1:8200 not responding."
}

if [[ -n "${status:-}" ]]; then
  sealed=$(echo "$status" | python3 -c "import json,sys;print(json.load(sys.stdin)['sealed'])")
  if [[ "$sealed" == "True" ]]; then
    current="sealed"
    message="OpenBao is SEALED. Run: ~/docker/openbao/unseal.sh"
  else
    current="ok"
  fi
fi

prev=$(cat "$STATE_FILE" 2>/dev/null || echo "")

# Only alert on transitions: ok -> bad
if [[ "$current" != "ok" && "$prev" == "ok" ]] || [[ "$current" != "ok" && -z "$prev" ]]; then
  secret_file={{USER_HOME}}/docker/tg-notify/secrets.env
  if [[ -r "$secret_file" ]]; then
    secret=$(grep '^API_SECRET=' "$secret_file" | cut -d= -f2-)
    curl -sf -X POST http://127.0.0.1:10020/send \
      -H "Authorization: Bearer $secret" \
      -H "Content-Type: application/json" \
      -d "{\"level\":\"error\",\"title\":\"OpenBao $current\",\"message\":\"$message\"}" \
      >/dev/null 2>&1 || true
  fi
fi

# Recovery notice on bad -> ok
if [[ "$current" == "ok" && -n "$prev" && "$prev" != "ok" ]]; then
  secret_file={{USER_HOME}}/docker/tg-notify/secrets.env
  if [[ -r "$secret_file" ]]; then
    secret=$(grep '^API_SECRET=' "$secret_file" | cut -d= -f2-)
    curl -sf -X POST http://127.0.0.1:10020/send \
      -H "Authorization: Bearer $secret" \
      -H "Content-Type: application/json" \
      -d "{\"level\":\"info\",\"title\":\"OpenBao recovered\",\"message\":\"State: $current (was $prev)\"}" \
      >/dev/null 2>&1 || true
  fi
fi

printf '%s' "$current" > "$STATE_FILE"

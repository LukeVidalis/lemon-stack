#!/usr/bin/env bash
# Post-deploy smoke test. The self-hosted runner is on lemon-server itself,
# so we route through local Caddy on 127.0.0.1:80 with a Host: header — this
# bypasses Cloudflare Access (which returns 403 to unauthenticated edge calls)
# while still exercising Caddy routing.
#
# Usage: ./scripts/smoke-test.sh <host-header> [path1[,path2,...]] [max-wait]
#   ./scripts/smoke-test.sh notify.{{DOMAIN}} /health 120
set -euo pipefail

HOST="${1:?usage: smoke-test.sh <host-header> [paths] [max-wait]}"
PATHS="${2:-/health}"
MAX_WAIT="${3:-120}"
DEADLINE=$(( $(date +%s) + MAX_WAIT ))

probe() {
    local path="$1"
    while [[ $(date +%s) -lt $DEADLINE ]]; do
        code=$(curl -fsS -H "Host: $HOST" -o /dev/null -w '%{http_code}' "http://127.0.0.1$path" 2>/dev/null || echo "000")
        if [[ "$code" == "200" ]]; then
            echo "OK    $HOST$path"
            return 0
        fi
        echo "wait  $HOST$path ($code)"
        sleep 2
    done
    echo "FAIL  $HOST$path (deadline ${MAX_WAIT}s)"
    return 1
}

IFS=',' read -ra paths <<< "$PATHS"
for p in "${paths[@]}"; do
    probe "$p"
done

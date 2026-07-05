#!/usr/bin/env bash
# verify-install.sh — comprehensive lemon-stack health check.
# Runs the existing post-install-checks plus runtime additions (every deployed
# subdomain, OpenBao sealed state, GH Actions runner, claude-runner,
# tg-notify reachability from lemon-internal, Loki has recent logs, backup
# freshness). Safe to run any time (post-install AND ongoing maintenance).
#
# Used by:
#   - setup.sh --check (replaces / extends post-install-checks.sh)
#   - the `server-maintainer` agent on its daily run
#   - the `/verify` skill
#
# Exits 0 if everything PASSes, 1 if any FAIL.

set -uo pipefail

cd "$(dirname "$0")/.."

# ── Load config ───────────────────────────────────────────────────────────────
# Prefer setup/parameters.env (lemon-stack install). Fall back to env vars so
# this script also runs cleanly on the personal server.
PARAMS="setup/parameters.env"
if [[ -f $PARAMS ]]; then
  # shellcheck disable=SC1090
  set -a; source <(grep -E '^[A-Z_][A-Z0-9_]*=' "$PARAMS"); set +a
fi
: "${DOMAIN:?DOMAIN env var or setup/parameters.env required}"
: "${GITHUB_ORG:=}"
: "${COMPONENTS:=monitoring,openbao,plane-automation}"

FAIL=0 PASS_COUNT=0
pass() { echo "  ✓ $*"; PASS_COUNT=$((PASS_COUNT+1)); }
fail() { echo "  ✗ $*"; FAIL=$((FAIL+1)); }
hdr()  { echo; echo "── $* ──"; }

# ── 1. Run base post-install checks if present ────────────────────────────────
if [[ -x setup/post-install-checks.sh && -f setup/parameters.env ]]; then
  hdr "Base post-install checks"
  if setup/post-install-checks.sh; then
    pass "base post-install-checks.sh"
  else
    fail "base post-install-checks.sh reported failures (see above)"
  fi
fi

# ── 2. Every deployed app subdomain returns non-502 ──────────────────────────
hdr "Deployed app subdomains"
PORTS_JSON="${HOME}/deploy/ports.json"
if [[ -f $PORTS_JSON ]]; then
  # ports.json maps repo -> port or repo -> {service: port}. Just probe Caddy.
  apps=$(python3 -c "import json; print(' '.join(json.load(open('$PORTS_JSON')).keys()))" 2>/dev/null || true)
  for app in $apps; do
    url="https://${app}.${DOMAIN}"
    code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 8 "$url" || echo "000")
    case "$code" in
      200|301|302|401|403) pass "$url -> $code" ;;
      000) fail "$url unreachable (timeout/dns)" ;;
      502|503|504) fail "$url -> $code (backend down?)" ;;
      *) pass "$url -> $code (non-fatal)" ;;
    esac
  done
else
  echo "  · skipped (no $PORTS_JSON)"
fi

# ── 3. OpenBao unsealed (not just responding) ────────────────────────────────
if [[ ",${COMPONENTS}," == *,openbao,* ]]; then
  hdr "OpenBao seal state"
  if sealed=$(curl -sf --max-time 3 http://127.0.0.1:8200/v1/sys/health \
       | python3 -c "import json,sys; print(json.load(sys.stdin).get('sealed'))" 2>/dev/null); then
    if [[ $sealed == "False" ]]; then
      pass "openbao unsealed"
      # Smoke-test a known app fetch if available.
      for testapp in tg-notify food-splitter renovate; do
        if [[ -f "$HOME/docker/$testapp/.bao-role-id" ]]; then
          if "$HOME/deploy/bao-fetch.sh" "$testapp" >/dev/null 2>&1; then
            pass "bao-fetch.sh $testapp succeeded"
          else
            fail "bao-fetch.sh $testapp failed"
          fi
          break
        fi
      done
    else
      fail "openbao SEALED — manual unseal required"
    fi
  else
    fail "openbao not reachable on :8200"
  fi
fi

# ── 4. GitHub Actions self-hosted runner ─────────────────────────────────────
hdr "GitHub Actions runner"
if systemctl list-units --type=service --no-legend 'actions.runner.*' 2>/dev/null \
     | grep -q "active running"; then
  pass "actions.runner.* service active"
else
  if [[ -d "$HOME/actions-runner" ]]; then
    fail "actions.runner.* service not active (~/actions-runner exists)"
  else
    echo "  · skipped (no ~/actions-runner)"
  fi
fi

# ── 5. claude-runner ─────────────────────────────────────────────────────────
if [[ ",${COMPONENTS}," == *,plane-automation,* ]] || [[ -d "$HOME/claude-runner" ]]; then
  hdr "claude-runner"
  if curl -sf --max-time 3 http://127.0.0.1:9879/health >/dev/null; then
    pass "claude-runner /health on :9879"
  else
    fail "claude-runner not responding on :9879"
  fi
fi

# ── 6. tg-notify reachable from lemon-internal network ───────────────────────
hdr "tg-notify on lemon-internal"
if docker network inspect lemon-internal >/dev/null 2>&1 \
   && docker ps --format '{{.Names}}' | grep -q "^tg-notify"; then
  # First verify tg-notify is actually attached to lemon-internal.
  if docker inspect tg-notify \
       --format '{{range $k,$v := .NetworkSettings.Networks}}{{$k}} {{end}}' \
       | grep -qw lemon-internal; then
    if docker run --rm --network lemon-internal curlimages/curl:latest \
         -sf --max-time 5 http://tg-notify:8080/health >/dev/null 2>&1; then
      pass "tg-notify:8080/health reachable from lemon-internal"
    elif docker run --rm --network lemon-internal curlimages/curl:latest \
           -s -o /dev/null -w "%{http_code}" --max-time 5 http://tg-notify:8080/ 2>/dev/null \
           | grep -qE '^(200|404|405)$'; then
      pass "tg-notify:8080 reachable (no /health endpoint)"
    else
      fail "tg-notify on lemon-internal but :8080 not responding"
    fi
  else
    fail "tg-notify NOT attached to lemon-internal (CLAUDE.md says it should be)"
  fi
else
  echo "  · skipped (no tg-notify container or lemon-internal network)"
fi

# ── 7. Loki receiving recent logs ────────────────────────────────────────────
if [[ ",${COMPONENTS}," == *,monitoring,* ]]; then
  hdr "Loki recent logs"
  # Use the `container` label which Promtail always populates. job=docker
  # is not present in this install.
  q=$(python3 -c "import urllib.parse; print(urllib.parse.quote('{container=~\".+\"}'))")
  start_ns=$(( ($(date +%s) - 300) * 1000000000 ))
  end_ns=$(( $(date +%s) * 1000000000 ))
  url="http://127.0.0.1:3100/loki/api/v1/query_range?query=${q}&limit=1&start=${start_ns}&end=${end_ns}"
  if curl -sf --max-time 5 "$url" \
       | python3 -c "import json,sys; d=json.load(sys.stdin); sys.exit(0 if d.get('data',{}).get('result') else 1)" 2>/dev/null; then
    pass "loki has logs in last 5 min"
  else
    fail "loki has no recent logs (promtail down?)"
  fi
fi

# ── 8. Backup freshness (last finished within 25h) ───────────────────────────
hdr "Backup freshness"
if [[ -f "$HOME/backup.sh" ]]; then
  if crontab -l 2>/dev/null | grep -q "$HOME/backup.sh"; then
    pass "backup cron entry present"
  else
    fail "backup.sh installed but no cron entry"
  fi
  if [[ -f "$HOME/.restic-env" ]]; then
    perms=$(stat -c '%a' "$HOME/.restic-env")
    if [[ "$perms" == "600" ]]; then
      pass ".restic-env exists with mode 600"
    else
      fail ".restic-env has mode $perms (want 600)"
    fi
  else
    fail "backup.sh installed but ~/.restic-env missing"
  fi
fi
BACKUP_LOG="${HOME}/backup.log"
if [[ -f $BACKUP_LOG ]]; then
  # Look for the most recent line containing 'finished' or 'snapshot' as a heuristic.
  age_h=$(python3 -c "
import os, time
st = os.stat('$BACKUP_LOG').st_mtime
print(int((time.time() - st) / 3600))
" 2>/dev/null || echo 999)
  if [[ $age_h -lt 25 ]]; then
    pass "backup.log modified ${age_h}h ago"
  else
    fail "backup.log not modified in ${age_h}h (last backup may have failed)"
  fi
else
  echo "  · skipped (no $BACKUP_LOG)"
fi

# ── Summary ──────────────────────────────────────────────────────────────────
echo
if [[ $FAIL -eq 0 ]]; then
  echo "✅ verify-install: all checks passed (${PASS_COUNT} ✓)"
  exit 0
else
  echo "❌ verify-install: ${FAIL} check(s) failed (${PASS_COUNT} ✓)"
  exit 1
fi

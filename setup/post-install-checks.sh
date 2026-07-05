#!/usr/bin/env bash
# post-install-checks.sh — sanity-check a fresh lemon-stack install.
# Run after setup.sh completes. Exits non-zero on any failure so it's usable
# in CI / cron / Telegram alerting.

set -uo pipefail

cd "$(dirname "$0")/.."
PARAMS="setup/parameters.env"
[[ -f $PARAMS ]] || { echo "FAIL: $PARAMS missing — run setup.sh first."; exit 1; }
# shellcheck disable=SC1090
set -a; source <(grep -E '^[A-Z_][A-Z0-9_]*=' "$PARAMS"); set +a

FAIL=0
pass() { echo "  ✓ $*"; }
fail() { echo "  ✗ $*"; FAIL=$((FAIL+1)); }
hdr()  { echo; echo "── $* ──"; }

hdr "Docker"
if docker info >/dev/null 2>&1; then pass "docker daemon reachable"
else fail "docker daemon not reachable"; fi
if docker network inspect lemon-internal >/dev/null 2>&1; then pass "lemon-internal network exists"
else fail "lemon-internal network missing"; fi

hdr "Core containers"
for c in cloudflared postgres-shared authentik-server caddy; do
  if docker ps --format '{{.Names}}' | grep -q "^${c}$"; then pass "$c running"
  else fail "$c not running"; fi
done

hdr "Caddy"
if curl -fsS -o /dev/null --max-time 5 "https://auth.${DOMAIN}/-/health/live/"; then
  pass "Authentik reachable via Caddy/Cloudflare at https://auth.${DOMAIN}"
else
  fail "https://auth.${DOMAIN}/-/health/live/ unreachable (check Cloudflare tunnel + DNS)"
fi

hdr "Postgres-shared"
if docker exec postgres-shared pg_isready -U postgres >/dev/null 2>&1; then
  pass "postgres-shared accepting connections"
else
  fail "postgres-shared not ready"
fi

if [[ ",${COMPONENTS:-}," == *,openbao,* ]]; then
  hdr "OpenBao"
  if curl -fsS -o /dev/null --max-time 3 http://127.0.0.1:8200/v1/sys/health 2>/dev/null \
       || curl -fsS -o /dev/null --max-time 3 -w '%{http_code}' http://127.0.0.1:8200/v1/sys/health 2>/dev/null | grep -qE '^(200|429|472|473|501|503)$'; then
    pass "openbao responding on :8200"
  else
    fail "openbao not responding — did you run unseal.sh?"
  fi
fi

if [[ ",${COMPONENTS:-}," == *,monitoring,* ]]; then
  hdr "Monitoring"
  if curl -fsS -o /dev/null --max-time 3 http://127.0.0.1:3100/ready; then
    pass "loki ready"
  else
    fail "loki not ready on :3100"
  fi
  if curl -fsS -o /dev/null --max-time 3 http://127.0.0.1:3200/api/health; then
    pass "grafana healthy on :3200"
  else
    fail "grafana not healthy on :3200"
  fi
fi

hdr "lemon CLI"
if command -v lemon >/dev/null 2>&1; then
  pass "lemon CLI on PATH"
  if LEMON_DOMAIN="$DOMAIN" LEMON_GITHUB_ORG="$GITHUB_ORG" lemon server-health --pretty >/dev/null 2>&1; then
    pass "lemon server-health ran clean"
  else
    fail "lemon server-health errored — run manually to inspect"
  fi
else
  fail "lemon CLI not on PATH (expected ~/.local/bin/lemon)"
fi

hdr "Claude skills"
if [[ -d "$HOME/.claude/skills" ]]; then
  count=$(find "$HOME/.claude/skills" -maxdepth 2 -name SKILL.md | wc -l)
  if [[ $count -gt 0 ]]; then pass "$count skills installed"
  else fail "~/.claude/skills exists but contains no SKILL.md files"; fi
else
  fail "~/.claude/skills missing"
fi

echo
if [[ $FAIL -eq 0 ]]; then
  echo "✅ all checks passed"
  exit 0
else
  echo "❌ $FAIL check(s) failed"
  exit 1
fi

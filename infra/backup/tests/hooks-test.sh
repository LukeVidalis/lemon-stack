#!/usr/bin/env bash
# hooks-test.sh — hook soft-skip and dump-production tests using a docker stub.
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
HOOKS_SRC="$HERE/../hooks"
FAILURES=0
t_pass() { echo "  ok: $1"; }
t_fail() { echo "  FAIL: $1" >&2; FAILURES=$((FAILURES + 1)); }

setup_sandbox() {
  SB="$(mktemp -d)"
  mkdir -p "$SB/bin"
  export DUMP_DIR="$SB/dump"; mkdir -p "$DUMP_DIR"
  # docker stub: behaviour driven by DOCKER_STUB_RUNNING (container names, space-sep).
  cat > "$SB/bin/docker" <<'STUB'
#!/usr/bin/env bash
case "$1" in
  ps)
    for n in ${DOCKER_STUB_RUNNING:-}; do echo "$n"; done ;;
  exec)
    shift; c="$1"; shift
    # postgres-shared list-DBs query returns two fake DBs
    if [[ "$*" == *pg_database* ]]; then printf 'alpha\nbeta\n'; exit 0; fi
    if [[ "$*" == *pg_dumpall* || "$*" == *pg_dump* ]]; then echo "-- dump"; exit 0; fi
    exit 0 ;;
  run)
    # n8n sqlite copy: last arg pattern 'cp SRC /dump/n8n.sqlite'
    echo "sqlite" > "$DUMP_DIR/n8n.sqlite"; exit 0 ;;
  volume) echo ""; exit 0 ;;
esac
exit 0
STUB
  chmod +x "$SB/bin/docker"
}
run_hook() { PATH="$SB/bin:$PATH" bash "$1"; }

echo "test: postgres-shared hook — running container produces globals + per-DB dumps"
setup_sandbox
if grep -q '{{[A-Z_]*}}' "$HOOKS_SRC/50-postgres-shared.sh.template"; then
  echo "FATAL: hook contains {{VARS}}" >&2; exit 1
fi
DOCKER_STUB_RUNNING="postgres-shared" run_hook "$HOOKS_SRC/50-postgres-shared.sh.template" \
  && t_pass "exit 0" || t_fail "nonzero exit"
[[ -s "$DUMP_DIR/pg-shared-globals.sql" ]] && t_pass "globals dumped" || t_fail "no globals dump"
[[ -s "$DUMP_DIR/pg-shared-alpha.dump" && -s "$DUMP_DIR/pg-shared-beta.dump" ]] \
  && t_pass "per-DB dumps" || t_fail "per-DB dumps missing"
rm -rf "$SB"

echo "test: postgres-shared hook — container down soft-skips (exit 0, no dumps)"
setup_sandbox
DOCKER_STUB_RUNNING="" run_hook "$HOOKS_SRC/50-postgres-shared.sh.template" \
  && t_pass "soft skip exit 0" || t_fail "nonzero exit when down"
[[ -z "$(ls -A "$DUMP_DIR")" ]] && t_pass "no dumps written" || t_fail "dumps written while down"
rm -rf "$SB"

echo "test: n8n hook — running container copies sqlite"
setup_sandbox
DOCKER_STUB_RUNNING="n8n" run_hook "$HOOKS_SRC/55-n8n-sqlite.sh.template" \
  && t_pass "exit 0" || t_fail "nonzero exit"
[[ -s "$DUMP_DIR/n8n.sqlite" ]] && t_pass "n8n.sqlite present" || t_fail "n8n.sqlite missing"
rm -rf "$SB"

echo "test: n8n hook — container down soft-skips"
setup_sandbox
DOCKER_STUB_RUNNING="" run_hook "$HOOKS_SRC/55-n8n-sqlite.sh.template" \
  && t_pass "soft skip exit 0" || t_fail "nonzero exit when down"
rm -rf "$SB"

echo "test: openbao hook — container down soft-skips"
setup_sandbox
DOCKER_STUB_RUNNING="" run_hook "$HOOKS_SRC/60-openbao-snapshot.sh.template" \
  && t_pass "soft skip exit 0" || t_fail "nonzero exit when down"
rm -rf "$SB"

if [[ $FAILURES -gt 0 ]]; then echo "❌ $FAILURES failure(s)"; exit 1; fi
echo "✅ hooks-test: all tests passed"

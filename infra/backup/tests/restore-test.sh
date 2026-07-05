#!/usr/bin/env bash
# restore-test.sh — sandboxed tests for restore.sh (restic + docker stubs).
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
RESTORE_TEMPLATE="$HERE/../restore.sh.template"
FAILURES=0
t_pass() { echo "  ok: $1"; }
t_fail() { echo "  FAIL: $1" >&2; FAILURES=$((FAILURES + 1)); }

setup_sandbox() {
  SB="$(mktemp -d)"
  mkdir -p "$SB/bin" "$SB/staging"
  if grep -q '{{[A-Z_]*}}' "$RESTORE_TEMPLATE"; then
    echo "FATAL: restore template contains {{VARS}}" >&2; exit 1
  fi
  install -m 755 "$RESTORE_TEMPLATE" "$SB/restore.sh"
  printf 'export RESTIC_REPOSITORY=/dev/null\nexport RESTIC_PASSWORD=x\n' > "$SB/env"
  # restic stub: 'restore' materialises a fake dump under --target.
  cat > "$SB/bin/restic" <<'STUB'
#!/usr/bin/env bash
echo "restic $*" >> "$RESTIC_CALLS"
if [[ "$1" == "restore" ]]; then
  target=""; include=""
  args=("$@")
  for i in "${!args[@]}"; do
    [[ "${args[$i]}" == "--target" ]] && target="${args[$((i+1))]}"
    [[ "${args[$i]}" == "--include" ]] && include="${args[$((i+1))]}"
  done
  mkdir -p "$target/fake"
  case "$include" in
    *pg-shared-*) name="${include##*pg-shared-}"; name="${name%.dump}"
                  echo "dump" > "$target/fake/pg-shared-$name.dump" ;;
    *) echo "content" > "$target/fake/restored-file" ;;
  esac
fi
exit 0
STUB
  chmod +x "$SB/bin/restic"
  cat > "$SB/bin/docker" <<'STUB'
#!/usr/bin/env bash
echo "docker $*" >> "$DOCKER_CALLS"
exit 0
STUB
  chmod +x "$SB/bin/docker"
  export RESTIC_CALLS="$SB/restic-calls.log" DOCKER_CALLS="$SB/docker-calls.log"
  : > "$RESTIC_CALLS"; : > "$DOCKER_CALLS"
}
run_restore() {
  PATH="$SB/bin:$PATH" RESTIC_ENV="$SB/env" STAGING_ROOT="$SB/staging" \
  PG_CONTAINER="postgres-shared" "$SB/restore.sh" "$@" > "$SB/out.log" 2>&1
}

echo "test: no args prints usage, exit 2"
setup_sandbox
run_restore
rc=$?
[[ $rc -eq 2 ]] && t_pass "exit 2" || t_fail "exit $rc (want 2)"
grep -qi 'usage' "$SB/out.log" && t_pass "usage shown" || t_fail "no usage"
rm -rf "$SB"

echo "test: list passes through to restic snapshots"
setup_sandbox
run_restore list && t_pass "exit 0" || t_fail "exit $?"
grep -q '^restic snapshots' "$RESTIC_CALLS" && t_pass "restic snapshots" || t_fail "not called"
rm -rf "$SB"

echo "test: files restores into a fresh staging dir"
setup_sandbox
run_restore files latest /etc/some/file && t_pass "exit 0" || t_fail "exit $?"
grep -q -- '--include /etc/some/file' "$RESTIC_CALLS" && t_pass "include passed" || t_fail "include missing"
find "$SB/staging" -name restored-file | grep -q . && t_pass "file staged" || t_fail "nothing staged"
grep -q "restored under:" "$SB/out.log" && t_pass "target printed" || t_fail "target not printed"
rm -rf "$SB"

echo "test: db (scratch mode) restores into <name>_restoretest, never touches live db"
setup_sandbox
run_restore db alpha && t_pass "exit 0" || t_fail "exit $?"
grep -q 'CREATE DATABASE "alpha_restoretest"' "$DOCKER_CALLS" \
  && t_pass "scratch db created" || t_fail "scratch db not created"
grep -q -- '-d alpha_restoretest' "$DOCKER_CALLS" \
  && t_pass "pg_restore into scratch" || t_fail "pg_restore target wrong"
grep -qE -- '-d alpha( |$)' "$DOCKER_CALLS" && t_fail "touched live db" || t_pass "live db untouched"
rm -rf "$SB"

echo "test: db --in-place without 'yes' confirmation aborts"
setup_sandbox
echo "no" | PATH="$SB/bin:$PATH" RESTIC_ENV="$SB/env" STAGING_ROOT="$SB/staging" \
  PG_CONTAINER="postgres-shared" "$SB/restore.sh" db alpha --in-place \
  > "$SB/out.log" 2>&1
rc=$?
[[ $rc -ne 0 ]] && t_pass "aborted" || t_fail "did not abort"
grep -q -- '--clean' "$DOCKER_CALLS" && t_fail "pg_restore ran anyway" || t_pass "no restore ran"
rm -rf "$SB"

if [[ $FAILURES -gt 0 ]]; then echo "❌ $FAILURES failure(s)"; exit 1; fi
echo "✅ restore-test: all tests passed"

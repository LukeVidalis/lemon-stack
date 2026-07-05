#!/usr/bin/env bash
# backup-engine-test.sh — sandboxed tests for backup.sh using a restic stub.
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ENGINE_TEMPLATE="$HERE/../backup.sh.template"
FAILURES=0

t_pass() { echo "  ok: $1"; }
t_fail() { echo "  FAIL: $1" >&2; FAILURES=$((FAILURES + 1)); }

setup_sandbox() {
  SB="$(mktemp -d)"
  mkdir -p "$SB/home/backup.d" "$SB/home/.config/lemon" "$SB/bin"
  # Engine under test (templates carry no {{VARS}} — assert, then copy).
  if grep -q '{{[A-Z_]*}}' "$ENGINE_TEMPLATE"; then
    echo "FATAL: engine template contains {{VARS}} — must be runtime-\$HOME only" >&2
    exit 1
  fi
  install -m 755 "$ENGINE_TEMPLATE" "$SB/backup.sh"
  # restic stub: records argv, honours RESTIC_STUB_BACKUP_RC for 'backup'.
  cat > "$SB/bin/restic" <<'STUB'
#!/usr/bin/env bash
echo "restic $*" >> "$RESTIC_CALLS"
if [[ "$1" == "backup" ]]; then exit "${RESTIC_STUB_BACKUP_RC:-0}"; fi
exit 0
STUB
  chmod +x "$SB/bin/restic"
  printf 'export RESTIC_REPOSITORY=/dev/null\nexport RESTIC_PASSWORD=x\n' \
    > "$SB/home/.restic-env"
  echo "$SB/home/.config" > "$SB/home/.config/lemon/backup-paths.txt"
  : > "$SB/home/.config/lemon/backup-excludes.txt"
  export RESTIC_CALLS="$SB/restic-calls.log"
  : > "$RESTIC_CALLS"
}

run_engine() {
  PATH="$SB/bin:$PATH" \
  RESTIC_ENV="$SB/home/.restic-env" \
  HOOKS_DIR="$SB/home/backup.d" \
  CONF_DIR="$SB/home/.config/lemon" \
  "$SB/backup.sh" "$@" > "$SB/out.log" 2>&1
}

echo "test: happy path — markers, hook ran, restic backup+forget called"
setup_sandbox
cat > "$SB/home/backup.d/10-ok.sh" <<'HOOK'
#!/usr/bin/env bash
echo "dummy" > "$DUMP_DIR/ok.dump"
HOOK
chmod +x "$SB/home/backup.d/10-ok.sh"
if run_engine; then t_pass "exit 0"; else t_fail "exit $? (want 0)"; fi
grep -q '^\[....-..-.. ..:..:..\] === Backup started ===' "$SB/out.log" \
  && t_pass "started marker" || t_fail "started marker missing/misformatted"
grep -q '=== Backup complete ===' "$SB/out.log" \
  && t_pass "complete marker" || t_fail "complete marker missing"
grep -q '^restic backup ' "$RESTIC_CALLS" \
  && t_pass "restic backup called" || t_fail "restic backup not called"
grep -q '^restic forget ' "$RESTIC_CALLS" \
  && t_pass "restic forget called" || t_fail "restic forget not called"
rm -rf "$SB"

echo "test: failing hook warns but run continues"
setup_sandbox
printf '#!/usr/bin/env bash\nexit 1\n' > "$SB/home/backup.d/10-bad.sh"
chmod +x "$SB/home/backup.d/10-bad.sh"
if run_engine; then t_pass "exit 0 despite hook failure"; else t_fail "aborted on hook failure"; fi
grep -q 'WARNING: hook 10-bad.sh failed (continuing)' "$SB/out.log" \
  && t_pass "warning logged" || t_fail "warning not logged"
grep -q '=== Backup complete ===' "$SB/out.log" \
  && t_pass "run completed" || t_fail "run did not complete"
rm -rf "$SB"

echo "test: non-executable hook is skipped silently"
setup_sandbox
printf '#!/usr/bin/env bash\nexit 1\n' > "$SB/home/backup.d/10-noexec.sh"
if run_engine; then t_pass "exit 0"; else t_fail "exit $?"; fi
grep -q '10-noexec' "$SB/out.log" && t_fail "non-executable hook mentioned" \
  || t_pass "non-executable hook ignored"
rm -rf "$SB"

echo "test: restic exit 3 tolerated"
setup_sandbox
if RESTIC_STUB_BACKUP_RC=3 run_engine; then t_pass "exit 0 on restic rc=3"; \
  else t_fail "restic rc=3 was fatal"; fi
grep -q 'unreadable' "$SB/out.log" && t_pass "rc=3 noted" || t_fail "rc=3 not noted"
rm -rf "$SB"

echo "test: restic exit 1 is fatal"
setup_sandbox
if RESTIC_STUB_BACKUP_RC=1 run_engine; then t_fail "restic rc=1 not fatal"; \
  else t_pass "restic rc=1 fatal"; fi
rm -rf "$SB"

echo "test: missing .restic-env is fatal with pointer"
setup_sandbox
rm "$SB/home/.restic-env"
if run_engine; then t_fail "missing env not fatal"; else t_pass "missing env fatal"; fi
grep -q 'install-backup.sh' "$SB/out.log" \
  && t_pass "actionable message" || t_fail "no pointer to installer"
rm -rf "$SB"

echo "test: --verify runs restic check only"
setup_sandbox
run_engine --verify || t_fail "--verify exited nonzero"
grep -q '^restic check --read-data-subset=2%' "$RESTIC_CALLS" \
  && t_pass "restic check called" || t_fail "restic check not called"
grep -q '^restic backup' "$RESTIC_CALLS" && t_fail "--verify ran a backup" \
  || t_pass "no backup during --verify"
rm -rf "$SB"

if [[ $FAILURES -gt 0 ]]; then echo "❌ $FAILURES failure(s)"; exit 1; fi
echo "✅ backup-engine-test: all tests passed"

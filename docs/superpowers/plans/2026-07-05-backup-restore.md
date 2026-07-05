# Backup & Restore Component Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship restic-based backups + guided restore as an optional lemon-stack setup component, extracted live-first from the reference host's proven script.

**Architecture:** A generic `backup.sh` engine runs pluggable dump hooks from `~/backup.d/` into a temp `$DUMP_DIR`, then restic-backs-up a configured path list. A guided `restore.sh` restores files/DBs to staging by default. `setup/install-backup.sh` wires it as the `backup` component. Built in-repo with stub-based tests, then installed and validated on the reference host before pushing.

**Tech Stack:** bash (`set -euo pipefail`), restic, docker exec (postgres-shared), cron, tg-notify (optional).

**Spec:** `docs/superpowers/specs/2026-07-05-backup-restore-design.md`

## Global Constraints

- **Public repo.** Every commit must pass `bash scripts/check-templates.sh` (the pre-commit hook runs it). Never write personal identifiers (real domain, org, username, home path, ticket prefix) into any file. Use `$HOME` at runtime, never a literal home path.
- **Push only in Task 8**, after live validation. Commit locally per task.
- **Log format contract** (consumed by `cli/lemon/lemon_cli/commands/backup_status.py` and the n8n digest): every line `[YYYY-MM-DD HH:MM:SS] message`; run boundaries exactly `=== Backup started ===` and `=== Backup complete ===`.
- **`~/.restic-env` contract** (consumed by `backup_status.py::_restic_latest`): `export RESTIC_REPOSITORY=`, `export RESTIC_PASSWORD=`, optional `export AWS_ACCESS_KEY_ID=` / `export AWS_SECRET_ACCESS_KEY=`. Mode 600.
- **Retention defaults:** `--keep-daily 7 --keep-weekly 4 --keep-monthly 6`, overridable via `KEEP_DAILY`/`KEEP_WEEKLY`/`KEEP_MONTHLY` in `.restic-env`.
- **Shell quality:** `bash -n` clean and `shellcheck --severity=error` clean (CI enforces both on all `*.sh`).
- **Repo file convention:** scripts ship as `infra/backup/*.sh.template` (rendered by `setup/render-templates.sh`, which drops the suffix). These scripts intentionally contain no `{{VAR}}` placeholders — they resolve everything from `$HOME` at runtime — but keep the `.template` suffix so `promote.sh`'s default mapping works.
- **Hook contract:** executable bash script; reads exported `DUMP_DIR`; writes dump files into it; exits 0 when its service isn't running (soft skip); nonzero exit is logged as `WARNING: hook <name> failed (continuing)` by the engine and never aborts the run.

---

### Task 1: Backup engine + test harness + CI wiring

**Files:**
- Create: `infra/backup/backup.sh.template`
- Create: `infra/backup/tests/backup-engine-test.sh`
- Modify: `.github/workflows/ci.yml` (add test step after Shellcheck)
- Modify: `docs/superpowers/specs/2026-07-05-backup-restore-design.md` (hook location amendment)

**Interfaces:**
- Consumes: nothing (first task).
- Produces: `backup.sh` honouring env overrides `RESTIC_ENV` (default `$HOME/.restic-env`), `HOOKS_DIR` (default `$HOME/backup.d`), `CONF_DIR` (default `$HOME/.config/lemon`); flag `--verify`. Tests rely on these overrides to sandbox. Later tasks rely on the hook contract above.

- [ ] **Step 1: Amend the spec's hook location**

In `docs/superpowers/specs/2026-07-05-backup-restore-design.md`, replace the three lines placing hooks in `infra/<component>/backup-hook.sh` with hooks living in `infra/backup/hooks/NN-<name>.sh` (installed per enabled component by `install-backup.sh`), and note the reason: one promote-mapping branch (`~/backup.d/* → infra/backup/hooks/*`) instead of a per-component lookup table. Update the file-tree comment lines `# portable — ships with infra/...` accordingly.

- [ ] **Step 2: Write the failing test**

Create `infra/backup/tests/backup-engine-test.sh`:

```bash
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
  if grep -q '{{' "$ENGINE_TEMPLATE"; then
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
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `bash infra/backup/tests/backup-engine-test.sh`
Expected: FAIL — `install: cannot stat .../backup.sh.template` (engine doesn't exist yet).

- [ ] **Step 4: Write the engine**

Create `infra/backup/backup.sh.template`:

```bash
#!/usr/bin/env bash
# lemon-stack backup engine — restic + pluggable dump hooks.
#
# Flow: run every executable ~/backup.d/*.sh (each writes dumps into
# $DUMP_DIR), then restic-backup the configured path list + $DUMP_DIR,
# then apply retention. Log format is parsed by `lemon backup-status`
# and the n8n backup digest — keep the === markers and [ts] prefix.
#
# Usage: backup.sh            daily backup run
#        backup.sh --verify   restic check --read-data-subset (monthly cron)
#
# Config:
#   ~/.restic-env                       repo + credentials (mode 600)
#   ~/.config/lemon/backup-paths.txt    one path per line
#   ~/.config/lemon/backup-excludes.txt one exclude pattern per line
#   ~/backup.d/*.sh                     dump hooks (see docs/backup-restore.md)
set -euo pipefail

RESTIC_ENV="${RESTIC_ENV:-$HOME/.restic-env}"
HOOKS_DIR="${HOOKS_DIR:-$HOME/backup.d}"
CONF_DIR="${CONF_DIR:-$HOME/.config/lemon}"
PATHS_FILE="$CONF_DIR/backup-paths.txt"
EXCLUDES_FILE="$CONF_DIR/backup-excludes.txt"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"; }

tg_notify() {
    local level="$1" title="$2" message="$3" channel="${4:-backups}"
    local secret_file="$HOME/docker/tg-notify/secrets.env"
    [[ ! -r "$secret_file" ]] && return 0
    local secret
    secret=$(grep '^API_SECRET=' "$secret_file" | cut -d= -f2-)
    [[ -z "$secret" ]] && return 0
    curl -sf -X POST http://127.0.0.1:10020/send \
        -H "Authorization: Bearer $secret" \
        -H "Content-Type: application/json" \
        -d "{\"level\":\"$level\",\"title\":\"$title\",\"message\":\"$message\",\"channel\":\"$channel\"}" \
        > /dev/null 2>&1 || true
}

if [[ ! -f "$RESTIC_ENV" ]]; then
    log "FATAL: $RESTIC_ENV not found — run setup/install-backup.sh first."
    exit 1
fi
# shellcheck disable=SC1090
source "$RESTIC_ENV"

if [[ "${1:-}" == "--verify" ]]; then
    log "=== Verify started ==="
    restic check --read-data-subset="${VERIFY_SUBSET:-2%}"
    log "=== Verify complete ==="
    exit 0
fi

if [[ ! -f "$PATHS_FILE" ]]; then
    log "FATAL: $PATHS_FILE not found — run setup/install-backup.sh first."
    exit 1
fi

trap 'tg_notify "error" "Backup failed" "Check ~/backup.log on $(hostname)."' ERR
DUMP_DIR=$(mktemp -d /tmp/restic-dump-XXXXXX)
trap 'rm -rf "$DUMP_DIR"' EXIT
export DUMP_DIR

log "=== Backup started ==="

# ── Dump hooks ───────────────────────────────────────────────────────────────
if [[ -d "$HOOKS_DIR" ]]; then
    for hook in "$HOOKS_DIR"/*.sh; do
        [[ -x "$hook" ]] || continue
        name=$(basename "$hook")
        log "hook: $name"
        if ! "$hook"; then
            log "WARNING: hook $name failed (continuing)"
        fi
    done
fi

# ── Restic backup ────────────────────────────────────────────────────────────
log "Running restic backup..."
EXCLUDE_ARGS=()
[[ -f "$EXCLUDES_FILE" ]] && EXCLUDE_ARGS=(--exclude-file "$EXCLUDES_FILE")
# Exit code 3 = some files unreadable — snapshot still saved, treat as OK.
restic backup --files-from "$PATHS_FILE" "${EXCLUDE_ARGS[@]}" "$DUMP_DIR" || {
    rc=$?
    if [[ $rc -eq 3 ]]; then
        log "restic: some files unreadable (exit 3), snapshot saved"
    else
        exit $rc
    fi
}

# ── Retention ────────────────────────────────────────────────────────────────
log "Pruning old snapshots..."
restic forget \
    --keep-daily "${KEEP_DAILY:-7}" \
    --keep-weekly "${KEEP_WEEKLY:-4}" \
    --keep-monthly "${KEEP_MONTHLY:-6}" \
    --prune

log "=== Backup complete ==="
tg_notify "success" "Backup complete" "Daily restic snapshot succeeded."
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `bash infra/backup/tests/backup-engine-test.sh`
Expected: `✅ backup-engine-test: all tests passed`

- [ ] **Step 6: Lint**

Run: `bash -n infra/backup/backup.sh.template && shellcheck --severity=error infra/backup/backup.sh.template infra/backup/tests/backup-engine-test.sh`
Expected: no output, exit 0.

- [ ] **Step 7: Wire tests into CI**

In `.github/workflows/ci.yml`, after the `Shellcheck (errors only)` step, add:

```yaml
      - name: Backup component tests
        run: |
          fail=0
          for t in infra/backup/tests/*-test.sh; do
            bash "$t" || fail=1
          done
          exit $fail
```

- [ ] **Step 8: Commit**

```bash
cd ~/lemon-stack
git add infra/backup/ .github/workflows/ci.yml docs/superpowers/specs/2026-07-05-backup-restore-design.md
git commit -m "feat(backup): restic backup engine with pluggable dump hooks"
```

(The pre-commit hook runs the leak guard; it must pass.)

---

### Task 2: Portable dump hooks

**Files:**
- Create: `infra/backup/hooks/50-postgres-shared.sh.template`
- Create: `infra/backup/hooks/55-n8n-sqlite.sh.template`
- Create: `infra/backup/hooks/60-openbao-snapshot.sh.template`
- Create: `infra/backup/tests/hooks-test.sh`

**Interfaces:**
- Consumes: hook contract from Task 1 (exported `DUMP_DIR`; exit 0 on service-not-running).
- Produces: dump filenames relied on by `restore.sh` (Task 3) and the DR runbook (Task 5): `pg-shared-globals.sql`, `pg-shared-<db>.dump`, `n8n.sqlite`.

- [ ] **Step 1: Write the failing test**

Create `infra/backup/tests/hooks-test.sh`:

```bash
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
if grep -q '{{' "$HOOKS_SRC/50-postgres-shared.sh.template"; then
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bash infra/backup/tests/hooks-test.sh`
Expected: FAIL — `FATAL`/missing file (hooks don't exist yet).

- [ ] **Step 3: Write the three hooks**

Create `infra/backup/hooks/50-postgres-shared.sh.template`:

```bash
#!/usr/bin/env bash
# backup.d hook: dump postgres-shared — roles/globals + every non-template DB.
# Auto-includes newly provisioned DBs. Soft-skips if the container is down.
# Contract: reads $DUMP_DIR, writes pg-shared-globals.sql + pg-shared-<db>.dump.
set -euo pipefail
: "${DUMP_DIR:?DUMP_DIR not set — run via backup.sh}"

if ! docker ps --filter name=postgres-shared --format '{{.Names}}' | grep -q '^postgres-shared$'; then
    echo "postgres-shared: container not running, skipping"
    exit 0
fi

docker exec postgres-shared pg_dumpall -U postgres --globals-only \
    > "$DUMP_DIR/pg-shared-globals.sql"

docker exec postgres-shared psql -U postgres -tAc \
    "SELECT datname FROM pg_database WHERE datistemplate=false AND datname<>'postgres'" \
| while read -r db; do
    [[ -z "$db" ]] && continue
    docker exec postgres-shared pg_dump -U postgres -Fc "$db" \
        > "$DUMP_DIR/pg-shared-$db.dump"
    echo "pg-shared $db: OK"
done
```

Create `infra/backup/hooks/55-n8n-sqlite.sh.template`:

```bash
#!/usr/bin/env bash
# backup.d hook: copy n8n's live SQLite DB out of its named volume via a
# throwaway Alpine container. Soft-skips if n8n is down.
# Contract: reads $DUMP_DIR, writes n8n.sqlite.
set -euo pipefail
: "${DUMP_DIR:?DUMP_DIR not set — run via backup.sh}"

if ! docker ps --filter name=n8n --format '{{.Names}}' | grep -q '^n8n$'; then
    echo "n8n: container not running, skipping"
    exit 0
fi

docker run --rm \
    --volumes-from n8n \
    -v "$DUMP_DIR:/dump" \
    alpine cp /home/node/.n8n/database.sqlite /dump/n8n.sqlite
echo "n8n: OK"
```

Create `infra/backup/hooks/60-openbao-snapshot.sh.template`:

```bash
#!/usr/bin/env bash
# backup.d hook: take a fresh OpenBao Raft snapshot so the latest secrets
# state lands in tonight's restic snapshot. Delegates to the component's
# snapshot.sh (which handles sealed state itself). Soft-skips if Bao is down.
# The snapshot file is written under ~/docker/openbao/ and picked up by the
# restic path list — nothing is written to $DUMP_DIR directly.
set -euo pipefail

if ! docker ps --filter name=openbao --format '{{.Names}}' | grep -q '^openbao$'; then
    echo "openbao: container not running, skipping"
    exit 0
fi

"$HOME/docker/openbao/snapshot.sh"
echo "openbao snapshot: OK"
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bash infra/backup/tests/hooks-test.sh`
Expected: `✅ hooks-test: all tests passed`

Note: the openbao "running" path isn't stub-tested (it execs a host script); its down-path soft-skip is. It gets exercised for real in Task 6.

- [ ] **Step 5: Lint**

Run: `bash -n infra/backup/hooks/*.template && shellcheck --severity=error infra/backup/hooks/*.template infra/backup/tests/hooks-test.sh`
Expected: exit 0. (Note: `--format '{{.Names}}'` is Go-template syntax inside single quotes — the leak guard and render-templates ignore non-`[A-Z_]` braces, matching the existing live script.)

- [ ] **Step 6: Commit**

```bash
git add infra/backup/hooks/ infra/backup/tests/hooks-test.sh
git commit -m "feat(backup): postgres-shared, n8n, openbao dump hooks"
```

---

### Task 3: Guided restore script

**Files:**
- Create: `infra/backup/restore.sh.template`
- Create: `infra/backup/tests/restore-test.sh`

**Interfaces:**
- Consumes: `.restic-env` contract; dump filenames from Task 2 (`pg-shared-<db>.dump`).
- Produces: `restore.sh list | files | db | openbao` CLI used verbatim in the DR runbook (Task 5) and the live drill (Task 7). Env overrides for tests: `RESTIC_ENV`, `STAGING_ROOT`, `PG_CONTAINER`.

- [ ] **Step 1: Write the failing test**

Create `infra/backup/tests/restore-test.sh`:

```bash
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
  if grep -q '{{' "$RESTORE_TEMPLATE"; then
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
run_restore; [[ $? -eq 2 ]] && t_pass "exit 2" || t_fail "wrong exit"
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
[[ $? -ne 0 ]] && t_pass "aborted" || t_fail "did not abort"
grep -q -- '--clean' "$DOCKER_CALLS" && t_fail "pg_restore ran anyway" || t_pass "no restore ran"
rm -rf "$SB"

if [[ $FAILURES -gt 0 ]]; then echo "❌ $FAILURES failure(s)"; exit 1; fi
echo "✅ restore-test: all tests passed"
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bash infra/backup/tests/restore-test.sh`
Expected: FAIL — restore template missing.

- [ ] **Step 3: Write restore.sh**

Create `infra/backup/restore.sh.template`:

```bash
#!/usr/bin/env bash
# lemon-stack guided restore — companion to backup.sh.
# Restores to a fresh staging directory by default; anything destructive
# requires a typed confirmation. Full DR runbook: docs/backup-restore.md.
set -euo pipefail

RESTIC_ENV="${RESTIC_ENV:-$HOME/.restic-env}"
STAGING_ROOT="${STAGING_ROOT:-$HOME/restore-staging}"
PG_CONTAINER="${PG_CONTAINER:-postgres-shared}"

usage() {
    cat <<'EOF'
Usage:
  restore.sh list                                    show restic snapshots
  restore.sh files <snapshot|latest> <path> [--target DIR]
                                                     restore a file/dir to staging
  restore.sh db <name> [--snapshot ID] [--in-place]  restore a postgres-shared DB
                                                     (default: scratch <name>_restoretest)
  restore.sh openbao [--snapshot ID]                 stage Raft snapshot + print steps
EOF
}

confirm() {
    local answer
    read -r -p "$1 Type 'yes' to continue: " answer
    [[ "$answer" == "yes" ]]
}

stage_dir() {
    local d="$STAGING_ROOT/$(date +%Y%m%d-%H%M%S)"
    mkdir -p "$d"
    echo "$d"
}

if [[ ! -f "$RESTIC_ENV" ]]; then
    echo "FATAL: $RESTIC_ENV not found — is the backup component installed?" >&2
    exit 1
fi
# shellcheck disable=SC1090
source "$RESTIC_ENV"

cmd="${1:-}"
[[ -n "$cmd" ]] && shift || true

case "$cmd" in
list)
    restic snapshots
    ;;

files)
    snap="${1:?usage: restore.sh files <snapshot|latest> <path>}"
    path="${2:?usage: restore.sh files <snapshot|latest> <path>}"
    shift 2
    target=""
    while [[ $# -gt 0 ]]; do
        case "$1" in
            --target) target="$2"; shift 2 ;;
            *) echo "unknown flag: $1" >&2; exit 2 ;;
        esac
    done
    [[ -n "$target" ]] || target=$(stage_dir)
    restic restore "$snap" --target "$target" --include "$path"
    echo "restored under: $target"
    ;;

db)
    name="${1:?usage: restore.sh db <name>}"
    shift
    snap="latest" in_place=0
    while [[ $# -gt 0 ]]; do
        case "$1" in
            --snapshot) snap="$2"; shift 2 ;;
            --in-place) in_place=1; shift ;;
            *) echo "unknown flag: $1" >&2; exit 2 ;;
        esac
    done
    staging=$(stage_dir)
    restic restore "$snap" --target "$staging" --include "*/pg-shared-$name.dump"
    dump=$(find "$staging" -name "pg-shared-$name.dump" | head -1)
    if [[ -z "$dump" ]]; then
        echo "no dump for '$name' found in snapshot $snap" >&2
        exit 1
    fi
    if [[ $in_place -eq 1 ]]; then
        confirm "This OVERWRITES the live database '$name'." || { echo "aborted."; exit 1; }
        docker exec -i "$PG_CONTAINER" pg_restore -U postgres --clean --if-exists -d "$name" < "$dump"
        echo "restored '$name' in place from snapshot $snap."
    else
        scratch="${name}_restoretest"
        docker exec "$PG_CONTAINER" psql -U postgres -c "DROP DATABASE IF EXISTS \"$scratch\""
        docker exec "$PG_CONTAINER" psql -U postgres -c "CREATE DATABASE \"$scratch\""
        docker exec -i "$PG_CONTAINER" pg_restore -U postgres --no-owner -d "$scratch" < "$dump"
        echo "restored into scratch database '$scratch' — inspect it, then drop with:"
        echo "  docker exec $PG_CONTAINER psql -U postgres -c 'DROP DATABASE \"$scratch\"'"
    fi
    ;;

openbao)
    snap="latest"
    while [[ $# -gt 0 ]]; do
        case "$1" in
            --snapshot) snap="$2"; shift 2 ;;
            *) echo "unknown flag: $1" >&2; exit 2 ;;
        esac
    done
    staging=$(stage_dir)
    restic restore "$snap" --target "$staging" --include "*openbao*"
    raft=$(find "$staging" -name '*.snap' | sort | tail -1)
    if [[ -z "$raft" ]]; then
        echo "no OpenBao raft snapshot (*.snap) found in snapshot $snap" >&2
        exit 1
    fi
    cat <<EOF
Raft snapshot staged at: $raft

OpenBao restore is intentionally manual (it needs your unseal keys):
  1. Ensure OpenBao is running and UNSEALED (docker/openbao/unseal.sh).
  2. bao operator raft snapshot restore -force "$raft"
     (inside the container: docker exec -i openbao bao operator raft snapshot restore -force /path)
  3. Unseal again and verify: bao kv list secret/apps/
See docs/backup-restore.md for the full procedure.
EOF
    ;;

*)
    usage
    exit 2
    ;;
esac
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bash infra/backup/tests/restore-test.sh`
Expected: `✅ restore-test: all tests passed`

- [ ] **Step 5: Lint**

Run: `bash -n infra/backup/restore.sh.template && shellcheck --severity=error infra/backup/restore.sh.template infra/backup/tests/restore-test.sh`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add infra/backup/restore.sh.template infra/backup/tests/restore-test.sh
git commit -m "feat(backup): guided restore.sh (files/db/openbao, staging-first)"
```

---

### Task 4: Setup integration

**Files:**
- Create: `setup/install-backup.sh`
- Modify: `setup.sh` (call installer when `backup` in COMPONENTS)
- Modify: `setup/parameters.example.env` (document the component)
- Modify: `scripts/verify-install.sh` (cron + `.restic-env` checks in the existing backup block, ~line 159)
- Modify: `scripts/promote.sh` (three mapping branches in `resolve_target`)

**Interfaces:**
- Consumes: rendered `infra/backup/backup.sh`, `infra/backup/restore.sh`, `infra/backup/hooks/*.sh` (render-templates drops `.template`).
- Produces: installed layout relied on by Task 6: `~/backup.sh`, `~/restore.sh`, `~/backup.d/*.sh`, `~/.config/lemon/backup-paths.txt`, `~/.config/lemon/backup-excludes.txt`, `~/.restic-env`, cron entries `0 3 * * *` (backup) and `30 4 1 * *` (verify).

- [ ] **Step 1: Write install-backup.sh**

Create `setup/install-backup.sh`:

```bash
#!/usr/bin/env bash
# install-backup.sh — install the restic backup component.
# Idempotent: keeps an existing ~/.restic-env and config; re-copies scripts
# and hooks (they are stack-managed); re-writes the two cron entries.

set -euo pipefail

cd "$(dirname "$0")/.."
PARAMS=setup/parameters.env
[[ -f $PARAMS ]] || { echo "missing $PARAMS"; exit 1; }
# shellcheck disable=SC1090
set -a; source <(grep -E '^[A-Z_][A-Z0-9_]*=' "$PARAMS"); set +a

# Templates must be rendered first (setup.sh does this; be safe standalone).
[[ -f infra/backup/backup.sh ]] || bash setup/render-templates.sh

# ── restic ────────────────────────────────────────────────────────────────────
if ! command -v restic >/dev/null 2>&1; then
    echo "restic not found — installing via apt (needs sudo)..."
    sudo apt-get update -qq && sudo apt-get install -y -qq restic
fi

# ── ~/.restic-env ─────────────────────────────────────────────────────────────
RESTIC_ENV="$HOME/.restic-env"
if [[ -f "$RESTIC_ENV" ]]; then
    echo "$RESTIC_ENV already exists — keeping it."
else
    echo "Configuring the restic repository."
    echo "Examples:  s3:https://<accountid>.r2.cloudflarestorage.com/<bucket>"
    echo "           sftp:user@host:/srv/restic     /mnt/usb/restic (local)"
    read -r -p "RESTIC_REPOSITORY: " repo
    read -r -s -p "RESTIC_PASSWORD (encrypts the repo — store it somewhere safe!): " pw; echo
    read -r -p "AWS_ACCESS_KEY_ID (blank unless S3/R2): " ak
    sk=""
    if [[ -n "$ak" ]]; then
        read -r -s -p "AWS_SECRET_ACCESS_KEY: " sk; echo
    fi
    umask 177
    {
        echo "export RESTIC_REPOSITORY=$repo"
        echo "export RESTIC_PASSWORD=$pw"
        [[ -n "$ak" ]] && echo "export AWS_ACCESS_KEY_ID=$ak"
        [[ -n "$sk" ]] && echo "export AWS_SECRET_ACCESS_KEY=$sk"
    } > "$RESTIC_ENV"
    umask 022
    echo "wrote $RESTIC_ENV (mode 600)"
fi
# shellcheck disable=SC1090
source "$RESTIC_ENV"

# Initialise the repository if it's empty/new.
if ! restic cat config >/dev/null 2>&1; then
    echo "initialising restic repository..."
    restic init
fi

# ── scripts + hooks ───────────────────────────────────────────────────────────
install -m 755 infra/backup/backup.sh "$HOME/backup.sh"
install -m 755 infra/backup/restore.sh "$HOME/restore.sh"
mkdir -p "$HOME/backup.d"

install -m 755 infra/backup/hooks/50-postgres-shared.sh "$HOME/backup.d/50-postgres-shared.sh"
if [[ ",${COMPONENTS:-}," == *,n8n,* ]]; then
    install -m 755 infra/backup/hooks/55-n8n-sqlite.sh "$HOME/backup.d/55-n8n-sqlite.sh"
fi
if [[ ",${COMPONENTS:-}," == *,openbao,* ]]; then
    install -m 755 infra/backup/hooks/60-openbao-snapshot.sh "$HOME/backup.d/60-openbao-snapshot.sh"
fi

# ── path config (created once; user-editable afterwards) ─────────────────────
CONF_DIR="$HOME/.config/lemon"
mkdir -p "$CONF_DIR"
if [[ ! -f "$CONF_DIR/backup-paths.txt" ]]; then
    {
        echo "$HOME/docker"
        echo "$HOME/deploy"
        echo "$HOME/backup.sh"
        [[ -f /etc/caddy/Caddyfile ]] && echo "/etc/caddy/Caddyfile"
    } > "$CONF_DIR/backup-paths.txt"
    echo "wrote default $CONF_DIR/backup-paths.txt — edit to taste"
fi
if [[ ! -f "$CONF_DIR/backup-excludes.txt" ]]; then
    cat > "$CONF_DIR/backup-excludes.txt" <<EOF
$HOME/docker/authentik/postgres
$HOME/docker/authentik/redis
$HOME/docker/openbao/data
*.tmp
*.log
EOF
    echo "wrote default $CONF_DIR/backup-excludes.txt — edit to taste"
fi

# ── cron: daily backup 03:00, monthly verify 04:30 on the 1st ────────────────
( crontab -l 2>/dev/null | grep -v "$HOME/backup.sh" ;
  echo "0 3 * * * $HOME/backup.sh >> $HOME/backup.log 2>&1" ;
  echo "30 4 1 * * $HOME/backup.sh --verify >> $HOME/backup.log 2>&1" ) | crontab -
echo "cron installed: daily 03:00 backup, monthly verify"

# ── offer a first run ─────────────────────────────────────────────────────────
read -r -p "Run a first backup now? [y/N] " ans
if [[ "$ans" == [yY]* ]]; then
    "$HOME/backup.sh" >> "$HOME/backup.log" 2>&1 &&
        echo "first backup OK — check with: lemon backup-status" ||
        echo "first backup FAILED — tail ~/backup.log"
fi

echo "install-backup: done"
```

- [ ] **Step 2: Lint the installer**

Run: `bash -n setup/install-backup.sh && shellcheck --severity=error setup/install-backup.sh`
Expected: exit 0.

- [ ] **Step 3: Wire into setup.sh**

In `setup.sh`, directly after the `bash setup/install-bin.sh` line, add:

```bash
if [[ ",${COMPONENTS:-}," == *,backup,* ]]; then
  bash setup/install-backup.sh
fi
```

(Match how `COMPONENTS` is already sourced in that file; it is loaded from `setup/parameters.env` near the top.)

- [ ] **Step 4: Document the component in parameters.example.env**

In `setup/parameters.example.env`, extend the `COMPONENTS` comment block (line ~38) to mention `backup`, e.g. change the example value to `COMPONENTS=openbao,monitoring,backup` and add a comment line:

```
# backup — restic backups (any backend: S3/R2, sftp, local path) + guided restore.
#          Prompts for repository + password on install; see docs/backup-restore.md.
```

- [ ] **Step 5: Extend verify-install.sh backup checks**

In `scripts/verify-install.sh`, the existing block (~line 159) checks `backup.log` age. Immediately before that check, inside the same section, add:

```bash
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
```

(Use the file's existing `pass`/`fail` helpers — check their exact names at the top of the file and match them.)

- [ ] **Step 6: Add promote.sh mappings**

In `scripts/promote.sh` `resolve_target()`, after the `$HOME/bin/` branch, add:

```bash
  elif [[ $p == "$HOME/backup.sh" ]]; then
    target="infra/backup/backup.sh"
  elif [[ $p == "$HOME/restore.sh" ]]; then
    target="infra/backup/restore.sh"
  elif [[ $p == "$HOME/backup.d/"* ]]; then
    rel="${p#$HOME/backup.d/}"
    target="infra/backup/hooks/$rel"
```

(These fall through to the default `needs_template=1`, so promoted files get the `.template` suffix and the identifier scrub — matching how the repo stores them.)
Also update the mapping table in the header comment of `promote.sh` (lines ~15-20) with the three new paths.

- [ ] **Step 7: Run repo checks**

Run:
```bash
bash scripts/check-templates.sh
bash scripts/verify-template-coverage.sh
bash -n setup.sh scripts/verify-install.sh scripts/promote.sh
for t in infra/backup/tests/*-test.sh; do bash "$t"; done
```
Expected: all pass.

- [ ] **Step 8: Commit**

```bash
git add setup/install-backup.sh setup.sh setup/parameters.example.env scripts/verify-install.sh scripts/promote.sh
git commit -m "feat(backup): setup component, verify-install checks, promote mappings"
```

---

### Task 5: Documentation

**Files:**
- Create: `docs/backup-restore.md`
- Modify: `docs/architecture.md` (add `## Backup & restore` section — fixes the dead `#backup--restore` anchor referenced from `docs/upgrading.md:59`)
- Modify: `README.md` (component table row; rewrite Maintenance→Backups paragraph)
- Modify: `docs/troubleshooting.md` (two new entries)
- Modify: `CHANGELOG.md`

**Interfaces:**
- Consumes: everything shipped in Tasks 1–4 (exact paths, filenames, commands).
- Produces: nothing consumed by later tasks (Task 6/7 use the runbook as a script to follow).

- [ ] **Step 1: Write docs/backup-restore.md**

Sections (write fully, using the exact paths/commands from Tasks 1–4):

1. **Overview** — engine + hooks + restic diagram (ASCII), what's backed up by default, retention defaults and overrides.
2. **Installation** — `backup` in `COMPONENTS`, what `install-backup.sh` prompts for, R2/S3/sftp/local repository examples, where `.restic-env` lives and why mode 600.
3. **Daily operation** — cron schedule, `lemon backup-status`, the n8n `daily-backup-digest` starter workflow, `backup.sh --verify` monthly check.
4. **Writing a dump hook** — the hook contract (executable, `$DUMP_DIR`, exit 0 soft-skip, nonzero = warning), numbering convention (50s databases, 60s snapshots, 70+ host-only), a complete example hook for a hypothetical app SQLite DB, note that host-only hooks simply live in `~/backup.d/` and never get promoted upstream.
5. **Restore** — each `restore.sh` subcommand with a worked example (scratch-DB inspection flow; `--in-place` warning).
6. **Disaster recovery runbook** — ordered: fresh machine → clone repo → `setup.sh` (same COMPONENTS) → recreate `~/.restic-env` from your password manager → `restore.sh list` → restore `~/docker` config trees via `restore.sh files` → restore globals (`psql -f pg-shared-globals.sql`) then each DB (`restore.sh db <name> --in-place`) → `restore.sh openbao` + manual raft restore with unseal keys → redeploy apps by pushing to each repo (the pipeline rebuilds images; only data/config comes from backup).
7. **What is NOT backed up** — large media (PhotoPrism-class), OpenBao raw data dir (snapshot is used instead), anything in `backup-excludes.txt`; unseal keys/root tokens must be stored off-host by the operator.

- [ ] **Step 2: Add architecture.md section**

Add a `## Backup & restore` heading (anchor `#backup--restore`) with a ~15-line summary: engine/hooks/config layout, restic destination flexibility, retention, pointer to `docs/backup-restore.md`. Verify the anchor: `grep -n "backup--restore" docs/upgrading.md` → the link target must now exist.

- [ ] **Step 3: Update README.md**

- Component table: add row `| Backup (restic) | ⬜ | Daily restic backups (any backend), pluggable dump hooks, guided restore |`.
- Maintenance section: replace the "bring your own for now — … on the roadmap" backup bullet with a pointer: `**Backups:** add \`backup\` to COMPONENTS — daily restic snapshots of configs + DB dumps to any restic backend, with a guided restore script. See docs/backup-restore.md.`

- [ ] **Step 4: Update troubleshooting.md + CHANGELOG.md**

Troubleshooting entries: (a) "Backup failing / `lemon backup-status` DEGRADED" — tail `~/backup.log`, common causes (sealed OpenBao hook warning, expired object-storage credentials, repo lock from an interrupted run → `restic unlock`); (b) "Restore says no dump found for `<name>`" — DB was provisioned after the snapshot; check `restic ls <snap> | grep pg-shared`.
CHANGELOG: add an entry under a new date heading for the backup component.

- [ ] **Step 5: Check + commit**

Run: `bash scripts/check-templates.sh`
Expected: OK.

```bash
git add docs/backup-restore.md docs/architecture.md README.md docs/troubleshooting.md CHANGELOG.md
git commit -m "docs(backup): backup-restore guide, DR runbook, architecture section"
```

---

### Task 6: Live migration on the reference host

> Everything here runs on the live host. Keep the old script until the new one is proven. Comment progress on the tracking ticket (Plane, ticket 126) at each decision point.

**Files (live host, not committed):**
- Create: `~/backup.d/` (portable hooks from repo + host-only hooks)
- Create: `~/.config/lemon/backup-paths.txt`, `~/.config/lemon/backup-excludes.txt`
- Replace: `~/backup.sh` (old preserved as `~/backup.sh.pre-refactor`)
- Keep unchanged: `~/.restic-env`, crontab entry, `~/backup.log`

**Interfaces:**
- Consumes: installed layout from Task 4; existing live `~/.restic-env`.
- Produces: a proven live run whose log Task 7 and `lemon backup-status` read.

- [ ] **Step 1: Preserve the old script**

```bash
cp ~/backup.sh ~/backup.sh.pre-refactor
```

- [ ] **Step 2: Install engine + portable hooks from the repo working tree**

The templates carry no `{{VARS}}` (verify: `grep -c '{{[A-Z_]*}}' infra/backup/*.template infra/backup/hooks/*.template` → all 0), so install directly:

```bash
cd ~/lemon-stack
install -m 755 infra/backup/backup.sh.template ~/backup.sh
install -m 755 infra/backup/restore.sh.template ~/restore.sh
mkdir -p ~/backup.d
install -m 755 infra/backup/hooks/50-postgres-shared.sh.template ~/backup.d/50-postgres-shared.sh
install -m 755 infra/backup/hooks/55-n8n-sqlite.sh.template ~/backup.d/55-n8n-sqlite.sh
install -m 755 infra/backup/hooks/60-openbao-snapshot.sh.template ~/backup.d/60-openbao-snapshot.sh
```

- [ ] **Step 3: Write the path config from the old script's restic invocation**

`~/.config/lemon/backup-paths.txt` — one line per path that the pre-refactor script passed to `restic backup` (docker, deploy, scripts, backup.sh, server-cmd, the two log/report trees, the Caddyfile — copy them verbatim from `~/backup.sh.pre-refactor`). `~/.config/lemon/backup-excludes.txt` — one line per `--exclude` value from the same invocation. Do NOT include the old `$DUMP_DIR` — the engine adds its own.

- [ ] **Step 4: Port the host-only dumps as hooks**

Two host-only hooks, transplanting the corresponding blocks from `~/backup.sh.pre-refactor` verbatim, each prefixed with the hook preamble. Example — `~/backup.d/70-dashboard-sqlite.sh`:

```bash
#!/usr/bin/env bash
# host-only backup.d hook: dashboard SQLite (WAL-safe .backup via nouchka/sqlite3)
set -euo pipefail
: "${DUMP_DIR:?DUMP_DIR not set — run via backup.sh}"

if ! docker volume ls --format '{{.Name}}' | grep -q '^dashboard-data$'; then
    echo "dashboard-data volume not found, skipping"
    exit 0
fi
docker run --rm -v dashboard-data:/data nouchka/sqlite3 \
    sqlite3 /data/dashboard.db ".backup '/data/dashboard.bak.db'"
docker run --rm -v dashboard-data:/data -v "$DUMP_DIR:/dump" \
    alpine sh -c "cp /data/dashboard.bak.db /dump/dashboard.sqlite && rm /data/dashboard.bak.db"
echo "dashboard: OK"
```

`~/backup.d/71-dawarich-pg.sh` follows the same pattern around the pre-refactor script's dawarich `pg_dump` block (container check → soft-skip → dump to `$DUMP_DIR/dawarich.sql`). `chmod +x` both.

- [ ] **Step 5: Run a full live backup**

```bash
~/backup.sh >> ~/backup.log 2>&1; echo "exit: $?"
tail -40 ~/backup.log
```
Expected: exit 0; log shows every hook (`hook: 50-postgres-shared.sh` … `71-dawarich-pg.sh`), no `WARNING` lines except any that also occurred in previous nights' logs, and `=== Backup complete ===`.

- [ ] **Step 6: Verify snapshot parity with last night**

```bash
source ~/.restic-env
restic snapshots --latest 2
restic ls latest | grep -E 'restic-dump-.*/(pg-shared-|n8n|dashboard|dawarich)' | sort
```
Expected: the new snapshot contains the same dump-file set as last night's (same `pg-shared-*` DB list, `n8n.sqlite`, `dashboard.sqlite`, `dawarich.sql`) plus the same top-level paths. Also confirm `lemon backup-status` reports the new run with `overall: OK` (or the same pre-existing warnings as yesterday, no new ones).

- [ ] **Step 7: Confirm cron + digest need no changes**

`crontab -l | grep backup` → the existing `0 3 * * * ~/backup.sh >> ~/backup.log` entry still points at the right path (it does — same path, new content). Add the monthly verify entry to match the installer:

```bash
( crontab -l ; echo "30 4 1 * * $HOME/backup.sh --verify >> $HOME/backup.log 2>&1" ) | crontab -
```

- [ ] **Step 8: Comment on the tracking ticket**

`plane-cli comment 126 "Live migration done: engine + 5 hooks installed, manual run OK, snapshot parity verified vs previous night. Old script kept as backup.sh.pre-refactor until tomorrow's cron run."`

---

### Task 7: Live restore drill

**Files:** none (live-host verification only).

**Interfaces:**
- Consumes: `~/restore.sh` from Task 6, the snapshot produced in Task 6.
- Produces: evidence for the ticket + confidence to push.

- [ ] **Step 1: File restore to staging**

```bash
~/restore.sh files latest /etc/caddy/Caddyfile
# then, using the printed staging path:
diff <staging>/etc/caddy/Caddyfile /etc/caddy/Caddyfile && echo IDENTICAL
```
Expected: `IDENTICAL`.

- [ ] **Step 2: DB restore to scratch**

Pick a small real DB (e.g. `notify`):

```bash
~/restore.sh db notify
docker exec postgres-shared psql -U postgres -d notify_restoretest -c '\dt'
# compare table count with live:
docker exec postgres-shared psql -U postgres -d notify -tAc \
  "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'"
docker exec postgres-shared psql -U postgres -d notify_restoretest -tAc \
  "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'"
docker exec postgres-shared psql -U postgres -c 'DROP DATABASE "notify_restoretest"'
```
Expected: same table count in both; scratch DB dropped afterwards.

- [ ] **Step 3: List + openbao staging (no raft restore)**

```bash
~/restore.sh list | tail -5
~/restore.sh openbao
```
Expected: snapshots listed; a `.snap` file staged and the manual steps printed. Do NOT perform the raft restore.

- [ ] **Step 4: Comment results on the ticket**

`plane-cli comment 126 "Restore drill passed: Caddyfile byte-identical from staging restore; notify DB restored to scratch with matching table count; openbao raft snapshot staged correctly."`

---

### Task 8: Push, CI, close-out

**Files:**
- Modify (live host): `~/.claude/CLAUDE.md` (Critical Quirk 4 — mention hook layout), Obsidian `backups.md`, memory note.

- [ ] **Step 1: Final repo checks + push**

```bash
cd ~/lemon-stack
bash scripts/check-templates.sh
for t in infra/backup/tests/*-test.sh; do bash "$t"; done
git log --oneline origin/main..HEAD   # review the task commits
git push origin main
```

- [ ] **Step 2: Watch CI**

```bash
# run from inside ~/lemon-stack so gh infers the repo from the git remote
gh run watch $(gh run list --limit 1 --json databaseId --jq '.[0].databaseId')
```
Expected: `ci` green including the new `Backup component tests` step. If it fails, fix forward and re-push.

- [ ] **Step 3: Update host docs**

- `~/.claude/CLAUDE.md` Critical Quirk 4 (Restic backups): note the new layout — engine `~/backup.sh` + hooks `~/backup.d/` + config `~/.config/lemon/backup-{paths,excludes}.txt`, restore via `~/restore.sh`, old script retired after first successful cron run.
- Obsidian `backups.md`: update via `sudo docker cp` with the new layout, hook list, restore drill results, and the restore.sh usage.
- Memory note (`~/.claude/projects/-home-lemon/memory/`): new `project_backup_component.md` — hook layout, host-only hooks list, "delete backup.sh.pre-refactor after first clean 03:00 run".

- [ ] **Step 4: Close the ticket**

After confirming the next 03:00 cron run succeeded (`lemon backup-status` next session — note this in the ticket if closing before then):

```bash
plane-cli close-with-comment 126 "$(git remote get-url origin | sed 's/\.git$//')/commits/main" \
  "backup component shipped: engine + hooks + restore.sh + setup integration" \
  "live migration + restore drill passed" \
  "docs: backup-restore.md + DR runbook"
```

If closing the same day, instead leave it In Progress with a comment "awaiting tonight's cron run" and let the next daily session close it.

- [ ] **Step 5: Retire the old script (next session, after a clean cron run)**

```bash
rm ~/backup.sh.pre-refactor
```

---

## Self-review notes

- **Spec coverage:** engine (T1), hooks (T2), restore + DR runbook (T3/T5), setup component + verify-install + promote (T4), docs incl. dead-anchor fix + README (T5), live migration/testing (T6/T7), error-handling table behaviours are asserted by T1 tests (hook warn-continue, exit-3 tolerated, missing env fatal, notify degrade is `[[ -r ]]`-guarded). Spec's hook-location line amended in T1 Step 1.
- **Placeholders:** none — all code complete.
- **Type/name consistency:** `RESTIC_ENV`/`HOOKS_DIR`/`CONF_DIR`/`STAGING_ROOT`/`PG_CONTAINER` env names, dump filenames (`pg-shared-globals.sql`, `pg-shared-<db>.dump`, `n8n.sqlite`), and marker strings match across tasks and match `backup_status.py`.

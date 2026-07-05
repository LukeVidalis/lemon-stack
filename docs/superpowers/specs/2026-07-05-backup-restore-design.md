# Backup & Restore Component — Design

**Date:** 2026-07-05
**Status:** Approved
**Tracking:** maintainer's Plane board (ticket 126)

## Problem

lemon-stack ships the *consumers* of a backup system — `lemon backup-status`
parses `~/backup.log` and restic snapshots, the `daily-backup-digest` n8n
starter workflow reports on it, and four docs reference
`{{USER_HOME}}/backup.sh` — but not the backup system itself. The README says
"bring your own for now". `docs/upgrading.md` links to an
`architecture.md#backup--restore` section that does not exist.

## Goal

Ship backups + guided restore as an optional setup component (`backup` in
`COMPONENTS`), extracted live-first from the reference host's proven
restic-based script, with the app-specific parts split out so hosts can extend
it without forking the engine.

## Architecture

The current monolithic script mixes a generic engine with app-specific dump
logic and host-personal paths. The portable design separates them:

```
~/backup.sh                        # generic engine (portable)
~/restore.sh                       # guided restore (portable)
~/.restic-env                      # restic repo URL + credentials (mode 600)
~/.config/lemon/backup-paths.txt   # what restic backs up (one path per line)
~/.config/lemon/backup-excludes.txt
~/backup.d/                        # dump hooks, run in lexical order
  50-postgres-shared.sh            # portable — ships with infra/postgres-shared
  55-n8n-sqlite.sh                 # portable — ships with infra/n8n
  60-openbao-snapshot.sh           # portable — ships with infra/openbao
  7x-*.sh                          # host-only hooks, never promoted upstream
```

Repo homes: engine + restore + default config in `infra/backup/`; each hook in
its component's `infra/<component>/backup-hook.sh`; installer at
`setup/install-backup.sh`.

### 1. Backup engine (`backup.sh`)

Flow:

1. Source `~/.restic-env`. Missing file is fatal with a message pointing at
   `setup/install-backup.sh`.
2. `mktemp -d` a `$DUMP_DIR` (cleaned on exit).
3. Run every executable `~/backup.d/*.sh` in lexical order with `DUMP_DIR`
   exported. A failing hook logs a `WARNING` and never aborts the run.
4. `restic backup --files-from ~/.config/lemon/backup-paths.txt
   --exclude-file ~/.config/lemon/backup-excludes.txt "$DUMP_DIR"`.
   Restic exit code 3 (some files unreadable) is tolerated — snapshot saved.
5. `restic forget --keep-daily 7 --keep-weekly 4 --keep-monthly 6 --prune`.
   Retention overridable via `KEEP_DAILY`/`KEEP_WEEKLY`/`KEEP_MONTHLY` in
   `.restic-env`.
6. Notify via tg-notify on the `backups` channel (success and, via ERR trap,
   failure). Degrades silently when tg-notify is not installed.

`backup.sh --verify` instead runs `restic check --read-data-subset=2%`
(monthly cron).

**Compatibility constraint:** the log keeps the `=== Backup started ===` /
`=== Backup complete ===` markers and `[timestamp] message` shape so the
existing `lemon backup-status` parser and the n8n digest keep working
unchanged.

### 2. Dump hooks (`~/backup.d/`)

Contract: executable shell script; reads `$DUMP_DIR`; writes dump files there;
exits 0 when its service is not running (soft skip); nonzero exit is treated
as a warning by the engine.

Shipped hooks:

- **postgres-shared** — `pg_dumpall --globals-only` plus per-database
  `pg_dump -Fc` for every non-template DB (auto-includes newly provisioned
  DBs), written as `pg-shared-globals.sql` / `pg-shared-<db>.dump`.
- **n8n** — copies the live SQLite DB out of the named volume via a throwaway
  Alpine container.
- **openbao** — calls the component's existing `snapshot.sh` (Raft snapshot);
  soft-skips when Bao is down or sealed.

Host-only dumps (apps a given host runs that lemon-stack does not ship) are
additional `backup.d/` scripts kept out of the upstream repo. This is the
portability seam: new apps extend backups without touching the engine.

### 3. Guided restore (`restore.sh`)

Never destructive without explicit confirmation; restores to a staging
directory by default.

- `restore.sh list` — table of restic snapshots.
- `restore.sh files <snapshot|latest> <path> [--target DIR]` — restore a file
  or directory into a staging dir (default `~/restore-staging/<timestamp>/`).
- `restore.sh db <name> [--snapshot ID]` — pull `pg-shared-<name>.dump` from
  the snapshot; offer (a) restore into a scratch DB `<name>_restoretest` for
  inspection, or (b) in-place restore after a typed confirmation.
- `restore.sh openbao [--snapshot ID]` — stage the Raft snapshot file and
  print the manual `bao operator raft snapshot restore` steps. Unseal keys
  remain a human responsibility; this is never automated.

A full disaster-recovery runbook (fresh machine → `setup.sh` → restore
sequence: globals → per-DB → files → OpenBao) lives in
`docs/backup-restore.md`.

### 4. Setup integration

- New optional component `backup` in `COMPONENTS`
  (`setup/parameters.example.env` documents the vars).
- `setup/install-backup.sh`:
  - prompts for `RESTIC_REPOSITORY` (any restic backend: S3/R2, local path,
    sftp, rest-server), `RESTIC_PASSWORD`, optional
    `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY`;
  - writes `~/.restic-env` mode 600;
  - runs `restic init` if the repository is empty;
  - installs the engine, restore script, default
    `backup-paths.txt`/`backup-excludes.txt`, and the `backup-hook.sh` of
    every enabled component into `~/backup.d/`;
  - installs cron: daily backup at 03:00, monthly `--verify`;
  - offers an immediate first run.
- `verify-install.sh` gains checks: backup cron entry present, `.restic-env`
  exists with mode 600, last successful run < 48 h old (same log parse as
  `lemon backup-status`).
- `scripts/promote.sh` gains mappings for `infra/backup/` and per-component
  hooks.

### 5. Docs

- `docs/backup-restore.md` — operation, hook contract, DR runbook (new).
- `docs/architecture.md` — real "Backup & restore" section (fixes the dead
  `#backup--restore` anchor from `upgrading.md`).
- README — maintenance section rewritten (drop "bring your own"); component
  table row.
- `docs/troubleshooting.md` — failed backup / failed restore entries.
- CHANGELOG entry.

## Error handling

| Failure | Behaviour |
|---|---|
| `.restic-env` missing | Fatal, actionable message |
| Hook fails / service down | `WARNING` in log, run continues |
| restic backup fails (≠ 3) | Fatal, ERR trap fires tg-notify `error` |
| restic exit 3 | Logged, treated as success |
| OpenBao sealed | Hook soft-skips with note |
| tg-notify absent | Notifications silently skipped |
| Restore target exists / in-place restore | Explicit typed confirmation required |

## Migration & testing (live-first)

On the reference host, in order, keeping the old script as
`backup.sh.pre-refactor` until proven:

1. Split the current script into engine + hooks + path config (host-only app
   dumps become host-only hooks).
2. Run a full manual backup; compare `restic ls latest` contents against the
   previous night's snapshot.
3. Restore drill: one database into a scratch DB, one file to staging; verify
   contents.
4. Let the next 03:00 cron run confirm end-to-end (including the digest
   workflow).
5. Promote the portable parts upstream; repo CI (shellcheck, `bash -n`, leak
   guard, template coverage) validates the templates.

## Out of scope

- One-command bare-metal rebuild automation (runbook covers it manually).
- Containerised backup runners.
- Backing up large media stores (PhotoPrism-class data) — excluded by
  default, documented.

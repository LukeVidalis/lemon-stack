# Backup & restore

The `backup` component gives you daily [restic](https://restic.net/) snapshots
of your configs and databases, a monthly integrity check, and a guided restore
script. It was extracted from (and is drift-checked against) the reference
production host, where it has run nightly for months.

## How it works

```
cron 03:00 daily
  └─ ~/backup.sh                       generic engine
       ├─ ~/backup.d/*.sh              dump hooks, lexical order
       │    50-postgres-shared.sh  →   pg-shared-globals.sql + pg-shared-<db>.dump
       │    55-n8n-sqlite.sh       →   n8n.sqlite
       │    60-openbao-snapshot.sh →   fresh Raft snapshot under ~/docker/openbao/
       │    7x-your-own.sh         →   anything else (host-only, never upstream)
       │         (each writes into a temp $DUMP_DIR)
       ├─ restic backup                paths from ~/.config/lemon/backup-paths.txt
       │                               + excludes + $DUMP_DIR
       └─ restic forget --prune        retention: 7 daily / 4 weekly / 6 monthly
```

- **Engine** (`~/backup.sh`) — generic; knows nothing about your apps.
- **Hooks** (`~/backup.d/`) — one script per data source. Portable hooks ship
  in `infra/backup/hooks/`; your own hooks just live in the directory.
- **Config** — `~/.config/lemon/backup-paths.txt` (what restic backs up, one
  path per line) and `backup-excludes.txt` (patterns to skip). Created with
  sensible defaults on install; edit freely — they are yours after that.
- **Credentials** — `~/.restic-env` (mode 600):

  ```bash
  export RESTIC_REPOSITORY=...
  export RESTIC_PASSWORD=...
  # only for S3-compatible backends:
  export AWS_ACCESS_KEY_ID=...
  export AWS_SECRET_ACCESS_KEY=...
  # optional overrides:
  # export KEEP_DAILY=7 KEEP_WEEKLY=4 KEEP_MONTHLY=6
  # export VERIFY_SUBSET=2%
  ```

The log format (`[YYYY-MM-DD HH:MM:SS]` lines between `=== Backup started ===`
/ `=== Backup complete ===` markers) is a contract — `lemon backup-status` and
the `daily-backup-digest` n8n starter workflow parse it.

## Installation

Add `backup` to `COMPONENTS` in `setup/parameters.env` and run `./setup.sh`
(or directly: `bash setup/install-backup.sh`). The installer:

1. Installs restic via apt if missing.
2. Prompts for the repository + password and writes `~/.restic-env` (600).
   Any restic backend works:
   - Cloudflare R2 / S3: `s3:https://<accountid>.r2.cloudflarestorage.com/<bucket>`
   - SFTP: `sftp:user@host:/srv/restic`
   - Local/USB: `/mnt/usb/restic`
3. Runs `restic init` if the repository is new.
4. Installs the engine, `~/restore.sh`, the hooks for your enabled
   components, and default path/exclude config.
5. Installs cron: daily backup at 03:00, integrity verify at 04:30 on the 1st.
6. Offers an immediate first run.

**Store `RESTIC_PASSWORD` somewhere off-host** (password manager). Without it
the repository is unreadable — that is the point of it.

## Daily operation

```bash
lemon backup-status        # last run + latest snapshot, one call
tail -40 ~/backup.log      # full log
~/backup.sh --verify       # on-demand integrity check (reads 2% of repo data)
```

If tg-notify is installed, every run posts success/failure to the `backups`
channel. The `daily-backup-digest` n8n starter workflow adds a morning
summary. `scripts/verify-install.sh` checks cron presence, `.restic-env`
permissions, and log freshness.

## Writing a dump hook

A hook is an executable shell script in `~/backup.d/`, run in lexical order:

- It reads the exported `$DUMP_DIR` and writes dump files into it.
- It exits `0` when its service isn't running (soft skip).
- A nonzero exit is logged as `WARNING: hook <name> failed (continuing)` —
  it never aborts the backup, but it will flag the run in `lemon backup-status`.

Numbering convention: `5x` databases, `6x` snapshot-style dumps, `7x+`
host-only extras. Example — an app with a SQLite file in a named volume:

```bash
#!/usr/bin/env bash
# ~/backup.d/70-myapp-sqlite.sh (host-only — not part of lemon-stack upstream)
set -euo pipefail
: "${DUMP_DIR:?DUMP_DIR not set — run via backup.sh}"

if ! docker volume ls --format '{{.Name}}' | grep -q '^myapp-data$'; then
    echo "myapp-data volume not found, skipping"
    exit 0
fi
docker run --rm -v myapp-data:/data -v "$DUMP_DIR:/dump" \
    alpine cp /data/app.db /dump/myapp.sqlite
echo "myapp: OK"
```

`chmod +x` it and it is picked up on the next run — the engine never needs to
change. Keep host-only hooks out of the upstream repo; that's the portability
seam.

## Restore

`~/restore.sh` never touches live data without a typed confirmation, and
restores into a fresh staging directory (`~/restore-staging/<timestamp>/`)
by default.

```bash
~/restore.sh list                          # what snapshots exist?

# a file or directory, into staging:
~/restore.sh files latest /etc/caddy/Caddyfile
~/restore.sh files 1a2b3c4d ~/docker/n8n --target /tmp/inspect

# a postgres-shared database, into a scratch DB for inspection:
~/restore.sh db notify
#   → creates notify_restoretest; inspect it, then drop it as printed.

# the same, destructively (asks you to type 'yes'):
~/restore.sh db notify --in-place

# OpenBao: stages the raft .snap and prints the manual steps
~/restore.sh openbao
```

## Disaster recovery runbook

Full rebuild from nothing but the restic repository + your credentials:

1. **Fresh machine**: install Docker, clone lemon-stack, copy your saved
   `setup/parameters.env` (or re-answer prompts), run `./setup.sh` with the
   same `COMPONENTS`. This rebuilds the platform — apps and data come next.
2. **Recreate `~/.restic-env`** from your password manager. Check access:
   `source ~/.restic-env && restic snapshots`.
3. **Config trees**: `~/restore.sh files latest ~/docker --target ~/`
   restores compose files, app secrets, and OpenBao snapshot files into
   place (staging-to-final is a `cp -a` once you've inspected).
4. **Databases** (order matters):
   ```bash
   ~/restore.sh files latest '*/pg-shared-globals.sql'   # roles/passwords
   docker exec -i postgres-shared psql -U postgres < <staging>/.../pg-shared-globals.sql
   ~/restore.sh db <name> --in-place                     # per DB
   ```
5. **OpenBao**: `~/restore.sh openbao`, then the printed raft-restore steps
   with your unseal keys.
6. **Apps**: push each app repo (or re-run its Action) — the deploy pipeline
   rebuilds images from source; only data and config come from backup.

## What is NOT backed up

- Large media stores (PhotoPrism-class data) — add them to
  `backup-paths.txt` yourself if you accept the size/cost.
- OpenBao's raw `data/` directory — excluded by design; the Raft snapshot is
  the supported backup form.
- Anything matching `backup-excludes.txt` (`*.log`, `*.tmp`, DB data dirs
  that are covered by dumps instead).
- **Unseal keys and root tokens** — deliberately never in the repo they
  unlock. Keep them off-host (the setup docs say this too; it matters).

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

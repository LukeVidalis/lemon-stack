#!/usr/bin/env bash
# Provision a per-app database + role inside postgres-shared.
# Idempotent: safe to re-run; will not overwrite an existing password.
#
# Usage:  ./provision-db.sh <app>
# Output: prints DATABASE_URL on stdout (for ~/docker/<app>/secrets.env)

set -euo pipefail

APP="${1:-}"
if [[ -z "$APP" ]] || [[ ! "$APP" =~ ^[a-z][a-z0-9_]*$ ]]; then
  echo "usage: $0 <app>   (lowercase letters/digits/underscores, must start with letter)" >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SECRETS_DIR="$SCRIPT_DIR/secrets"
PW_FILE="$SECRETS_DIR/$APP.pw"
CONTAINER="postgres-shared"

if ! docker ps --filter "name=^${CONTAINER}$" --format '{{.Names}}' | grep -q .; then
  echo "ERROR: $CONTAINER not running" >&2
  exit 2
fi

mkdir -p "$SECRETS_DIR"
chmod 700 "$SECRETS_DIR"

if [[ -s "$PW_FILE" ]]; then
  PW="$(cat "$PW_FILE")"
else
  PW="$(openssl rand -base64 36 | tr -d '\n/+=')"
  umask 077
  printf '%s' "$PW" > "$PW_FILE"
fi

ROLE="${APP}_owner"
DB="$APP"

# Role: create if missing, otherwise sync password to match PW_FILE.
docker exec -i "$CONTAINER" psql -U postgres -v ON_ERROR_STOP=1 <<SQL >/dev/null
DO \$\$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${ROLE}') THEN
    EXECUTE format('CREATE ROLE %I LOGIN PASSWORD %L', '${ROLE}', '${PW}');
  ELSE
    EXECUTE format('ALTER ROLE %I WITH LOGIN PASSWORD %L', '${ROLE}', '${PW}');
  END IF;
END
\$\$;
SQL

# Database: create if missing (CREATE DATABASE cannot run inside a DO block).
DB_EXISTS=$(docker exec "$CONTAINER" psql -U postgres -tAc "SELECT 1 FROM pg_database WHERE datname='${DB}'")
if [[ "$DB_EXISTS" != "1" ]]; then
  docker exec "$CONTAINER" psql -U postgres -v ON_ERROR_STOP=1 -c "CREATE DATABASE \"${DB}\" OWNER \"${ROLE}\";" >/dev/null
fi

docker exec "$CONTAINER" psql -U postgres -v ON_ERROR_STOP=1 <<SQL >/dev/null
REVOKE ALL ON DATABASE "${DB}" FROM PUBLIC;
GRANT CONNECT ON DATABASE "${DB}" TO "${ROLE}";
ALTER DATABASE "${DB}" OWNER TO "${ROLE}";
SQL

# Echo connection details. The hostname is the container/service name on lemon-internal.
cat <<EOF
# postgres-shared provisioned: $APP
# password file: $PW_FILE  (mode 600)
DB_HOST=postgres-shared
DB_PORT=5432
DB_NAME=$DB
DB_USER=$ROLE
DB_PASSWORD=$PW
DATABASE_URL=postgres://$ROLE:$PW@postgres-shared:5432/$DB
# .NET style:
ConnectionStrings__Default=Host=postgres-shared;Database=$DB;Username=$ROLE;Password=$PW
EOF

# postgres-shared

One Postgres 17 instance, hosting one DB + one owner role per app. No port is
published — apps reach it via the `lemon-internal` Docker network at hostname
`postgres-shared`.

## Provisioning a new app DB

```bash
./provision-db.sh myapp
```

Idempotent. Creates the role `myapp_owner` with a random password stored at
`./secrets/myapp.pw` (mode 600), creates the database `myapp` owned by that
role, and prints both a libpq `DATABASE_URL` and a .NET `ConnectionStrings__Default`.

## Root password

Lives at `./secrets/postgres_root` (mode 600). Created by `setup.sh` on first
install. To rotate manually: edit the file, then
`docker compose restart postgres-shared`.

## Backups

`~/backup.sh` (Phase 2 template) calls `pg_dumpall --globals-only` plus a
per-DB `pg_dump -Fc` loop on this instance — new DBs are picked up automatically.

## Why not one DB per container?

Three reasons: memory (one 250 MB shared-buffers footprint vs N × 80 MB per
container), backup convenience (one loop covers everything), and operational
mental load (one healthcheck, one upgrade plan).

Apps with non-standard requirements (PostGIS, MariaDB) stay standalone.

# OpenBao Bootstrap

OpenBao (the open-source Vault fork) stores deployment secrets. The lemon-stack deploy pipeline fetches `.env` values from OpenBao at runtime via `bao-fetch.sh`.

> **Security rule:** `setup.sh` will NOT auto-save the unseal keys or root token. You must capture them off-host the first time. If you lose them, your secrets are unrecoverable.

## Initial setup (manual — by design)

```bash
cd {{USER_HOME}}/docker/openbao
docker compose up -d
# Wait ~10s
./bao-init.sh   # prints unseal keys + root token ONCE
```

**Immediately:**

1. Copy the 5 unseal keys and root token to your password manager (1Password, Bitwarden, etc.).
2. Store at least 3 of the 5 unseal keys in **physically separate** locations (e.g. password manager + printed copy in safe).
3. Confirm you have them stored — the script will pause until you type `STORED` to continue.

## Unsealing after a reboot

OpenBao seals itself on every restart. You must unseal it manually:

```bash
{{USER_HOME}}/docker/openbao/unseal.sh
# Paste 3 of 5 keys when prompted
```

The `sealed-alert.sh` cron pings tg-notify if OpenBao is sealed for >5 minutes.

## Reading and writing secrets

```bash
lemon bao-set <app>/DATABASE_URL "postgres://..."
lemon bao-get <app>/DATABASE_URL
lemon bao-list <app>
```

Underneath, these wrap `bao kv put/get/list secret/<app>/<key>`.

## How deploy.sh uses it

When deploying an app, `deploy.sh` calls `bao-fetch.sh <app>` which:

1. Authenticates via AppRole (role-id + secret-id stored on host, never committed).
2. Reads all keys under `secret/<app>/*`.
3. Writes them as `KEY=VALUE` lines to `{{USER_HOME}}/docker/<app>/.env` mode 600.
4. The compose file reads `.env` automatically.

## AppRole rotation

To rotate the AppRole secret-id (recommended quarterly):

```bash
{{USER_HOME}}/docker/openbao/bao-bootstrap-approle.sh --rotate-secret-id
# Updates {{USER_HOME}}/docker/openbao/.approle-secret-id mode 600
```

## Backup

`{{USER_HOME}}/backup.sh` calls `snapshot.sh` which writes a Raft snapshot to `{{USER_HOME}}/backups/openbao/`. **Without the unseal keys, the snapshot is useless** — back them up separately.

## Common issues

| Symptom | Fix |
|---|---|
| `bao status` shows `sealed: true` | Run `unseal.sh`. |
| `bao-fetch.sh` permission denied | AppRole likely expired; re-bootstrap with `bao-bootstrap-approle.sh`. |
| `tg-notify` warning "OpenBao sealed >5m" | Either unseal, or silence: `lemon bao-set monitoring/sealed-alert disabled`. |

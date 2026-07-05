# OpenBao

KV-v2 secrets manager with per-app AppRoles. Backs the `~/deploy/bao-fetch.sh`
call in `deploy.sh`'s `load_secrets()`; `~/docker/<app>/secrets.env` is the
fallback when Bao is sealed or unreachable.

## ⚠️ Unseal keys

On first init, Bao prints **five unseal keys** and one **root token**. They are
written to `./init.json` (mode 600, gitignored). **You must copy them off this
host** — PGP-encrypted, password manager, paper safe, your choice. If this
host's disk dies and you don't have them somewhere else, **every secret in Bao
is permanently unrecoverable**.

`setup.sh` will:
1. Initialise Bao on first run, capture the output to `./init.json`.
2. Print the keys + token to the terminal with a giant warning.
3. Refuse to proceed until you type `I have stored the keys off-host`.

## Helper scripts

| Script | Purpose |
|---|---|
| `bao-bootstrap-approle.sh <app>` | Create a policy + AppRole for a new app, write role/secret IDs |
| `bao-import-env.sh <app>` | Bulk-import an existing `secrets.env` into `secret/apps/<app>/` |
| `bao-set.sh <app> <KEY> <VALUE\|-> ` | Set/rotate one secret (KV v2 keeps version history) |
| `unseal.sh` | Apply 3 of the 5 unseal keys from `init.json` after a restart |
| `snapshot.sh` | Take a Raft snapshot into `./snapshots/` (daily cron + once in `~/backup.sh`) |
| `sealed-alert.sh` | Cron-friendly check that tg-notifies if Bao is sealed or down |

## Layout

```
secret/apps/<app>/<KEY>     # KV v2, each KEY stored as {value: ...}
auth/approle/role/<app>     # per-app AppRole
sys/policies/acl/<app>      # per-app policy (read on secret/data/apps/<app>/*)
```

Per-app role + secret IDs live at `~/docker/<app>/.bao-role-id` and
`~/docker/<app>/.bao-secret-id` (mode 600). These ARE the credentials Bao
trusts on this host — losing them is equivalent to losing the secrets.

## Do NOT put in Bao

Root-of-trust material — PGP master keys, SSH host keys, the unseal keys
themselves. Bao is for app and API secrets only; anything that *unlocks* Bao
must live elsewhere.

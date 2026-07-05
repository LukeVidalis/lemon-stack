# Upgrading lemon-stack

lemon-stack is a *publication artifact* — you cloned it, ran `setup.sh`, and the rendered files now live in `{{USER_HOME}}/docker/*`, `{{USER_HOME}}/deploy/*`, `~/.claude/skills/*`, etc. To pull in upstream improvements you have two options.

## Option A — Use drift-check-upstream (recommended)

This is the safe, interactive path. Run it whenever you want to consider new upstream changes:

```bash
cd ~/lemon-stack
git pull
./scripts/drift-check.sh --verbose
```

For each diverged file you'll see:

- ✅ **Pull from upstream** — replaces your local file with the upstream version (re-rendered with your params).
- ⬆️ **Push to upstream** — your local change is worth contributing back (opens a diff for review before PR).
- ⏭️ **Mark intentional divergence** — recorded in `.lemon-stack-divergence.yaml`, never prompted again.

The weekly cron (`crontab -l | grep drift-check`) sends a tg-notify summary every Monday.

## Option B — Re-run setup.sh

For major upgrades (e.g. Authentik 2026.x → 2027.x), re-running setup.sh is safer:

```bash
cd ~/lemon-stack
git pull
./setup.sh --reuse-parameters     # skips the prompts, uses existing setup/parameters.env
```

`setup.sh` is idempotent: it re-renders all templates, pulls new images, runs new blueprints, and re-runs `post-install-checks.sh`. It will NOT delete your data volumes.

**Before re-running, always:**

1. `{{USER_HOME}}/backup.sh` — full backup including `postgres-shared` dump and OpenBao snapshot.
2. Read the relevant section of `CHANGELOG.md` for breaking changes.

## Per-component upgrade quirks

| Component | Quirk |
|---|---|
| **Authentik** | Blueprints are version-coupled. Read release notes for blueprint schema changes. |
| **OpenBao** | Sealed after restart — be ready to unseal manually before deploy.sh can fetch secrets. |
| **postgres-shared** | Major version bumps (PG17 → PG18) require `pg_upgrade` — see [Postgres docs](https://www.postgresql.org/docs/current/pgupgrade.html). lemon-stack does not automate this. |
| **Caddy** | Generally seamless. Watch for Caddyfile syntax changes in 2.x → 3.x. |
| **Cloudflare Tunnel** | Cloudflared image upgrades are seamless; tunnel config is in dashboard. |

## Rolling back an upgrade

```bash
cd ~/lemon-stack
git log --oneline -10                 # find the commit before the upgrade
git checkout <previous-commit>
./setup.sh --reuse-parameters
```

For data rollback (worst case): restore the most recent `{{USER_HOME}}/backups/` snapshot. See [backup docs](architecture.md#backup--restore).

## Contributing upstream

If you made a generic improvement (not personal config), the `drift-check-upstream` skill flags it. You can PR back:

```bash
cd ~/lemon-stack
git checkout -b improve-<thing>
# the skill will have copied your change with templating applied
git commit && gh pr create
```

PRs against generic functionality are welcome; PRs that add new components require a discussion issue first.

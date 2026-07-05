# Troubleshooting

Common issues, ordered by frequency. If your problem isn't here, run `lemon server-health --verbose` first — it surfaces 90% of issues.

## Setup-time issues

### `setup.sh` fails at "waiting for Authentik health"
Authentik takes 1–3 minutes to migrate the database on first start. If it times out:
```bash
cd {{USER_HOME}}/docker/authentik
docker compose logs worker --tail 100
```
Look for migration errors. Most common: DB password mismatch — check `setup/parameters.env` vs `{{USER_HOME}}/docker/authentik/.env`.

### `setup.sh` fails at "registering self-hosted runner"
The GitHub registration token expires in 1 hour. Re-run:
```bash
./setup.sh --resume runner
```
You'll be re-prompted for a fresh token.

### "permission denied" on `{{USER_HOME}}/docker/*`
`setup.sh` should be run as a non-root user with Docker group membership:
```bash
sudo usermod -aG docker $USER
newgrp docker
./setup.sh
```

## Runtime issues

### Subdomain returns 502 Bad Gateway
The container isn't reachable on its allocated port.
```bash
lemon ports <app>                  # confirm allocated port
docker ps | grep <app>             # confirm container is running
curl -v localhost:<port>           # confirm container responds
docker compose -f {{USER_HOME}}/docker/<app>/docker-compose.yml logs --tail 100
```

### Subdomain redirects in a loop
SSO outpost is out of sync. Restart Authentik:
```bash
cd {{USER_HOME}}/docker/authentik
docker compose restart server worker
cd {{USER_HOME}}/docker/caddy
docker compose restart
```

### "OpenBao sealed" alerts
Run unseal after every reboot:
```bash
{{USER_HOME}}/docker/openbao/unseal.sh
```
To auto-unseal on boot (less secure; only if your threat model allows): store unseal keys in OpenBao's auto-unseal config — see [official docs](https://openbao.org/docs/configuration/seal/).

### Deploy fails: "port already in use"
Stale port allocation in `{{USER_HOME}}/deploy/ports.json`:
```bash
lemon ports --cleanup              # removes entries for non-running containers
```

### Cloudflare Tunnel "no healthy origin"
Cloudflared can't reach Caddy. Check:
```bash
docker compose -f {{USER_HOME}}/docker/cloudflare/docker-compose.yml logs --tail 50
docker compose -f {{USER_HOME}}/docker/caddy/docker-compose.yml ps
```
Usually fixed by restarting cloudflared.

## Claude Code skills issues

### `~/.claude/skills/<skill>/SKILL.md` not found
Re-run installer:
```bash
cd ~/lemon-stack
./setup/install-skills.sh
```

### Drift-check skill reports false positives
A file you intentionally diverged is being flagged. Mark it:
```bash
./scripts/drift-check.sh --mark-intentional <path>
```

## Backup / restore

### Backup failing / `lemon backup-status` shows DEGRADED
```bash
tail -60 {{USER_HOME}}/backup.log
```
Common causes:
- **`WARNING: hook <name> failed (continuing)`** — that data source's dump
  failed but the snapshot still ran. Run the hook by hand to see why:
  `DUMP_DIR=$(mktemp -d) bash ~/backup.d/<name>.sh`
- **Sealed OpenBao** — the openbao hook soft-skips, but the last Raft
  snapshot in the backup is then stale. Unseal (`docker/openbao/unseal.sh`).
- **Expired object-storage credentials** — restic fails outright; rotate the
  keys and update `~/.restic-env`.
- **`repository is already locked`** — an earlier run was interrupted:
  `source ~/.restic-env && restic unlock`.

### Restoring after data loss
Use the guided script — it stages by default and confirms before anything
destructive (full runbook: [backup-restore.md](./backup-restore.md)):
```bash
{{USER_HOME}}/restore.sh list                       # pick a snapshot
{{USER_HOME}}/restore.sh files latest <path>        # file/dir → staging dir
{{USER_HOME}}/restore.sh db <name>                  # DB → <name>_restoretest scratch
{{USER_HOME}}/restore.sh db <name> --in-place       # DB → live (typed confirm)
{{USER_HOME}}/restore.sh openbao                    # stage raft .snap + steps
```

### Restore says "no dump found for `<name>`"
The DB was provisioned after that snapshot was taken. Check what the snapshot
actually contains: `source ~/.restic-env && restic ls <snap> | grep pg-shared`.

## Getting unstuck

```bash
lemon server-health --verbose      # one-shot diagnosis
lemon logs <app> --tail 200        # app-specific logs
lemon logs --infra                 # all infra logs interleaved
```

If you're still stuck: open an issue at https://github.com/LukeVidalis/lemon-stack/issues with the output of `lemon server-health --verbose` (it auto-redacts secrets).

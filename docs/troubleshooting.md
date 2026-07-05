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

### Restoring after data loss
```bash
ls {{USER_HOME}}/backups/                          # find most recent snapshot
# For Postgres:
cd {{USER_HOME}}/docker/postgres-shared
docker compose exec postgres pg_restore -U postgres -d <db> < /backups/<dump>.dump
# For OpenBao:
docker compose -f {{USER_HOME}}/docker/openbao/docker-compose.yml down
cp {{USER_HOME}}/backups/openbao/latest.snap {{USER_HOME}}/docker/openbao/data/raft/
docker compose up -d
{{USER_HOME}}/docker/openbao/unseal.sh
```

## Getting unstuck

```bash
lemon server-health --verbose      # one-shot diagnosis
lemon logs <app> --tail 200        # app-specific logs
lemon logs --infra                 # all infra logs interleaved
```

If you're still stuck: open an issue at https://github.com/LukeVidalis/lemon-stack/issues with the output of `lemon server-health --verbose` (it auto-redacts secrets).

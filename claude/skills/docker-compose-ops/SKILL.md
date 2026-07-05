---
name: docker-compose-ops
description: "Use BEFORE restarting any Docker Compose service, especially after editing a compose file, env vars, image tag, or mounted config — restart vs up -d apply different changes and the wrong one silently keeps stale config"
allowed-tools:
  - Bash
---

<objective>
Reference for restarting Docker Compose services correctly.
The key rule: `docker compose restart` does NOT apply config changes.
Use this skill whenever restarting a service after editing a compose file, env vars, volumes, or image.
</objective>

<context>
## The Critical Distinction

| What changed | Command needed | Why |
|---|---|---|
| Nothing (process hung/crashed) | `docker compose restart <svc>` | Restarts process, keeps existing container |
| `environment:` vars | `docker compose up -d <svc>` | Recreates container with new env |
| `image:` (new tag) | `docker compose up -d <svc>` | Recreates container with new image |
| `ports:`, `volumes:`, `networks:` | `docker compose up -d <svc>` | Recreates container with new config |
| `command:` or `entrypoint:` | `docker compose up -d <svc>` | Recreates container with new config |
| Config file mounted as volume | `docker compose restart <svc>` | File is re-read on process start; no recreate needed |

**Rule of thumb:** if you edited `docker-compose.yml`, always use `up -d`. If you only edited a file that the container reads at startup (e.g. `loki-config.yaml`, `promtail-config.yaml`), `restart` is enough.

## Commands

```bash
# Restart process only — does NOT pick up compose file changes
docker compose restart <service>

# Recreate container — picks up ALL compose file changes (env, image, ports, volumes)
docker compose up -d <service>

# Recreate only if config has changed (safe default for CI/automation)
docker compose up -d --no-build <service>

# Force recreate even if nothing changed
docker compose up -d --force-recreate <service>

# Pull latest image then recreate
docker compose pull <service> && docker compose up -d <service>

# Recreate all services in the stack
docker compose up -d

# Stop and remove containers (keeps volumes)
docker compose down

# Stop, remove containers AND volumes (destructive — data loss)
docker compose down -v
```

## Verifying What's Running

After a config change, confirm the container actually has the new values:

```bash
# Check env vars inside the running container
docker exec <container> env | grep <VAR_NAME>

# Check the full resolved config Compose would deploy
docker compose config

# See when the container was created (if recent, it was recreated)
docker inspect <container> --format '{{.Created}}'
```

## On lemon-server

Both CLIs are installed: `docker compose` (v2, 2.40.3 — preferred) and legacy `docker-compose` (v1 at `/usr/local/bin/docker-compose`). **Use v2 for everything new**; the deploy pipeline and all auto-deployed apps use v2. v1 only matters if an old script hardcodes it — either CLI operates on the same compose files.

```bash
cd ~/docker/<service> && docker compose up -d
```
</context>

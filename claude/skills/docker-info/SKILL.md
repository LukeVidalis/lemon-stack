---
name: docker-info
description: "Use when restarting/inspecting Docker containers on lemon-server, locating a compose file or volume, checking watchtower update policy, or when docker network creation fails (address-pool exhaustion)"
allowed-tools:
  - Bash
  - Read
  - Write
  - Edit
  - Grep
  - Glob
---

<objective>
Reference for all Docker workloads on lemon-server. Use when managing containers, finding compose files,
restarting services, or understanding the container topology.
</objective>

<context>
## Important

- Docker version: **28.2.2**
- **Prefer `docker compose` (v2, 2.40.3)** — installed and used by the deploy pipeline and multi-service apps. Legacy `docker-compose` v1 also exists at `/usr/local/bin/docker-compose`; either works for old single-service stacks, but use v2 for anything new.
- All compose files live under `~/docker/`

## Container Inventory

> **Snapshot — verify live before acting.** This table drifts. Source of truth: `docker ps`, `lemon docker-ls`, `lemon app ls`.

| Container | Image | Purpose | Compose File | Port (host) | Volumes / Mounts |
|---|---|---|---|---|---|
| `homeassistant` | `ghcr.io/home-assistant/home-assistant:latest` | Smart-home controller | `~/docker/homeassistant/docker-compose.yml` (host net) | 8123 (host net) | `/home/homeassistant/config:/config` |
| `n8n` | `docker.n8n.io/n8nio/n8n` | Workflow automation | `~/docker/n8n/docker-compose.yml` | 127.0.0.1:5678 | `n8n_n8n_data:/home/node/.n8n` |
| `cloudflared` | `cloudflare/cloudflared:latest` | Cloudflare Tunnel egress | `~/docker/cloudflare/docker-compose.yml` | none (host net) | none |
| `twingate-icy-wasp` | `twingate/connector:1` | Twingate VPN connector | none (started manually) | none | none |
| `portainer` | `portainer/portainer-ce:latest` | Docker management UI | none (started manually) | 127.0.0.1:8000, 127.0.0.1:9443 | `portainer_data:/data`, `/var/run/docker.sock` |
| `photoprism` | `photoprism/photoprism:latest` | Photo library | `~/docker/photoprism/docker-compose.yml` | 127.0.0.1:2342 | `~/docker/photoprism/originals`, `storage` |
| `photoprism-db` | `mariadb:latest` | PhotoPrism database | `~/docker/photoprism/docker-compose.yml` | none | `~/docker/photoprism/database:/var/lib/mysql` |
| `watchtower` | `containrrr/watchtower:latest` | Auto image updater | none (started manually) | none | `/var/run/docker.sock` |
| `glances` | `nicolargo/glances:latest` | System/container monitor | `~/docker/glances/docker-compose.yml` | 127.0.0.1:61208 | `/var/run/docker.sock:ro` |
| `pihole` | `pihole/pihole:latest` | DNS ad-blocker | `~/docker/pihole/docker-compose.yml` | host net (53, 8088) | `~/docker/pihole/etc-pihole/`, `etc-dnsmasq.d/` |

**Auto-deployed projects** also run as Docker containers on ports 10000-10999. Check `~/deploy/ports.json` for the registry.

Notable auto-deployed services:

| Container | Image | Purpose | Compose File | Port (host) |
|---|---|---|---|---|
| `admin-ui-api-1` | `admin-ui-api:latest` | Authentik API proxy (Express.js) | `~/docker/admin-ui/docker-compose.yml` | 127.0.0.1:10006 |
| `admin-ui-web-1` | `admin-ui-web:latest` | Admin panel frontend (React+Vite+Tailwind) | `~/docker/admin-ui/docker-compose.yml` | 127.0.0.1:10007 |
| `login-portal-web-1` | `login-portal-web:latest` | Custom Authentik SSO login UI | `~/docker/login-portal/docker-compose.yml` | 127.0.0.1:10000 |
| `food-planner-app-1` | `food-planner-app:latest` | Food planning app | `~/docker/food-planner/docker-compose.yml` | auto-assigned |
| `friendly-api-1` | `friendly-api:latest` | Friendly app API | `~/docker/friendly/docker-compose.yml` | auto-assigned |
| `friendly-web-1` | `friendly-web:latest` | Friendly app frontend | `~/docker/friendly/docker-compose.yml` | auto-assigned |

**Monitoring stack** (`~/docker/monitoring/docker-compose.yml`): `loki` (127.0.0.1:3100), `promtail` (no host port, Docker socket SD), `grafana` (127.0.0.1:3200). See `/logging` skill.

## Container Notes

- **Home Assistant** and **Pi-hole** use `network_mode: host`. Both are compose-managed (`~/docker/homeassistant/`, `~/docker/pihole/`).
- **Watchtower** runs daily, only updates containers with label `com.centurylinklabs.watchtower.enable=true`. The opt-in set changes — list it live:
  ```bash
  docker ps --format '{{.Names}}' | while read c; do [ "$(docker inspect "$c" --format '{{index .Config.Labels "com.centurylinklabs.watchtower.enable"}}')" = "true" ] && echo "$c"; done
  ```
- **Weekly cron** (Sundays 02:00 UTC): `docker image prune -f` — removes dangling images only.
- **All port bindings are 127.0.0.1** — containers not directly reachable from the network.
- **ownCloud removed** 2026-04-07. Backup at `~/owncloud-backup-20260407/`. Compose archived to `~/docker/owncloud-archived-20260407/`.

## Common Operations

```bash
# Restart a compose service
cd ~/docker/<service> && docker-compose restart

# Rebuild and restart
cd ~/docker/<service> && docker-compose up -d --build

# View logs
docker logs <container> --tail 50 -f

# Check all containers
docker ps -a

# Disk usage
docker system df

# Enter container shell
docker exec -it <container> sh
```

## Credentials

All compose-file credentials are in `.env` files (mode 600), never hardcoded:
- Dawarich: `~/docker/dawarich/docker/.env` — `DAWARICH_DB_PASSWORD`, `SECRET_KEY_BASE`
- PhotoPrism: `~/docker/photoprism/.env` — `MARIADB_ROOT_PASSWORD`, `MARIADB_PASSWORD`, `PHOTOPRISM_ADMIN_PASSWORD`
- Pi-hole: `~/docker/pihole/.env` — `PIHOLE_WEBPASSWORD`
- Cloudflare: `~/docker/cloudflare/.env` — `TUNNEL_TOKEN`

## Address-pool exhaustion (deploy fails: "all predefined address pools have been fully subnetted")

Docker's built-in default pools (172.17–172.31/16 = 15 nets; 192.168.0.0/16 in /20s) cap out at ~29 user networks. When a new compose project can't create its network, add a fresh non-overlapping pool to `/etc/docker/daemon.json`:

```json
{
  "live-restore": true,
  "default-address-pools": [
    {"base": "10.10.0.0/16", "size": 24},
    {"base": "10.11.0.0/16", "size": 24},
    {"base": "10.12.0.0/16", "size": 24},
    {"base": "10.13.0.0/16", "size": 24}
  ]
}
```

Then `sudo systemctl restart docker`. `live-restore: true` keeps all running containers up across the restart (OpenBao stays unsealed). Existing networks keep their subnets; only NEW networks draw from the added 10.x pool. Specifying `default-address-pools` replaces the built-ins, so just ensure the new range is free (no 10.x host routes / VPN ifaces — verify with `ip route`). Done 2026-06 to unblock the knowledgebase deploy.
</context>

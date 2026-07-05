---
name: server-status
description: "Use when asked whether lemon-server or a service on it is healthy/running, when diagnosing disk/memory/systemd issues, or when you need the inspection commands for any core service (prefer `lemon server-health` for a one-shot composite)"
allowed-tools:
  - Bash
  - Read
  - Grep
  - Glob
---

<objective>
Inspect lemon-server health: check containers, services, disk, network, logs, and systemd units.
Use this when the user asks about server status, whether something is running, or wants to diagnose an issue.
</objective>

<context>
## Inspection Commands

```bash
# All containers (running + stopped)
docker ps -a

# Container logs
docker logs <name> --tail 50 -f

# Disk usage
df -h && docker system df

# Cloudflare tunnel status
docker inspect cloudflared --format '{{.State.Status}}'
docker logs cloudflared --tail 20

# Caddy reverse proxy
sudo systemctl status caddy
sudo journalctl -u caddy -n 20
# Config: /etc/caddy/Caddyfile

# Pi-hole
docker exec pihole pihole status
# Admin UI: https://pihole.{{DOMAIN}}/admin
# Restart: cd ~/docker/pihole && docker-compose restart

# Home Assistant
# UI: https://ha.{{DOMAIN}} (or http://{{SERVER_IP}}:8123 locally)
docker logs homeassistant --tail 50

# Portainer (Docker GUI)
# UI: https://portainer.{{DOMAIN}}

# Pending system updates
apt list --upgradable 2>/dev/null

# Failed systemd units
systemctl --failed

# Unbound DNS
systemctl status unbound

# Firewall
sudo ufw status

# Listening ports
sudo ss -tulnp

# Twingate
docker logs twingate-icy-wasp --tail 20

# Auto-deploy pipeline
systemctl status actions.runner.{{GITHUB_ORG}}.lemon-server
cat {{USER_HOME}}/deploy/ports.json
gh run list --repo {{GITHUB_ORG}}/<repo> --limit 5
docker logs <project-name> --tail 50

# Monitoring stack (Loki + Grafana + Promtail)
docker compose -f ~/docker/monitoring/docker-compose.yml ps
curl -sf http://localhost:3100/ready && echo "loki OK"
curl -sf http://localhost:3200/api/health
# Grafana UI: https://grafana.{{DOMAIN}}

# fail2ban SSH jail
sudo fail2ban-client status sshd

# LVM / disk expansion check
sudo vgs && sudo lvs
```

## System Specs

| Field | Value |
|---|---|
| Hardware | Dell OptiPlex 3060, i5-8500T 6-core, 7.6 GiB RAM |
| OS | Ubuntu 24.04.3 LTS |
| Disk | 232.9G SSD — LV 229.83G (~33% used, 69G/226G), VG fully allocated |
| IP | `{{SERVER_IP}}/24` static (`enp1s0`) |
| User | `lemon` (sudo, docker) |
| Timezone | UTC |

## Known Quirks Affecting Status Checks

- **Docker Compose v2 preferred** — `docker compose` (v2.40.3) is available. `docker-compose` v1 also exists at `/usr/local/bin/docker-compose`. Prefer v2 for new work.
- **Home Assistant** runs with `network_mode: host`, compose-managed at `~/docker/homeassistant/docker-compose.yml`. Process shows as `python3 -m homeassistant`.
- **Pi-hole** runs with `network_mode: host`. Compose: `~/docker/pihole/docker-compose.yml`.
- **No known failed systemd units** — previously stale snap/networkd failures were resolved.
- **Swap** is 4G (file-based). If elevated, investigate with `ps aux --sort=-%mem | head 20`.
- **LVM fully allocated** — VG is 229.83G, LV expanded to fill it (was 100G previously). No further expansion available on current disk.
- **Dawarich sidekiq** restart policy is `on-failure` (not `unless-stopped`) — may be intermittently failing.
- **Watchtower** runs daily, only updates containers with label `com.centurylinklabs.watchtower.enable=true`. The opt-in set changes — check labels live (`docker inspect <c> --format '{{index .Config.Labels "com.centurylinklabs.watchtower.enable"}}'`).
- **Weekly cron** (Sundays 02:00 UTC): `docker image prune -f` — removes dangling images only.
</context>

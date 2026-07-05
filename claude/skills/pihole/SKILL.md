---
name: pihole
description: "Use when LAN DNS misbehaves (NXDOMAIN on a new subdomain, sites not resolving), when updating Pi-hole blocklists/gravity, or when managing Unbound on lemon-server"
allowed-tools:
  - Bash
  - Read
  - Write
  - Edit
  - Grep
  - Glob
---

<objective>
Manage Pi-hole and Unbound DNS on lemon-server. Use for DNS blocking, gravity updates,
cache flushing, troubleshooting DNS resolution, and Pi-hole configuration.
</objective>

<context>
## Pi-hole

- **Status: RUNNING**
- **Compose file:** `~/docker/pihole/docker-compose.yml`
- **Network mode:** `host` — required so Pi-hole can reach Unbound at `127.0.0.1:5335`
- **Persistent config:** `~/docker/pihole/etc-pihole/` (gravity.db, pihole.toml, custom hosts, etc.)
- **Version:** Pi-hole v6.0.6 / FTL v6.1 / Web v6.1 / Docker 2025.04.0
- **Upstream DNS:** `127.0.0.1#5335` -> Unbound (recursive resolver with DNSSEC)
- **DNSSEC:** enabled (via Unbound)
- **Listens on:** port 53 (DNS), 8088 (HTTP admin) — all on host network
- **Admin URL:** `https://pihole.{{DOMAIN}}/admin` (primary)
  - Local `http://{{SERVER_IP}}:8088/admin` works for page load but login cookies won't stick (cookie domain is `pihole.{{DOMAIN}}`)
- **webserver.domain:** `pihole.{{DOMAIN}}` in `pihole.toml`
- **Admin password:** `~/docker/pihole/.env` as `PIHOLE_WEBPASSWORD` (mode 600)
- **Custom DNS / hosts:** `~/docker/pihole/etc-pihole/hosts`

### Commands

```bash
# Status
docker exec pihole pihole status

# Update gravity (blocklists)
docker exec pihole pihole updateGravity

# Restart
cd ~/docker/pihole && docker-compose restart

# Reload DNS
docker exec pihole pihole reloaddns

# Logs
docker logs pihole --tail 50
```

## Unbound Recursive Resolver

- **Runs as:** systemd service `unbound`
- **Listens on:** `127.0.0.1:5335`
- **Config:** `/etc/unbound/`
- **DNSSEC:** enabled
- **Check:** `systemctl status unbound`

### History

Unbound was restored 2026-04-07. Root cause of prior failure: `/var/lib/unbound/root.key` was a 0-byte empty file and `/var/log/unbound/` directory didn't exist. Fixed by deleting the empty root.key (systemd helper re-copied from `/usr/share/dns/root.key`) and creating the log directory.

## DNS Cache Flush (Important)

Unbound's negative cache can hold NXDOMAIN responses for up to 30 minutes (SOA minimum TTL). When a new `*.{{DOMAIN}}` subdomain is added to Cloudflare, LAN clients using Pi-hole may get "site can't be reached" even after the record exists publicly.

The server itself is unaffected (uses `1.1.1.1` directly in `/etc/resolv.conf`).

**Fix:**
```bash
sudo unbound-control flush_zone {{DOMAIN}}
docker exec pihole pihole reloaddns
```

**Verify:**
```bash
dig <subdomain>.{{DOMAIN}} @{{SERVER_IP}} +short
```
</context>

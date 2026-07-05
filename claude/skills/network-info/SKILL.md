---
name: network-info
description: "Use when adding a subdomain, when a *.{{DOMAIN}} site doesn't resolve or 502s, when editing Caddy routes or UFW rules, or when debugging the Cloudflare tunnel / LAN DNS on lemon-server"
allowed-tools:
  - Bash
  - Read
  - Write
  - Edit
  - Grep
  - Glob
---

<objective>
Reference for all networking on lemon-server: Cloudflare Tunnel, Caddy reverse proxy, UFW firewall,
network interfaces, and subdomain routing. Use when adding subdomains, debugging connectivity,
modifying firewall rules, or checking tunnel/proxy status.
</objective>

<context>
## Network Interfaces

| Interface | IP | Notes |
|---|---|---|
| `enp1s0` | `{{SERVER_IP}}/24` | Primary wired NIC (static) |
| `wlo1` | -- | WiFi, carrier down |
| `docker0` | `172.17.0.1/16` | Default Docker bridge |

Default gateway: `192.168.1.254` via `enp1s0`.
DNS (host): `1.1.1.1` (Cloudflare) — configured in `/etc/resolv.conf`.

## Cloudflare Tunnel

- **Container:** `cloudflared`, compose project `cloudflare`
- **Compose file:** `~/docker/cloudflare/docker-compose.yml`
- **Network mode:** `host` (can reach localhost services)
- **Config:** Token-based (no local config file). Token in `~/docker/cloudflare/.env` (mode 600) as `TUNNEL_TOKEN`. Routing rules configured exclusively in the Cloudflare Zero Trust dashboard.
- **Tunnel routing:** All subdomains route to `http://localhost:80` (Caddy), which proxies internally.
- **Restart:** `cd ~/docker/cloudflare && docker compose up -d`
- **Logs:** `docker logs cloudflared --tail 50`
- **Metrics:** bound to `127.0.0.1:20241` (compose flag)

**Wildcard IS configured:** `*.{{DOMAIN}}` CNAME + wildcard tunnel route means every subdomain automatically reaches Caddy — no per-subdomain Zero Trust entry. A Caddy block is still required for routing.

## Caddy Reverse Proxy

- **Config:** `/etc/caddy/Caddyfile`
- **Status:** systemd service `caddy`, runs as user `caddy`
- **TLS:** Disabled (`auto_https off`) — Cloudflare tunnel terminates TLS at the edge
- **Listens:** port 80 (HTTP)
- **Reload:** `sudo systemctl reload caddy`
- **Logs:** `sudo journalctl -u caddy -n 50`

### Routes

> **Snapshot — list live with `lemon caddy routes` (or read `/etc/caddy/Caddyfile`) before relying on this.**

| Hostname | Backend | Notes |
|---|---|---|
| `auth.{{DOMAIN}}` | `localhost:10000` + `localhost:9000` | Custom login-portal for default auth flow/direct visits; Authentik for API/OAuth/outpost/static paths |
| `n8n.{{DOMAIN}}` | `localhost:5678` | Bypasses SSO (own auth) |
| `photos.{{DOMAIN}}` | `localhost:2342` | Bypasses SSO (own auth) |
| `ha.{{DOMAIN}}` | `localhost:8123` | HA trusts proxy at 127.0.0.1 |
| `portainer.{{DOMAIN}}` | `localhost:9443` | TLS skip-verify (self-signed) |
| `pihole.{{DOMAIN}}` | `localhost:8088` | Root `/` redirects to `/admin/` |
| `glances.{{DOMAIN}}` | `localhost:61208` | |
| `friendly.{{DOMAIN}}` | `localhost:8080` (API), `localhost:8081` (UI) | Basic auth |
| `hello-world.{{DOMAIN}}` | `localhost:10001` | Auto-deployed test project |
| _(auto-deployed projects)_ | `localhost:10000-10999` | Managed by `~/deploy/deploy.sh` |

## UFW Firewall Rules

| Port | Rule | Notes |
|---|---|---|
| 22/tcp | ALLOW anywhere | SSH |
| 80/tcp | ALLOW anywhere | Caddy |
| 443/tcp | ALLOW anywhere | Caddy/tunnel |
| 53/tcp+udp | ALLOW 192.168.1.0/24 | Pi-hole DNS (LAN only) |
| 123/udp | ALLOW 192.168.1.0/24 | NTP for LAN; deny all others |
| 8123 | DENY | HA (also binds 127.0.0.1) |
| 8088 | DENY | Pi-hole admin (use subdomain) |
| 18555 | DENY | go2rtc WebRTC (binds all interfaces, blocked by UFW) |
| 20241 | DENY | cloudflared metrics (also binds 127.0.0.1) |
| 40000 | DENY | HA debugpy (still active, needs HA UI disable) |
| 1900/udp | DENY | UPnP/SSDP |

Check: `sudo ufw status`

## Adding a New Subdomain

1. Add Caddy block in `/etc/caddy/Caddyfile`
2. `sudo systemctl reload caddy`
3. Nothing needed in Cloudflare — the `*.{{DOMAIN}}` wildcard covers all subdomains
4. If LAN clients get NXDOMAIN, flush Unbound cache:
   ```bash
   sudo unbound-control flush_zone {{DOMAIN}}
   docker exec pihole pihole reloaddns
   ```
5. Verify: `dig <subdomain>.{{DOMAIN}} @{{SERVER_IP}} +short`

## Authentik SSO

- Portal: `auth.{{DOMAIN}}` uses the custom `login-portal` UI; `auth2.{{DOMAIN}}` proxies directly to Authentik native UI.
- Caddy snippet `(authentik)` defined at top of Caddyfile; services use `import authentik` to require login
- Internal forward_auth hop sets `X-Forwarded-Proto: https` (Cloudflare terminates TLS at edge)
- Identity headers: `X-Authentik-Username`, `X-Authentik-Email`, `X-Authentik-Groups`, `X-Authentik-Uid`
- Full details: `/auth` skill

## Docker Port Binding Policy

All containers bind to `127.0.0.1` only — not directly reachable from the network. This prevents Docker from bypassing UFW's iptables rules. Caddy (port 80) is the sole entry point, fronted by Cloudflare Tunnel for TLS.
</context>

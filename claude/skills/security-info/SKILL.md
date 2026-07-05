---
name: security-info
description: "Use when auditing lemon-server security posture, investigating SSH/fail2ban activity or an unexpected listening port, reviewing UFW rules, or locating service credentials"
allowed-tools:
  - Bash
  - Read
  - Write
  - Edit
  - Grep
  - Glob
---

<objective>
Security reference for lemon-server. Use when auditing security posture, checking SSH config,
reviewing firewall rules, locating credentials, or investigating listening ports.
</objective>

<context>
## SSH Hardening

Config files: `/etc/ssh/sshd_config` and `/etc/ssh/sshd_config.d/50-cloud-init.conf`

| Setting | Value |
|---|---|
| `PasswordAuthentication` | no |
| `PermitRootLogin` | no |
| `PubkeyAuthentication` | yes |
| `AllowUsers` | lemon |
| `MaxAuthTries` | 3 |
| `X11Forwarding` | no |
| `ClientAliveInterval` | 300 |
| `ClientAliveCountMax` | 2 |

Only `lemon` can SSH in, key-only.

## fail2ban

- **Config:** `/etc/fail2ban/jail.local`
- **SSH jail:** active
- **Settings:** 5 failures / 10 min = 1-hour initial ban
- **Incremental banning:** ban doubles on repeat offences, max 3 weeks
- **Check:** `sudo fail2ban-client status sshd`

## UFW Firewall

| Port | Rule | Notes |
|---|---|---|
| 22/tcp | ALLOW anywhere | SSH |
| 80/tcp | ALLOW anywhere | Caddy |
| 443/tcp | ALLOW anywhere | Caddy/tunnel |
| 53/tcp+udp | ALLOW 192.168.1.0/24 | Pi-hole DNS (LAN only) |
| 123/udp | ALLOW 192.168.1.0/24 | NTP for LAN; deny all others |
| 8123 | DENY | HA (also binds 127.0.0.1) |
| 8088 | DENY | Pi-hole admin (use subdomain) |
| 18555 | DENY | go2rtc WebRTC |
| 20241 | DENY | cloudflared metrics |
| 40000 | DENY | HA debugpy (disabled — Remote Python Debugger integration removed) |
| 1900/udp | DENY | UPnP/SSDP |

Check: `sudo ufw status`

## Docker Port Binding Policy

All containers bind to `127.0.0.1` only. This prevents Docker from bypassing UFW's iptables rules. Caddy (port 80) is the sole network entry point.

## Credentials Locations

All credentials are in `.env` files (mode 600), never hardcoded in compose files:

| Service | File | Variables |
|---|---|---|
| Dawarich | `~/docker/dawarich/docker/.env` | `DAWARICH_DB_PASSWORD`, `SECRET_KEY_BASE` |
| PhotoPrism | `~/docker/photoprism/.env` | `MARIADB_ROOT_PASSWORD`, `MARIADB_PASSWORD`, `PHOTOPRISM_ADMIN_PASSWORD` |
| Pi-hole | `~/docker/pihole/.env` | `PIHOLE_WEBPASSWORD` |
| Cloudflare | `~/docker/cloudflare/.env` | `TUNNEL_TOKEN` |

**Note:** PhotoPrism `PHOTOPRISM_ADMIN_PASSWORD` may still be placeholder `changeme` (only affects first-init; actual auth is in DB).

## Known Listening Ports (Non-obvious)

| Port | Process | Status |
|---|---|---|
| 20241 | `cloudflared` metrics | Bound to `127.0.0.1` + UFW DENY |
| 18555 | `go2rtc` WebRTC (HA built-in) | Binds all interfaces; UFW DENY. HA ignores `go2rtc.yaml` for this socket. |
| 40000 | `python3` (HA debugpy) | Disabled — Remote Python Debugger integration removed. UFW DENY remains. |

Check: `sudo ss -tulnp`

## Disabled Services

Desktop/unused services disabled on this headless server:
- `bluetooth`, `cups`, `cups-browsed`, `avahi-daemon`
- `ModemManager`, `rtkit-daemon`, `upower`, `udisks2`, `multipathd`
- `lightdm` (stopped + disabled — was running Xorg, wasting ~142 MB)
- `wpa_supplicant` still running (wlo1 carrier down — low risk)

## TODO

- **Remove unused SUID binaries** (low priority): `sudo apt remove --purge xserver-xorg-legacy ppp lightdm`
- **Snapd cleanup** (low priority): `sudo snap remove firefox && sudo apt remove --purge snapd`
</context>

# Pi-hole

DNS-level ad-blocking on `{{SERVER_IP}}`. Uses `network_mode: host` so it can
bind UDP/53. Point your LAN's DNS at this host to use it.

Optional component — only relevant for homelab installs (a VPS without a LAN
to serve has no reason to run Pi-hole).

## URLs

- `https://pihole.{{DOMAIN}}` (proxied via Caddy on `:8088`)
- Admin password from `PIHOLE_WEBPASSWORD` in `parameters.env`.

## Conflicts with systemd-resolved

If `systemd-resolved` is running on this host it will be holding UDP/53. Disable
it before bringing Pi-hole up:

```bash
sudo systemctl disable --now systemd-resolved
sudo rm /etc/resolv.conf && echo "nameserver 1.1.1.1" | sudo tee /etc/resolv.conf
```

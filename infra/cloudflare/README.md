# Cloudflare Tunnel

Egress-only tunnel from this host to Cloudflare's edge — no inbound ports
required on your network or VPS. TLS terminates at Cloudflare.

## Setup

1. In the Cloudflare dashboard: Zero Trust → Networks → Tunnels → Create a
   tunnel. Pick a name (e.g. `lemon-stack`). Save the token.
2. Add a public hostname route: `*.{{DOMAIN}}` → `http://localhost:80`. One
   wildcard covers every current and future subdomain.
3. Put the token into `parameters.env` as `CLOUDFLARE_TUNNEL_TOKEN`. `setup.sh`
   will render `.env` from `.env.template`.
4. Bring up: `docker compose -f docker-compose.yml up -d`.

## DNS

In your Cloudflare DNS panel, create a CNAME `*.{{DOMAIN}}` pointing at the
tunnel's UUID hostname (`<uuid>.cfargotunnel.com`). Cloudflare will offer to
create this automatically when you add the wildcard route above.

# Caddy

Reverse proxy that routes `*.{{DOMAIN}}` to the right local port and integrates
with Authentik for domain-level SSO via `forward_auth`.

## Files

- `docker-compose.yml.template` — Caddy 2 container on host network, mounts
  `Caddyfile` + `snippets/` read-only.
- `Caddyfile.template` — base routes for infrastructure subdomains (auth, bao,
  grafana, n8n, pihole). Auto-deployed app routes are appended by `deploy.sh`.
- `snippets/authentik.snippet.template` — the `(authentik)` named snippet used
  by `import authentik` in protected route blocks.

## Adding an SSO-protected route

```caddy
http://newapp.{{DOMAIN}} {
    import authentik
    reverse_proxy localhost:10042
}
```

## Adding a route that opts out of SSO (own auth, e.g. n8n)

Just omit the `import authentik` line.

## Reload after edits

```bash
docker exec caddy caddy reload --config /etc/caddy/Caddyfile
```

# n8n

Workflow automation. Lives at `https://n8n.{{DOMAIN}}` — n8n has its own auth
(set on first login), so the Caddy block omits `import authentik`.

## Network

Attached to both the default project network and `lemon-internal`. To call
another internal service from a workflow (e.g. tg-notify, notify, an app's
API), use the Docker DNS name: `http://tg-notify:8080/send`, not
`host.docker.internal`.

## Backups

n8n stores everything (workflows, credentials, runs) in a SQLite DB inside the
`n8n_data` volume. `~/backup.sh` dumps this volume as part of the daily Restic
backup.

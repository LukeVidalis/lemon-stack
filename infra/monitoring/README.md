# Monitoring — Loki + Promtail + Grafana

Centralised logs for every Docker container on this host. Promtail uses
Docker socket service discovery — no per-container opt-in needed.

## URLs

`https://grafana.{{DOMAIN}}` — protected by Authentik via the Caddy layer.
Grafana's own login form is disabled; auto-sign-up creates a Grafana user
the first time you visit, populated from `X-Authentik-Username` / `Email`.

## Retention

30 days (set in `loki-config.yaml` → `limits_config.retention_period: 720h`).
Storage is filesystem-backed in the `loki-data` volume. For long-term
retention bump the value or move to S3-compatible object storage.

## Labels exposed for filtering

| Label | Source |
|---|---|
| `container` | Docker container name |
| `image` | Image tag |
| `project` | Compose project (`com.docker.compose.project`) |
| `service` | Compose service (`com.docker.compose.service`) |
| `loki_project` | `loki.project` label — `deploy.sh` sets this to the repo name |
| `environment` | `loki.environment` label — `deploy.sh` sets `production` |

Sample query (auto-deployed app):

```logql
{loki_project="myapp"} |= "ERROR"
```

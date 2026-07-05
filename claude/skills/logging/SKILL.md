---
name: logging
description: "Use when querying container logs via Loki/Grafana (LogQL), when logs are missing for a container, when adjusting retention, or when the monitoring stack (Loki/Promtail/Grafana) misbehaves on lemon-server"
allowed-tools:
  - Bash
  - Read
  - Write
  - Edit
  - Grep
  - Glob
---

<objective>
Reference for the centralized logging stack on lemon-server.
Use when querying logs, managing the monitoring stack, adjusting retention, or troubleshooting logging issues.
</objective>

<context>
## Architecture

```
[All Docker containers]
        |
        v (Docker socket SD — auto-discovers every container)
  [Promtail:9080] — /var/lib/docker/containers read-only mount
        |
        v
  [Loki:3100] — log storage, filesystem backend, 30-day retention
        |
        v
 [Grafana:3200] — dashboards @ https://grafana.{{DOMAIN}}
```

- **Promtail** uses Docker socket service discovery — no per-project config needed. Every container, past and future, is automatically picked up.
- **Loki** is internal-only (no public Caddy route). Grafana proxies all queries.
- **Grafana** is protected by Authentik SSO via forwarded identity headers — login once at `auth.{{DOMAIN}}`.

## Stack Location

| File | Purpose |
|---|---|
| `~/docker/monitoring/docker-compose.yml` | Loki + Promtail + Grafana services |
| `~/docker/monitoring/loki-config.yaml` | Loki config — storage, retention, schema |
| `~/docker/monitoring/promtail-config.yaml` | Promtail config — Docker SD, label mapping |
| `~/docker/monitoring/grafana-provisioning/datasources/loki.yaml` | Auto-provisioned Loki datasource |
| `~/docker/monitoring/grafana-provisioning/dashboards/` | Dashboard provider config |

## Ports

| Service | Host Port | Notes |
|---|---|---|
| Loki | `127.0.0.1:3100` | Internal only — no Caddy route |
| Grafana | `127.0.0.1:3200` | `grafana.{{DOMAIN}}` |
| Promtail | none exposed | Internal to monitoring network |

## Log Labels

Every container gets these labels automatically from Promtail's Docker SD relabeling:

| Label | Source | Example |
|---|---|---|
| `container` | Container name | `friendly-api` |
| `image` | Docker image | `friendly-api:latest` |
| `project` | Compose project (`com.docker.compose.project`) | `friendly` |
| `service` | Compose service (`com.docker.compose.service`) | `api` |
| `loki_project` | `loki.project` Docker label (set by deploy.sh) | `food-planner` |
| `environment` | `loki.environment` Docker label (set by deploy.sh) | `production` |
| `stream` | stdout or stderr | `stdout` |

Auto-deployed projects (via deploy.sh) have `loki_project` and `environment=production` set automatically.

## Common Queries (LogQL)

```logql
# All logs for a deployed project
{loki_project="food-planner"}

# All logs for a compose project
{project="friendly"}

# Specific container
{container="grafana"}

# Errors only across all containers
{container=~".+"} |= "error"

# Logs for a container containing a string
{container="n8n"} |= "ERROR"

# Rate of log lines per minute by container
rate({container=~".+"}[1m])
```

## Common Operations

```bash
# Check stack status
docker compose -f ~/docker/monitoring/docker-compose.yml ps

# Loki readiness
curl -sf http://localhost:3100/ready && echo "ready"

# Grafana health
curl -sf http://localhost:3200/api/health

# Restart the whole stack
cd ~/docker/monitoring && docker compose restart

# Restart a single service
cd ~/docker/monitoring && docker compose restart loki

# View Promtail logs (label discovery, push errors)
docker logs promtail --tail 50

# View Loki logs
docker logs loki --tail 50

# Check what streams Loki has ingested
curl -s http://localhost:3100/loki/api/v1/labels | python3 -m json.tool

# Check label values (e.g. all known containers)
curl -s 'http://localhost:3100/loki/api/v1/label/container/values' | python3 -m json.tool
```

## Retention

- **Reject window:** logs older than 7 days are rejected on ingest (catches old container log backlogs)
- **Retention period:** 30 days — compactor deletes chunks older than 720h
- **Delete request store:** filesystem (configured in loki-config.yaml)
- To change retention, edit `limits_config.retention_period` and `reject_old_samples_max_age` in `~/docker/monitoring/loki-config.yaml`, then `docker compose restart loki`

## Grafana Auth

Grafana uses Authentik's forwarded identity headers:
- `GF_AUTH_PROXY_ENABLED=true`
- Users authenticated via Authentik SSO are auto-signed into Grafana
- New users are auto-assigned Admin role (`GF_USERS_AUTO_ASSIGN_ORG_ROLE=Admin`)
- No separate Grafana password needed

## Troubleshooting

**Promtail not shipping logs for a container:**
- Check Promtail can see the container: `curl -s http://localhost:3100/loki/api/v1/label/container/values`
- Check Promtail logs for errors: `docker logs promtail --tail 50`
- Verify Docker socket is mounted: `docker exec promtail ls /var/run/docker.sock`

**Loki rejecting logs with "timestamp too old":**
- Expected on first start — Promtail tries to ship historical logs beyond the 7-day reject window
- These errors are harmless and stop once Promtail catches up to recent logs

**Grafana showing "No data":**
- Confirm Loki is ready: `curl -sf http://localhost:3100/ready`
- Check the Loki datasource in Grafana: Settings → Data Sources → Loki → Test
- Ensure the LogQL query has valid label selectors

**Stack won't start after config change:**
- Validate Loki config: `docker run --rm -v ~/docker/monitoring/loki-config.yaml:/etc/loki/config.yaml grafana/loki:3.5.0 -config.file=/etc/loki/config.yaml -verify-config`
</context>

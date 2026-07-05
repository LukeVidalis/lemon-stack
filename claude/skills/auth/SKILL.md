---
name: auth
description: "Use when protecting or bypassing SSO for a service, reading X-Authentik-* identity headers in an app, managing users/groups, debugging login redirect loops or 401s behind Caddy forward_auth, or wiring internal server-to-server endpoints"
allowed-tools:
  - Bash
  - Read
  - Edit
---

# Authentik SSO

Centralized login for `*.{{DOMAIN}}`. Log in once at `auth.{{DOMAIN}}`, authenticated across every protected subdomain via a session cookie on the `{{DOMAIN}}` parent domain.

The custom `login-portal` SPA is the **live, always-preferred login UI**: `auth.{{DOMAIN}}`'s Caddy catch-all routes to the portal (`:10000`), while Authentik paths (`/outpost.goauthentik.io/*`, `/api/*`, `/application/*`, `/static/*`, `/media/*`, `/.well-known/*`) proxy to Authentik (`:9000`). If the portal breaks, **fix the portal**, never replace it with Authentik's native UI. `auth2.{{DOMAIN}}` proxies straight to Authentik's native UI and is a last-resort emergency fallback only.

## Architecture

```
browser ──HTTPS──> Cloudflare tunnel ──HTTP──> Caddy:80 ──forward_auth──> Authentik:9000
                                                   │
                                                   └──reverse_proxy──> app backend
```

- **Authentik** runs at `~/docker/authentik/` (container `authentik-server`, `127.0.0.1:9000`)
- **Login portal** runs at `~/docker/login-portal/` (`127.0.0.1:10000`) — routed in production as `auth.{{DOMAIN}}`'s catch-all
- **Caddy** calls `/outpost.goauthentik.io/auth/caddy` on every request to a protected service. 200 → pass through + inject identity headers; 401 → redirect to `auth.{{DOMAIN}}`
- **X-Forwarded-Proto** is hardcoded to `https` in both the forward_auth and outpost handle blocks — Cloudflare terminates TLS at the edge, Caddy sees HTTP internally but Authentik requires HTTPS scheme

## Caddy snippet (already in Caddyfile)

```caddy
(authentik) {
    @goauthentik path /outpost.goauthentik.io/*
    handle @goauthentik {
        reverse_proxy localhost:9000 {
            header_up X-Forwarded-Proto https
        }
    }

    forward_auth localhost:9000 {
        uri /outpost.goauthentik.io/auth/caddy
        copy_headers X-Authentik-Username X-Authentik-Groups X-Authentik-Email X-Authentik-Uid
        header_up X-Forwarded-Proto https
        trusted_proxies private_ranges
    }
}
```

## How services get protected

**Auto-deployed projects** (via `deploy.sh`): SSO is ON by default. No code changes needed. To opt out, add `auth=none` to `deploy.conf`.

**Manually-configured Caddy blocks**: add `import authentik` inside the block:

```caddy
http://myservice.{{DOMAIN}} {
    import authentik
    reverse_proxy localhost:10050
}
```

## Services without SSO (own auth)

These have no `import authentik` in their Caddy blocks:

- `n8n`, `photos` (PhotoPrism), `location` (Dawarich), `ha` (Home Assistant), `portainer`, `pihole`
- `auth.{{DOMAIN}}` itself (direct proxy to Authentik; do not import `authentik` here or you get a redirect loop)
- `auth2.{{DOMAIN}}` — direct proxy to Authentik UI at `:9000`

Note: `glances` was previously unprotected and exposed publicly. Fixed 2026-04-19 — now has `import authentik`.

## Reading user identity in your app

After SSO, Caddy's `forward_auth` copies these headers into the downstream request:

| Header | Value |
|---|---|
| `X-Authentik-Username` | username (e.g. `admin`) |
| `X-Authentik-Email` | email address |
| `X-Authentik-Uid` | Authentik internal user UUID |
| `X-Authentik-Groups` | pipe-separated group names (e.g. `admins\|users`) |

Your app doesn't need any auth library — trust the headers. They're only set by Caddy after a successful Authentik check. Containers bind `127.0.0.1` so header spoofing isn't possible from the public internet.

**C# / ASP.NET — use `AuthentikAuthHandler` from the dotnet-api-template:**
```csharp
var username = Request.Headers["X-Authentik-Username"].ToString();
var email    = Request.Headers["X-Authentik-Email"].ToString();
var uid      = Request.Headers["X-Authentik-Uid"].ToString();
var groups   = Request.Headers["X-Authentik-Groups"].ToString()
                   .Split('|', StringSplitOptions.RemoveEmptyEntries);
```

**Node.js / Express:**
```js
const user = req.headers['x-authentik-username'];
const email = req.headers['x-authentik-email'];
```

## User management

**Preferred:** Use the custom **Admin UI** at `admin.{{DOMAIN}}` (SSO-protected, admins only). It provides:
- User list with search/sort/pagination
- User detail: edit profile, manage groups, toggle app access, view/edit per-app permissions
- Group management with member management
- Invite/create user with group assignment and recovery link generation
- Per-app permissions panel (calls each app's internal `/admin/permissions/:userSub` API)

**Fallback:** Authentik web UI at `auth.{{DOMAIN}}` → Admin interface (top-right menu) for raw Authentik operations.

**Admin accounts:**
- `admin` (admin@{{DOMAIN}})
- `lemon` ({{ADMIN_EMAIL}})

## Bypassing SSO for one service

**Option A — deploy.conf** (pipeline-managed repos): add `auth=none`. Next push will omit `import authentik` from the Caddy block.

**Option B — manual Caddy block**: simply omit `import authentik`. No Authentik config change needed.

## Opting specific paths out of auth

Use Caddy's `handle` ordering to skip auth for public endpoints:

```caddy
http://myapp.{{DOMAIN}} {
    handle /health {
        reverse_proxy localhost:10050
    }
    handle {
        import authentik
        reverse_proxy localhost:10050
    }
}
```

## Troubleshooting

| Symptom | Fix |
|---|---|
| `ak-stage-flow-error` on login | Two causes — check Loki. (A) OOM: `docker logs authentik-server \| grep SIGKILL`, check swap with `free -h`. (B) CSRF: query Loki for `CSRF Failed`. Fix B is in auth.js v19 (`getOrCreateCsrfToken`). See `authentik-sso.md` section 14. |
| Redirect loop at `auth.{{DOMAIN}}` after valid credentials | Ensure unsupported flow stages do not fall back to a portal-intercepted `/if/flow/...` route. Flow Executor calls must use `query=...` not only `next=...`. See `login-portal.md`. |
| 401 on every request despite being logged in | `trusted_proxies private_ranges` missing from forward_auth block |
| App sees no identity headers | `copy_headers` missing in `(authentik)` snippet, or `import authentik` not in Caddy block |
| `X-Forwarded-Proto` errors | Both the `handle @goauthentik` and `forward_auth` blocks need `header_up X-Forwarded-Proto https` |
| Authentik container down | `cd ~/docker/authentik && docker compose ps` — check `authentik-server`, `authentik-db`, `authentik-redis` all running |

## Internal-only endpoints (server-to-server)

Some endpoints need to be callable from the dashboard backend (on localhost) but not from the public internet. The pattern used across all lemon-server apps:

**Do NOT route through Caddy** — that would require forging Authentik headers or OAuth clients per app. Instead, call `127.0.0.1:<port>` directly and authenticate with a shared secret.

```
GET /api/_internal/user-summary?uid=<authentik-uid>
Header: X-Internal-Secret: <INTERNAL_SUMMARY_SECRET>
```

- Secret is validated with constant-time comparison (prevent timing attacks)
- Path prefix `_internal` signals the intent but is not itself a security boundary
- Defense in depth: external requests still go through Caddy → Authentik SSO, AND need the secret
- Secret lives in `~/docker/dashboard/.env` and each source app's `~/docker/<repo>/.env`
- See `/dashboard` skill for the full contract and rotation procedure

**.NET implementation** (copy from macros `api/Common/Internal/InternalAuth.cs`):
```csharp
var expected = Environment.GetEnvironmentVariable("INTERNAL_SUMMARY_SECRET");
var supplied = ctx.HttpContext.Request.Headers["X-Internal-Secret"].ToString();
var a = Encoding.UTF8.GetBytes(supplied);
var b = Encoding.UTF8.GetBytes(expected);
if (a.Length != b.Length || !CryptographicOperations.FixedTimeEquals(a, b))
    return Results.Unauthorized();
```

**Node.js implementation**:
```js
import { timingSafeEqual } from 'crypto';
const a = Buffer.from(req.headers['x-internal-secret'] || '');
const b = Buffer.from(process.env.INTERNAL_SUMMARY_SECRET || '');
if (a.length !== b.length || !timingSafeEqual(a, b)) return res.status(401).json({error:'Unauthorized'});
```

---

## Files

| Path | Purpose |
|---|---|
| `~/docker/authentik/` | Docker Compose stack (server, worker, db, redis) |
| `~/docker/login-portal/` | Custom Authentik login UI; Caddy routes default authentication flow and direct visits here |
| `~/docker/authentik/secrets.env` | DB password, secret key, bootstrap credentials (mode 600) |
| `/etc/caddy/Caddyfile` | `(authentik)` snippet + per-service `import authentik` |
| `~/deploy/deploy.sh` | Auto-injects `import authentik` unless `auth=none` in deploy.conf |
| `~/docker/dashboard/.env` | `INTERNAL_SUMMARY_SECRET` — shared secret for server-to-server calls |

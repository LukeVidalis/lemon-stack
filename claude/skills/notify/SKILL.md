---
name: notify
description: "Use when an app or n8n workflow needs to send a Web Push notification to a user, when adding push subscribe/inbox support to a PWA, or when pushes aren't delivered (VAPID mismatch, missing subscription, 401/503 from /api/_internal/notify/)"
allowed-tools:
  - Bash
  - Read
  - Edit
---

# Notify Skill

`notify-service` is the single source of push notifications for all lemon-server apps. PWAs register their browser push subscription directly via Authentik SSO; backend services and n8n send pushes over the `lemon-internal` Docker network using `X-Internal-Secret`. Every notification is persisted so PWAs can render an in-app inbox.

---

## Architecture

```
PWA (browser)  ──[Authentik SSO]──►  notify.{{DOMAIN}}/subscribe
                                          │ stores PushSubscription row
                                          ▼
n8n / app    ──[lemon-internal]──►  http://notify:8080/api/_internal/notify/
             X-Internal-Secret           │ writes Notification row
                                          │ fan-out via VAPID Web Push
                                          ▼
                                     Browser shows native notification

PWA          ──[Authentik SSO]──►   notify.{{DOMAIN}}/notifications
                                     (in-app inbox, mark read)
```

- **Repo**: `{{GITHUB_ORG}}/notify` → `notify.{{DOMAIN}}`
- **Compose**: `~/docker/notify/`
- **Secrets**: stored in OpenBao (`secret/apps/notify/*`); injected as `~/docker/notify/.env` by deploy.sh — DB creds, `INTERNAL_SUMMARY_SECRET`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`
- **Internal network alias**: `notify` on `lemon-internal` (other apps reach it as `http://notify:8080`)

Built from `dotnet-api-template` — reuses the standard Authentik auth handler and `X-Internal-Secret` filter.

---

## API surface

### Public (no auth)
- `GET /vapid-public-key` → `{ publicKey }` — PWAs fetch this before `pushManager.subscribe()`
- `GET /health`

### User-scoped (Authentik SSO)
- `POST /subscribe` — body `{ endpoint, keys: { p256dh, auth }, userAgent? }` (idempotent on `endpoint`)
- `DELETE /unsubscribe` — body `{ endpoint }`
- `GET /notifications?unreadOnly=true&limit=50` — newest first
- `POST /notifications/{id}/read`
- `POST /notifications/read-all`

### Internal (`X-Internal-Secret`, lemon-internal network)
- `POST /api/_internal/notify/`

```json
{
  "to": "<authentik-uid or username>",
  "sourceApp": "food-planner",
  "title": "Pasta night",
  "body": "Dinner at 7pm",
  "iconUrl": "https://food-planner.{{DOMAIN}}/icon-192.png",
  "badgeUrl": "https://food-planner.{{DOMAIN}}/badge-72.png",
  "clickUrl": "https://food-planner.{{DOMAIN}}/today",
  "actions": [{ "label": "Open", "url": "..." }]
}
→ { "notificationId": "...", "delivered": 2, "failed": 0 }
```

`to` resolves on `UserUid` first then falls back to most-recent `Username`.

---

## Sending from another app

```bash
curl -X POST http://notify:8080/api/_internal/notify/ \
  -H "X-Internal-Secret: $INTERNAL_SUMMARY_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"to":"lemon","sourceApp":"my-app","title":"Hi","body":"Test"}'
```

Requirements on the caller:
1. Caller is on the `lemon-internal` Docker network.
2. `INTERNAL_SUMMARY_SECRET` in caller's `secrets.env` (same value notify-service uses).

For **n8n**: use an HTTP Request node with the same URL/headers. Verify n8n is on `lemon-internal` (`docker inspect n8n | grep lemon-internal`); add it to that network in n8n's compose if missing.

---

## PWA integration (copy into each app)

### Service worker (`public/sw.js`)
```js
self.addEventListener('push', e => {
  const d = e.data.json();
  e.waitUntil(self.registration.showNotification(d.title, {
    body: d.body, icon: d.iconUrl, badge: d.badgeUrl,
    data: { clickUrl: d.clickUrl },
    actions: (d.actions || []).map(a => ({ action: a.url, title: a.label })),
  }));
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = e.action || e.notification.data.clickUrl;
  if (url) e.waitUntil(clients.openWindow(url));
});
```

### Subscribe flow (run after user opt-in)
```js
const reg = await navigator.serviceWorker.register('/sw.js');
if ((await Notification.requestPermission()) !== 'granted') return;

const { publicKey } = await fetch('https://notify.{{DOMAIN}}/vapid-public-key').then(r => r.json());
const sub = await reg.pushManager.subscribe({
  userVisibleOnly: true,
  applicationServerKey: urlBase64ToUint8Array(publicKey),
});
await fetch('https://notify.{{DOMAIN}}/subscribe', {
  method: 'POST', credentials: 'include',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(sub.toJSON()),
});

function urlBase64ToUint8Array(b64) {
  const pad = '='.repeat((4 - b64.length % 4) % 4);
  const s = (b64 + pad).replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(s), c => c.charCodeAt(0));
}
```

### In-app inbox
```js
const items = await fetch('https://notify.{{DOMAIN}}/notifications', {
  credentials: 'include',
}).then(r => r.json());
```

---

## VAPID keys

Stored in OpenBao as `secret/apps/notify/VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT`. Treat the private key as a secret — leaking it lets attackers send pushes to your subscribers.

To regenerate (rare — only after a leak; new keys invalidate every existing subscription, so PWAs will need to re-subscribe):

```bash
cd ~/notify-service/tools/GenVapid
docker run --rm -v "$PWD:/src" -w /src mcr.microsoft.com/dotnet/sdk:9.0 dotnet run
# update keys in OpenBao via bao-set.sh, then redeploy
~/docker/openbao/bao-set.sh notify VAPID_PUBLIC_KEY <new-key>
~/docker/openbao/bao-set.sh notify VAPID_PRIVATE_KEY <new-key>
docker compose -f ~/docker/notify/docker-compose.yml restart api
```

---

## Verification

```bash
# 1. Public VAPID key reachable without auth
curl https://notify.{{DOMAIN}}/vapid-public-key

# 2. Internal /notify reachable from another container
docker exec -it <some-container-on-lemon-internal> sh
curl -X POST http://notify:8080/api/_internal/notify/ \
  -H "X-Internal-Secret: $INTERNAL_SUMMARY_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"to":"lemon","sourceApp":"manual","title":"hello","body":"test"}'

# 3. Inspect DB
docker exec -it notify-db-1 psql -U notify -d notify -c "select count(*) from \"PushSubscriptions\";"
docker exec -it notify-db-1 psql -U notify -d notify -c "select \"Title\", \"DeliveredCount\", \"FailedCount\" from \"Notifications\" order by \"CreatedAt\" desc limit 5;"

# 4. Logs (Loki / Grafana)
# Filter by project="notify" in Grafana
```

Dead subscriptions (returned 410/404 from the push provider) are auto-deleted on the next send attempt.

---

## Common issues

| Symptom | Fix |
|---|---|
| `503` from `/api/_internal/notify/` | `INTERNAL_SUMMARY_SECRET` not set in notify-service env |
| `401` from `/api/_internal/notify/` | Caller's secret doesn't match notify-service's |
| `404 no subscriptions for 'X'` | User hasn't subscribed yet, or `to` mismatches both Uid and Username |
| Push silently fails (delivered: 0, failed: 0) | No subscriptions for that user — check `PushSubscriptions` table |
| `delivered: 0, failed: N` | VAPID keys mismatch between server and what PWA used to subscribe → regenerate **and** ask users to re-subscribe |
| PWA can't reach `/vapid-public-key` | Authentik blocking — check Caddyfile.fragment has `@public` matcher before `import authentik` |

---

## Out of scope (future)

- Topic-based subscriptions (per-app mute settings)
- Email fallback when no push subscriptions exist (would call Resend)
- Native iOS/Android (FCM/APNs) — Web Push covers PWAs installed on Android & iOS 16.4+

---

## Repo

`{{GITHUB_ORG}}/notify` (local: `~/notify-service/`). Standard auto-deploy pipeline; no special handling required.

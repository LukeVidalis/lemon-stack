# notify-service

Centralized Web Push notifications for lemon-server apps. Built from
`dotnet-api-template`. Deploys to `notify.{{DOMAIN}}`.

PWAs subscribe directly via Authentik SSO; backend apps and n8n send pushes
internally over the `lemon-internal` Docker network using `X-Internal-Secret`.
Every notification is persisted so PWAs can render an in-app inbox.

## Setup

```bash
# 1. Generate a VAPID keypair (one-time)
cd tools/GenVapid && dotnet run
# copy the three lines into ~/docker/notify-service/secrets.env on the server

# 2. On lemon-server, create ~/docker/notify-service/secrets.env (mode 600)
#    Use the same INTERNAL_SUMMARY_SECRET as other services.

# 3. Push to {{GITHUB_ORG}}/notify → auto-deploys to notify.{{DOMAIN}}
```

## API

### Public (no auth)

| Method | Path | Purpose |
|---|---|---|
| GET | `/vapid-public-key` | PWAs fetch this before calling `pushManager.subscribe()` |
| GET | `/health` | Liveness probe |

### User-scoped (Authentik SSO via `*.{{DOMAIN}}`)

| Method | Path | Purpose |
|---|---|---|
| POST | `/subscribe` | Register a browser subscription (idempotent on `endpoint`) |
| DELETE | `/unsubscribe` | Remove a subscription by endpoint |
| GET | `/notifications?unreadOnly=true&limit=50` | Inbox (newest first) |
| POST | `/notifications/{id}/read` | Mark one as read |
| POST | `/notifications/read-all` | Mark all as read |

### Internal (`X-Internal-Secret`, `lemon-internal` network)

`POST /api/_internal/notify/`

```json
{
  "to": "<authentik-uid or username>",
  "sourceApp": "food-planner",
  "title": "Dinner reminder",
  "body": "Pasta night — 7pm",
  "iconUrl": "https://food-planner.{{DOMAIN}}/icon-192.png",
  "badgeUrl": "https://food-planner.{{DOMAIN}}/badge-72.png",
  "clickUrl": "https://food-planner.{{DOMAIN}}/today",
  "actions": [
    { "label": "Open", "url": "https://food-planner.{{DOMAIN}}/today" },
    { "label": "Snooze", "url": "https://food-planner.{{DOMAIN}}/snooze" }
  ]
}
```

Returns `{ "notificationId": "...", "delivered": 2, "failed": 0 }`. `to`
resolves on Uid first then falls back to most-recent Username.

## Calling notify-service from another app

```bash
# From any container on the lemon-internal network:
curl -X POST http://notify:8080/api/_internal/notify/ \
  -H "X-Internal-Secret: $INTERNAL_SUMMARY_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"to":"lemon","sourceApp":"my-app","title":"Hello","body":"Test"}'
```

In **n8n**, use an HTTP Request node with the same URL/headers. n8n must be on
the `lemon-internal` Docker network (check its compose).

## PWA integration

### 1. Service worker (`public/sw.js`)

```js
self.addEventListener('push', e => {
  const d = e.data.json();
  e.waitUntil(self.registration.showNotification(d.title, {
    body: d.body,
    icon: d.iconUrl,
    badge: d.badgeUrl,
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

### 2. App-side subscribe flow

```js
async function enablePush() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;

  const reg = await navigator.serviceWorker.register('/sw.js');
  if ((await Notification.requestPermission()) !== 'granted') return;

  const { publicKey } = await fetch('https://notify.{{DOMAIN}}/vapid-public-key')
    .then(r => r.json());

  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(publicKey),
  });

  await fetch('https://notify.{{DOMAIN}}/subscribe', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(sub.toJSON()),
  });
}

function urlBase64ToUint8Array(b64) {
  const pad = '='.repeat((4 - b64.length % 4) % 4);
  const s = (b64 + pad).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(s);
  return Uint8Array.from(raw, c => c.charCodeAt(0));
}
```

### 3. In-app inbox

```js
const items = await fetch('https://notify.{{DOMAIN}}/notifications', {
  credentials: 'include',
}).then(r => r.json());
```

## Local dev

```bash
cd api
dotnet ef migrations add InitialCreate
dotnet run
# http://localhost:5000/health
```

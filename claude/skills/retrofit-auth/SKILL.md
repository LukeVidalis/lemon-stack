---
name: retrofit-auth
description: "Use when adding multi-user support, a login flow, or a logout button to an EXISTING {{GITHUB_ORG}} project behind Authentik SSO (per-user data scoping via X-Authentik-Uid). For brand-new projects use /new-project instead."
allowed-tools:
  - Bash
  - Read
  - Write
  - Edit
  - Grep
  - Glob
  - AskUserQuestion
---

<objective>
Add production-ready auth to an existing lemon-server project that already sits behind Authentik SSO.

Delivers three things:
1. **Multi-user support** — scope data per user via `X-Authentik-Uid` header
2. **Login flow** — `/api/auth/me` endpoint + frontend auth context that resolves identity before rendering
3. **Logout button** — visible in the UI, redirects to `/outpost.goauthentik.io/sign_out`

Must ask the user about repo-specific details before touching any code.
</objective>

<context>
## How Authentik SSO works on lemon-server

All `*.{{DOMAIN}}` subdomains go through Caddy forward auth. By the time a request reaches the app, these headers are already set by Caddy:

| Header | Value |
|---|---|
| `X-Authentik-Username` | e.g. `admin` |
| `X-Authentik-Email` | e.g. `admin@{{DOMAIN}}` |
| `X-Authentik-Uid` | stable UUID — use this as the foreign key |
| `X-Authentik-Groups` | pipe-separated group names |

The app does NOT need any auth library. Headers are injected by Caddy after a successful SSO check. Containers bind `127.0.0.1` so header spoofing is not possible.

**Logout URL:** `/outpost.goauthentik.io/sign_out` — clears the Authentik session across all `*.{{DOMAIN}}` apps.

**Backend `/api/auth/me` pattern:**
Return the identity headers as JSON. If no header present, return 401.

**Frontend auth context pattern:**
On app load, call `/api/auth/me`. If 401, show an error (SSO handles the redirect upstream — a 401 here means something is misconfigured). If 200, store user in context and render the app.
</context>

<process>

## Step 1 — Explore the codebase

Before asking anything, read the repo to understand:
- Tech stack (Next.js, .NET + React, plain React, Vue, etc.)
- Existing auth code (any login pages, auth hooks, protected routes, session handling)
- Database schema (what tables exist, do they have a `user_id` / `owner` column?)
- Where the main layout/nav lives (where to add logout button)
- API structure (REST controllers, route handlers, etc.)

Run these to orient:
```bash
# File tree
find . -name "*.ts" -o -name "*.tsx" -o -name "*.cs" -o -name "*.py" -o -name "*.go" | grep -v node_modules | grep -v .next | grep -v obj | grep -v bin | head -60

# Existing auth
grep -r "auth\|login\|logout\|user\|X-Authentik" --include="*.ts" --include="*.tsx" --include="*.cs" --include="*.py" -l | grep -v node_modules | grep -v .next | head -20

# DB schema
find . -name "*.cs" -o -name "*.sql" -o -name "*.prisma" | grep -v node_modules | grep -v obj | grep -v bin | head -20
```

## Step 2 — Ask the user

Use AskUserQuestion to ask ALL of these in a single call (list them clearly):

1. **Data scoping**: Which data should be scoped per user? (e.g. "each user sees only their own recipes" or "all users share the same data but we track who created what")
2. **User identifier**: Should the app use `X-Authentik-Uid` (stable UUID, recommended) or `X-Authentik-Username` as the foreign key in the database?
3. **Existing data migration**: Are there existing rows in the DB that need to be assigned to a user, or is this a fresh start?
4. **Logout button placement**: Where should the logout button appear? (e.g. top-right of nav, user menu, sidebar footer)
5. **Login loading state**: Should the app show a loading spinner while resolving the user identity, or render immediately and let individual components handle the unauthenticated state?
6. **Anything else**: Any other auth behaviour specific to this app?

## Step 3 — Plan the changes

Based on the exploration and answers, write out a clear plan before touching any code. Cover:
- DB schema changes needed (new column, migration)
- Backend changes (`/api/auth/me`, scoping queries, header reading)
- Frontend changes (auth context/hook, protected route wrapper, logout button)
- Any existing auth code to remove or replace

Show this plan to the user and get confirmation before proceeding.

## Step 4 — Implement

Work through the plan systematically. Typical implementation order:

### Backend — `/api/auth/me`

**.NET (C#):**
```csharp
app.MapGet("/api/auth/me", (HttpContext ctx) => {
    var uid = ctx.Request.Headers["X-Authentik-Uid"].ToString();
    if (string.IsNullOrEmpty(uid)) return Results.Unauthorized();
    return Results.Ok(new {
        uid      = uid,
        username = ctx.Request.Headers["X-Authentik-Username"].ToString(),
        email    = ctx.Request.Headers["X-Authentik-Email"].ToString(),
        groups   = ctx.Request.Headers["X-Authentik-Groups"].ToString()
                       .Split('|', StringSplitOptions.RemoveEmptyEntries)
    });
});
```

**Node.js / Express:**
```js
app.get('/api/auth/me', (req, res) => {
  const uid = req.headers['x-authentik-uid'];
  if (!uid) return res.status(401).json({ error: 'Not authenticated' });
  res.json({
    uid,
    username: req.headers['x-authentik-username'],
    email:    req.headers['x-authentik-email'],
    groups:   (req.headers['x-authentik-groups'] || '').split('|').filter(Boolean),
  });
});
```

**Next.js (App Router):**
```ts
// app/api/auth/me/route.ts
export async function GET(req: NextRequest) {
  const uid = req.headers.get('x-authentik-uid');
  if (!uid) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  return NextResponse.json({
    uid,
    username: req.headers.get('x-authentik-username'),
    email:    req.headers.get('x-authentik-email'),
    groups:   (req.headers.get('x-authentik-groups') ?? '').split('|').filter(Boolean),
  });
}
```

### Backend — scoping data per user

Add `owner_uid TEXT NOT NULL` (or equivalent) to any tables that need per-user data. Filter all queries by the uid from the request header.

**.NET example:**
```csharp
var uid = ctx.Request.Headers["X-Authentik-Uid"].ToString();
var items = await db.Items.Where(i => i.OwnerUid == uid).ToListAsync();
```

### Frontend — auth context

```tsx
// contexts/AuthContext.tsx
type User = { uid: string; username: string; email: string; groups: string[] };
const AuthContext = createContext<User | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/auth/me')
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(setUser)
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="...">Loading…</div>;
  return <AuthContext.Provider value={user}>{children}</AuthContext.Provider>;
}

export const useUser = () => useContext(AuthContext);
```

### Frontend — logout button

```tsx
<button onClick={() => window.location.href = '/outpost.goauthentik.io/sign_out'}>
  Log out
</button>
```

Or as a plain link (no JS needed):
```tsx
<a href="/outpost.goauthentik.io/sign_out">Log out</a>
```

### Removing old auth code

If the repo has an existing login page, `/api/auth/login` endpoint, or JWT cookie logic that duplicates what Authentik already provides upstream — remove it. The SSO handles all of that. Keep only `/api/auth/me` (identity) and the logout redirect.

## Step 5 — DB migration

If schema changes were made, generate and run the migration:

**.NET EF Core:**
```bash
dotnet ef migrations add AddOwnerUid
dotnet ef database update
```

**Prisma:**
```bash
npx prisma migrate dev --name add_owner_uid
```

## Step 6 — Verify

```bash
# Check the app builds
# .NET:
dotnet build

# Next.js / Node:
npm run build

# Run type checks if applicable
npm run typecheck 2>/dev/null || true
```

## Step 7 — Commit and PR

```bash
git add -A
git commit -m "Add multi-user auth: /api/auth/me, per-user data scoping, logout button"
git push origin main
```

Then create a PR:
```bash
REPO=$(gh repo view --json nameWithOwner -q .nameWithOwner)
PR_URL=$(gh pr create \
  --title "Add multi-user auth: login flow, per-user data scoping, logout button" \
  --body "$(cat <<'EOF'
## Summary
- Added `GET /api/auth/me` endpoint reading Authentik identity headers
- Scoped data per user via `X-Authentik-Uid` foreign key
- Added logout button redirecting to `/outpost.goauthentik.io/sign_out`
- Removed old auth code superseded by Authentik SSO

## Auth choices
<!-- filled in by agent based on user answers in Step 2 -->

## Test plan
- [ ] Log in via `auth.{{DOMAIN}}` and confirm identity loads correctly
- [ ] Confirm each user only sees their own data
- [ ] Confirm logout clears the session and redirects to login

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)" \
  2>&1)
echo "$PR_URL"
```

Capture the PR URL from the output — needed for the Plane update below.

## Step 8 — Update Plane ticket

Use the `/plane` skill (Mode 6) — pass it the issue name, the PR URL, and a bullet summary of what changed. It will post the comment and move the issue to Done.

Example invocation:
> "Post to plane: issue is 'food-planner: fix auth header', PR is <PR_URL>, summary: added /api/auth/me, scoped data by X-Authentik-Uid, added logout button, removed Remote-User code"

If no matching Plane ticket is found, skip silently and note it in the Step 9 summary.

## Step 9 — Summary

Report back:
- What was changed and why
- PR URL
- Plane ticket updated (or not found)
- Any follow-up the user should be aware of (e.g. existing data that needs manual uid assignment, env vars needed)

</process>

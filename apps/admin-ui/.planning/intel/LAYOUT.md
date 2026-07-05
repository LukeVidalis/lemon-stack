---
updated_at: 2026-05-17T12:00:00Z
generated_by: intel-updater
---

# Layout

```
admin-ui/
  CLAUDE.md                   # Pointer to .ai/context/ (shared with Copilot)
  Caddyfile.fragment          # Custom routing: /api/* → API, /* → web
  deploy.conf                 # subdomain = admin
  docker-compose.yml          # api + web services; joins external authentik_default net
  .env                        # LOCAL secrets (gitignored) — see GOTCHAS
  .ai/
    context/
      README.md               # Entry point for AI agents (Claude + Copilot)
      docs/architecture.md    # Original shared architecture doc
      docs/development.md     # Dev commands
      skills/change-checklist.md
  api/                        # Express service (Node 22, ESM)
    Dockerfile                # node:22-alpine, npm ci --omit=dev
    src/
      index.js                # Express bootstrap, route mounting, error middleware
      authentik.js            # All Authentik REST calls (axios client w/ bearer token)
      app-registry.js         # Loads/filters config/apps.json on import
      setup.js                # ensureProjectInfrastructure — provisions Authentik per-project
      resend.js               # Invite email via Resend API
      config/
        apps.json             # Registered ecosystem apps (slug, name, baseUrl, icon)
      routes/
        me.js                 # GET /api/me — echoes X-Authentik-* headers
        users.js              # CRUD on Authentik users
        groups.js             # CRUD on Authentik groups
        apps.js               # List Authentik applications (annotated with admin_api flag)
        permissions.js        # Proxy to <app.baseUrl>/admin/permissions with X-Admin-Secret
        projects.js           # Read ports.json → list deployed projects
        internal.js           # /api/_internal/user-summary — dashboard contract
  web/                        # React SPA (Vite)
    Dockerfile                # 2-stage: build with Node, serve via nginx:alpine
    nginx.conf                # SPA fallback (try_files → /index.html)
    vite.config.js
    tailwind.config.js
    src/
      main.jsx                # React root + BrowserRouter
      App.jsx                 # All routes (Users, UserDetail, Groups, Invite)
      api.js                  # Single fetch wrapper + api.get/post/put/delete
      index.css               # Tailwind entry
      pages/
        Users.jsx             # Default route /
        UserDetail.jsx        # /users/:id
        Groups.jsx            # /groups
        Invite.jsx            # /invite
      components/
        Layout.jsx            # Shell (nav, outlet)
        UserTable.jsx, SearchBar.jsx, Modal.jsx, GroupBadge.jsx
        AppAccessGrid.jsx     # Toggle app access per user
        AppPermEditor.jsx     # Edit per-app permission grants
  .github/workflows/
    deploy.yml                # Reuses {{GITHUB_ORG}}/.github deploy workflow
    copilot-setup-steps.yml
```

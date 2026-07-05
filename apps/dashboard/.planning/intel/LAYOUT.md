---
updated_at: 2026-05-18T00:00:00Z
generated_by: intel-updater
---

# Layout

```
dashboard/
  api/                             # .NET 9 minimal API
    Program.cs                     # DI wiring, CORS, middleware, route registration (MapAggregate, MapServices)
    Dashboard.csproj               # net9.0; no extra NuGet packages beyond SDK
    data-sources.json              # Registry of data cards — edit to add/remove/disable sources
    services-config.json           # Static services list + slug overrides for the services grid
    appsettings.json               # Minimal default config (no DB connection strings)
    Dockerfile                     # sdk:9.0 build → aspnet:9.0 runtime; exposes :8080
    Common/
      Auth/
        AuthentikAuthHandler.cs    # Maps X-Authentik-* request headers → ClaimsPrincipal
    Features/
      Aggregate/
        AggregateEndpoints.cs      # /api/me + /api/aggregate; parallel fan-out, 1.5s timeout
        DataSourceRegistry.cs      # Singleton; loads data-sources.json at startup
      Services/
        ServicesEndpoints.cs       # /api/services
        ServicesRegistry.cs        # Singleton; merges ports.json (dynamic) + services-config.json (static)

  web/                             # React 19 + Vite + Tailwind SPA
    Dockerfile                     # node:22-alpine build → nginx:alpine runtime
    nginx.conf                     # SPA routing (try_files fallback)
    package.json                   # React 19, Vite 6, Tailwind 3, TypeScript 5.7
    vite.config.ts                 # Vite config
    src/
      api.ts                       # All fetch calls: fetchMe, fetchAggregate, fetchServices + shared types
      App.tsx                      # Root; polls every 60 s; renders cards + services grid
      main.tsx                     # React entry point
      index.css                    # Tailwind base styles
      components/
        SourceCard.tsx             # Per-source card (ok / empty / timeout / error states)
        ServiceGrid.tsx            # Services link grid (categories)

  docker-compose.yml               # Two services: api (network_mode: host) + web (port 10012:80)
  Caddyfile.fragment               # /api/* → API_PORT; /* → WEB_PORT
  CLAUDE.md                        # Project-specific decisions and operational notes
  README.md                        # Data source contract + how to add a source
  .github/workflows/deploy.yml    # Delegates to {{GITHUB_ORG}} shared deploy workflow
```

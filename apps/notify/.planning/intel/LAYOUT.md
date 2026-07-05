---
updated_at: 2026-05-24T00:00:00Z
generated_by: intel-updater
---

# Layout

```
notify/
  api/                              # .NET 10 ASP.NET Core project (NotifyService)
    Program.cs                      # All DI wiring, middleware pipeline, startup migrations
    NotifyService.csproj            # Project manifest; packages ref Directory.Packages.props
    appsettings.json                # Defaults: Cors (empty → AllowAny), RateLimiting, Otel
    appsettings.Development.json    # Points ConnectionStrings:Default at localhost:5432
    Common/
      Auth/
        AuthentikAuthHandler.cs     # Maps X-Authentik-* headers → ClaimsPrincipal
      Internal/
        InternalAuth.cs             # RequireInternalSecret() endpoint filter (constant-time)
      Middleware/
        CorrelationMiddleware.cs    # Adds requestId to every response / log scope
        ExceptionMiddleware.cs      # Global exception → ProblemDetails
    Data/
      AppDbContext.cs               # EF Core DbContext; indexes on UserUid and Endpoint
      Entities.cs                   # PushSubscription, Notification, NotificationAction
    Features/
      Notifications/
        NotificationEndpoints.cs    # GET /notifications, POST /{id}/read, POST /read-all
      Subscriptions/
        SubscriptionEndpoints.cs    # GET /vapid-public-key, POST /subscribe, DELETE /unsubscribe
      Internal/
        SendEndpoints.cs            # POST /api/_internal/notify/ — fan-out push to user
        SubscribeEndpoints.cs       # POST/DELETE /api/_internal/subscribe/ — cross-origin enroll
        UserSummaryEndpoints.cs     # GET /api/_internal/user-summary (stub — returns TODO)
    Migrations/
      20260501141641_InitialCreate.cs  # Single migration; hand-editable
      AppDbContextModelSnapshot.cs     # EF snapshot — keep in sync with migrations
    Services/
      PushSender.cs                 # Fan-out + dead-subscription pruning logic

  tools/
    GenVapid/                       # dotnet run → prints VAPID keypair (one-time setup)

  scripts/
    smoke-test.sh                   # Called by CI after deploy — polls /health

  docker-compose.yml                # api service only; db is postgres-shared on lemon-internal
  Caddyfile.fragment                # Custom routing: public paths + inline Authentik forward_auth
  deploy.conf                       # auth=none (Caddyfile.fragment owns auth)
  .env.example                      # Env var template for ~/docker/notify/.env on server
  Directory.Build.props             # net10.0, nullable, implicit usings; NuGetAuditSuppress for OTel
  Directory.Packages.props          # Central package versioning
```

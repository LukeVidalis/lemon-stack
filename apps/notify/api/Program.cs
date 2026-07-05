using System.Net;
using System.Threading.RateLimiting;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;
using OpenTelemetry.Metrics;
using OpenTelemetry.Resources;
using OpenTelemetry.Trace;
using NotifyService.Common.Auth;
using NotifyService.Common.Internal;
using NotifyService.Common.Middleware;
using NotifyService.Data;
using NotifyService.Features.Internal;
using NotifyService.Features.Notifications;
using NotifyService.Features.Subscriptions;
using NotifyService.Services;
using WebPush;

var builder = WebApplication.CreateBuilder(args);

// 4MB default. Raise per-endpoint with [RequestSizeLimit(n)] / DisableRequestSizeLimit.
builder.WebHost.ConfigureKestrel(o => o.Limits.MaxRequestBodySize = 4 * 1024 * 1024);

// Caddy fronts every request from 127.0.0.1. Trust only the loopback proxy so
// X-Forwarded-For / X-Forwarded-Proto are honored — otherwise logs see localhost.
builder.Services.Configure<ForwardedHeadersOptions>(o =>
{
    o.ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto;
    o.KnownProxies.Clear();
    o.KnownProxies.Add(IPAddress.Loopback);
    o.KnownProxies.Add(IPAddress.IPv6Loopback);
    o.KnownIPNetworks.Clear();
});

builder.Logging.ClearProviders();
if (builder.Environment.IsDevelopment())
{
    builder.Logging.AddSimpleConsole(o =>
    {
        o.SingleLine = true;
        o.IncludeScopes = true;
        o.TimestampFormat = "HH:mm:ss ";
    });
}
else
{
    // Loki + LogQL `| json` filtering works on real fields once logs are structured.
    builder.Logging.AddJsonConsole(o =>
    {
        o.IncludeScopes = true;
        o.JsonWriterOptions = new() { Indented = false };
        o.TimestampFormat = "yyyy-MM-ddTHH:mm:ss.fffZ";
        o.UseUtcTimestamp = true;
    });
}

var connectionString = builder.Configuration.GetConnectionString("Default")
    ?? throw new InvalidOperationException("ConnectionStrings:Default is required.");

// Pooled context + Npgsql connection-resiliency. EnableRetryOnFailure means
// user-initiated transactions need an execution strategy (db.Database.CreateExecutionStrategy()).
builder.Services.AddDbContextPool<AppDbContext>(opts =>
    opts.UseNpgsql(connectionString, npg => npg.EnableRetryOnFailure(
        maxRetryCount: 5,
        maxRetryDelay: TimeSpan.FromSeconds(10),
        errorCodesToAdd: null)));

builder.Services.AddAuthentication("Authentik")
    .AddScheme<AuthenticationSchemeOptions, AuthentikAuthHandler>("Authentik", null);
builder.Services.AddAuthorization();

builder.Services.ConfigureHttpJsonOptions(o =>
{
    o.SerializerOptions.PropertyNamingPolicy = System.Text.Json.JsonNamingPolicy.CamelCase;
    o.SerializerOptions.Converters.Add(new System.Text.Json.Serialization.JsonStringEnumConverter());
});

// OpenTelemetry — console exporter in dev when no endpoint; OTLP when set.
// No collector on lemon-server yet (no Tempo/Prometheus); revisit when one lands.
var otlpEndpoint = builder.Configuration["Otel:Endpoint"];
builder.Services.AddOpenTelemetry()
    .ConfigureResource(r => r.AddService(serviceName: builder.Environment.ApplicationName))
    .WithTracing(t =>
    {
        t.AddAspNetCoreInstrumentation()
         .AddHttpClientInstrumentation()
         .AddEntityFrameworkCoreInstrumentation();
        if (!string.IsNullOrEmpty(otlpEndpoint))
            t.AddOtlpExporter(o => o.Endpoint = new Uri(otlpEndpoint));
        else if (builder.Environment.IsDevelopment())
            t.AddConsoleExporter();
    })
    .WithMetrics(m =>
    {
        m.AddAspNetCoreInstrumentation()
         .AddHttpClientInstrumentation()
         .AddRuntimeInstrumentation();
        if (!string.IsNullOrEmpty(otlpEndpoint))
            m.AddOtlpExporter(o => o.Endpoint = new Uri(otlpEndpoint));
    });

builder.Services.AddOpenApi();

// Per-IP/user fixed window. /api/_internal/* is exempt because trusted lemon
// apps call it in legitimate bursts (push fan-out). Health endpoints exempt too.
var rlPermit = builder.Configuration.GetValue("RateLimiting:PermitLimit", 200);
var rlWindowSeconds = builder.Configuration.GetValue("RateLimiting:WindowSeconds", 10);
builder.Services.AddRateLimiter(options =>
{
    options.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
    options.GlobalLimiter = PartitionedRateLimiter.Create<HttpContext, string>(ctx =>
    {
        var path = ctx.Request.Path.Value ?? string.Empty;
        if (path.StartsWith("/api/_internal/", StringComparison.OrdinalIgnoreCase) ||
            path.StartsWith("/health", StringComparison.OrdinalIgnoreCase))
            return RateLimitPartition.GetNoLimiter("exempt");

        var key = ctx.Request.Headers["X-Authentik-Username"].ToString();
        if (string.IsNullOrEmpty(key))
            key = ctx.Connection.RemoteIpAddress?.ToString() ?? "unknown";
        return RateLimitPartition.GetFixedWindowLimiter(key, _ => new FixedWindowRateLimiterOptions
        {
            PermitLimit = rlPermit,
            Window = TimeSpan.FromSeconds(rlWindowSeconds),
            QueueLimit = 0,
            AutoReplenishment = true,
        });
    });
});

var allowedOrigins = builder.Configuration.GetSection("Cors:AllowedOrigins").Get<string[]>() ?? [];
builder.Services.AddCors(options =>
{
    options.AddDefaultPolicy(policy =>
    {
        if (allowedOrigins.Length > 0)
            policy.WithOrigins(allowedOrigins).AllowAnyHeader().AllowAnyMethod().AllowCredentials();
        else
            // notify-service is intentionally multi-origin (shared PWA backend).
            // Configure Cors:AllowedOrigins per environment; AllowAnyOrigin is the dev fallback.
            policy.AllowAnyOrigin().AllowAnyHeader().AllowAnyMethod();
    });
});

// Web Push (VAPID)
var vapidPublic = Environment.GetEnvironmentVariable("VAPID_PUBLIC_KEY");
var vapidPrivate = Environment.GetEnvironmentVariable("VAPID_PRIVATE_KEY");
var vapidSubject = Environment.GetEnvironmentVariable("VAPID_SUBJECT") ?? "mailto:admin@{{DOMAIN}}";

if (string.IsNullOrEmpty(vapidPublic) || string.IsNullOrEmpty(vapidPrivate))
{
    Console.WriteLine("[notify] WARNING: VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY not set — push send will fail until configured.");
    vapidPublic ??= "missing";
    vapidPrivate ??= "missing";
}

builder.Services.AddSingleton(new VapidDetails(vapidSubject, vapidPublic, vapidPrivate));
builder.Services.AddSingleton<WebPushClient>();
builder.Services.AddScoped<PushSender>();

var app = builder.Build();

// First in the pipeline so every later log line carries requestId.
app.UseMiddleware<CorrelationMiddleware>();
app.UseMiddleware<ExceptionMiddleware>();

if (app.Environment.IsDevelopment())
{
    app.MapOpenApi();
}

app.UseForwardedHeaders();
app.UseCors();
app.UseAuthentication();
app.UseAuthorization();
app.UseRateLimiter();

app.MapGet("/health", () => Results.Ok(new { status = "ok", time = DateTime.UtcNow }));

app.MapSubscriptionEndpoints();
app.MapNotificationEndpoints();
app.MapInternalSendEndpoints();
app.MapInternalSubscribeEndpoints();
app.MapInternalUserSummary();

if (string.IsNullOrEmpty(Environment.GetEnvironmentVariable(InternalAuth.EnvVar)))
    app.Logger.LogWarning(
        "{EnvVar} not set — internal /notify endpoint will return 503.",
        InternalAuth.EnvVar);

using (var scope = app.Services.CreateScope())
{
    var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
    var logger = scope.ServiceProvider.GetRequiredService<ILogger<Program>>();
    try
    {
        logger.LogInformation("Running database migrations...");
        await db.Database.MigrateAsync();
    }
    catch (Exception ex)
    {
        logger.LogCritical(ex, "MIGRATION_FAILED");
        throw;
    }
}

app.Run();

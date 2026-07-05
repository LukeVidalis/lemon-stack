using System.Security.Claims;
using System.Threading.RateLimiting;
using Dashboard.Common.Auth;
using Dashboard.Common.Json;
using Dashboard.Common.SourceClient;
using Dashboard.Features.Aggregate;
using Dashboard.Features.BuildInfo;
using Dashboard.Features.Health;
using Dashboard.Features.Prefs;
using Dashboard.Features.Services;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.Extensions.Http.Resilience;
using Polly;

var builder = WebApplication.CreateBuilder(args);

builder.Logging.ClearProviders();
builder.Logging.AddSimpleConsole(o =>
{
    o.SingleLine = true;
    o.IncludeScopes = false;
    o.TimestampFormat = "HH:mm:ss ";
});

builder.Services.AddAuthentication("Authentik")
    .AddScheme<AuthenticationSchemeOptions, AuthentikAuthHandler>("Authentik", null);
builder.Services.AddAuthorization();

builder.Services.AddSingleton<DataSourceRegistry>();
builder.Services.AddSingleton<ServicesRegistry>();
builder.Services.AddSingleton<SourceClient>();
builder.Services.AddSingleton<PrefsStore>();

builder.Services.AddMemoryCache();

builder.Services.AddHttpClient("source")
    .ConfigurePrimaryHttpMessageHandler(() => new SocketsHttpHandler
    {
        PooledConnectionLifetime = TimeSpan.FromMinutes(2),
        MaxConnectionsPerServer = 20,
        ConnectTimeout = TimeSpan.FromSeconds(5),
    })
    .AddResilienceHandler("source-retry", pipeline =>
    {
        pipeline.AddRetry(new HttpRetryStrategyOptions
        {
            MaxRetryAttempts = 1,
            BackoffType = DelayBackoffType.Constant,
            Delay = TimeSpan.Zero,
            UseJitter = false,
        });
    });

builder.Services.AddRateLimiter(o =>
{
    o.AddPolicy("aggregate", ctx =>
    {
        var uid = ctx.User?.FindFirstValue(ClaimTypes.NameIdentifier)
                  ?? ctx.Connection.RemoteIpAddress?.ToString()
                  ?? "unknown";
        return RateLimitPartition.GetFixedWindowLimiter(uid, _ => new FixedWindowRateLimiterOptions
        {
            PermitLimit = 30,
            Window = TimeSpan.FromSeconds(10),
            QueueLimit = 0,
        });
    });
    o.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
});

builder.Services.ConfigureHttpJsonOptions(o =>
{
    o.SerializerOptions.TypeInfoResolverChain.Insert(0, DashboardJsonContext.Default);
});

var app = builder.Build();

app.UseAuthentication();
app.UseAuthorization();
app.UseRateLimiter();

app.MapHealthEndpoints();
app.MapAggregate();
app.MapAggregateStream();
app.MapServices();
app.MapPrefs();
app.MapBuildInfo();

if (string.IsNullOrEmpty(Environment.GetEnvironmentVariable("INTERNAL_SUMMARY_SECRET")))
    app.Logger.LogWarning("INTERNAL_SUMMARY_SECRET not set — sources will receive no auth header.");

_ = app.Services.GetRequiredService<DataSourceRegistry>();
_ = app.Services.GetRequiredService<ServicesRegistry>();
app.Services.GetRequiredService<PrefsStore>().InitSchema();

app.Run();

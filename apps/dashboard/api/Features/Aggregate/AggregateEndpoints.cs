using System.Security.Claims;
using System.Text.Json;
using Dashboard.Common.SourceClient;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.Extensions.Caching.Memory;

namespace Dashboard.Features.Aggregate;

public static class AggregateEndpoints
{
    public static IEndpointRouteBuilder MapAggregate(this IEndpointRouteBuilder app)
    {
        app.MapGet("/api/me", [Authorize] (ClaimsPrincipal user) =>
        {
            var uid = user.FindFirstValue(ClaimTypes.NameIdentifier);
            var username = user.Identity?.Name;
            var email = user.FindFirstValue(ClaimTypes.Email);
            var groups = user.FindAll(ClaimTypes.Role).Select(c => c.Value).ToArray();
            return Results.Ok(new Me(uid, username, email, groups));
        });

        app.MapGet("/api/aggregate", [Authorize] async (
            ClaimsPrincipal user,
            DataSourceRegistry registry,
            SourceClient sourceClient,
            IMemoryCache cache,
            IHostApplicationLifetime lifetime,
            CancellationToken ct) =>
        {
            var uid = user.FindFirstValue(ClaimTypes.NameIdentifier);
            if (string.IsNullOrEmpty(uid))
                return Results.Problem("Authentik UID claim missing", statusCode: 401);

            using var linkedCts = CancellationTokenSource.CreateLinkedTokenSource(ct, lifetime.ApplicationStopping);
            var linkedToken = linkedCts.Token;
            var results = await Task.WhenAll(registry.Sources.Select(s =>
                sourceClient.FetchWithCacheAsync(s, uid, cache, linkedToken)));

            return Results.Ok(new AggregateResponse(uid, results));
        }).RequireRateLimiting("aggregate");

        return app;
    }
}

public record Me(string? Uid, string? Username, string? Email, string[] Groups);

public record AggregateResponse(string Uid, IReadOnlyList<SourceResult> Sources);

public record SourceResult(
    string Slug,
    string Name,
    string? Icon,
    string? DeepLink,
    string Status,
    JsonElement? Data,
    string? Error,
    int LatencyMs,
    SourceFetchError ErrorKind = SourceFetchError.None);

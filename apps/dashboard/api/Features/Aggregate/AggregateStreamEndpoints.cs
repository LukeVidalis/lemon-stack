using System.Security.Claims;
using System.Text.Json;
using System.Threading.Channels;
using Dashboard.Common.Json;
using Dashboard.Common.SourceClient;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.Extensions.Caching.Memory;

namespace Dashboard.Features.Aggregate;

public static class AggregateStreamEndpoints
{
    public static IEndpointRouteBuilder MapAggregateStream(this IEndpointRouteBuilder app)
    {
        app.MapGet("/api/aggregate/stream", [Authorize] async (
            HttpContext httpCtx,
            ClaimsPrincipal user,
            DataSourceRegistry registry,
            SourceClient sourceClient,
            IMemoryCache cache,
            IHostApplicationLifetime lifetime,
            CancellationToken requestCt) =>
        {
            var uid = user.FindFirstValue(ClaimTypes.NameIdentifier);
            if (string.IsNullOrEmpty(uid))
            {
                httpCtx.Response.StatusCode = StatusCodes.Status401Unauthorized;
                await httpCtx.Response.WriteAsync("UID missing", requestCt);
                return;
            }

            httpCtx.Response.Headers.ContentType = "text/event-stream";
            httpCtx.Response.Headers.CacheControl = "no-cache";
            httpCtx.Response.Headers.Append("X-Accel-Buffering", "no");

            using var linkedCts = CancellationTokenSource.CreateLinkedTokenSource(requestCt, lifetime.ApplicationStopping);
            var ct = linkedCts.Token;
            var channel = Channel.CreateUnbounded<SourceResult>();

            var fanout = registry.Sources.Select(async src =>
            {
                try
                {
                    var result = await sourceClient.FetchWithCacheAsync(src, uid, cache, ct);
                    await channel.Writer.WriteAsync(result, ct);
                }
                catch (OperationCanceledException) when (ct.IsCancellationRequested)
                {
                }
                catch (Exception ex)
                {
                    channel.Writer.TryWrite(new SourceResult(src.Slug, src.Name, src.Icon, src.DeepLink,
                        "error", null, ex.GetType().Name, 0, SourceFetchError.HttpError));
                }
            }).ToArray();

            _ = Task.WhenAll(fanout).ContinueWith(_ => channel.Writer.TryComplete(), CancellationToken.None);

            try
            {
                await foreach (var result in channel.Reader.ReadAllAsync(ct))
                {
                    var json = JsonSerializer.Serialize(result, DashboardJsonContext.Default.SourceResult);
                    await httpCtx.Response.WriteAsync($"event: source\ndata: {json}\n\n", ct);
                    await httpCtx.Response.Body.FlushAsync(ct);
                }

                await httpCtx.Response.WriteAsync($"event: done\ndata: {{\"uid\":\"{uid}\"}}\n\n", ct);
                await httpCtx.Response.Body.FlushAsync(ct);
            }
            catch (OperationCanceledException) when (ct.IsCancellationRequested)
            {
            }
        }).RequireRateLimiting("aggregate");

        app.MapGet("/api/aggregate/source/{slug}", [Authorize] async (
            string slug,
            ClaimsPrincipal user,
            DataSourceRegistry registry,
            SourceClient sourceClient,
            IMemoryCache cache,
            CancellationToken ct) =>
        {
            var uid = user.FindFirstValue(ClaimTypes.NameIdentifier);
            if (string.IsNullOrEmpty(uid))
                return Results.Problem("UID missing", statusCode: 401);

            var src = registry.Sources.FirstOrDefault(s => string.Equals(s.Slug, slug, StringComparison.OrdinalIgnoreCase));
            if (src is null)
                return Results.NotFound(new { error = "source not found" });

            var result = await sourceClient.FetchAsync(src, uid, ct);
            sourceClient.UpdateCache(cache, src.Slug, uid, result);
            return Results.Ok(result);
        }).RequireRateLimiting("aggregate");

        return app;
    }
}

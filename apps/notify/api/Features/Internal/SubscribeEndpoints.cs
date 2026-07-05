using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using NotifyService.Common.Internal;
using NotifyService.Data;

namespace NotifyService.Features.Internal;

/// <summary>
/// Internal endpoint allowing trusted services to register push subscriptions
/// on behalf of a user. Used when the subscription originates cross-origin
/// (e.g. from friendly.{{DOMAIN}}) and the browser cannot authenticate
/// directly to notify via Authentik SSO cookies.
/// </summary>
public static class SubscribeEndpoints
{
    public static IEndpointRouteBuilder MapInternalSubscribeEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/_internal/subscribe").RequireInternalSecret();

        group.MapPost("/", async (InternalSubscribeRequest req, AppDbContext db) =>
        {
            if (string.IsNullOrEmpty(req.Username))
                return Results.BadRequest(new { error = "username is required" });
            if (string.IsNullOrEmpty(req.Endpoint) ||
                string.IsNullOrEmpty(req.Keys?.P256dh) ||
                string.IsNullOrEmpty(req.Keys?.Auth))
                return Results.BadRequest(new { error = "endpoint and keys.p256dh and keys.auth are required" });

            var existing = await db.PushSubscriptions.FirstOrDefaultAsync(s => s.Endpoint == req.Endpoint);
            if (existing is null)
            {
                db.PushSubscriptions.Add(new PushSubscription
                {
                    UserUid = req.Uid ?? req.Username,
                    Username = req.Username,
                    Endpoint = req.Endpoint,
                    P256dh = req.Keys.P256dh,
                    Auth = req.Keys.Auth,
                    UserAgent = req.UserAgent,
                });
            }
            else
            {
                existing.UserUid = req.Uid ?? req.Username;
                existing.Username = req.Username;
                existing.P256dh = req.Keys.P256dh;
                existing.Auth = req.Keys.Auth;
                existing.UserAgent = req.UserAgent;
                existing.LastUsedAt = DateTime.UtcNow;
            }
            await db.SaveChangesAsync();
            return Results.Ok(new { ok = true });
        });

        group.MapDelete("/", async ([FromBody] InternalUnsubscribeRequest req, AppDbContext db) =>
        {
            if (string.IsNullOrEmpty(req.Endpoint))
                return Results.BadRequest(new { error = "endpoint is required" });

            var rows = await db.PushSubscriptions
                .Where(s => s.Endpoint == req.Endpoint)
                .ExecuteDeleteAsync();
            return Results.Ok(new { removed = rows });
        });

        return app;
    }
}

public record InternalSubscribeRequest(
    string Username,
    string? Uid,
    string Endpoint,
    InternalSubscribeKeys Keys,
    string? UserAgent);

public record InternalSubscribeKeys(string P256dh, string Auth);
public record InternalUnsubscribeRequest(string Endpoint);

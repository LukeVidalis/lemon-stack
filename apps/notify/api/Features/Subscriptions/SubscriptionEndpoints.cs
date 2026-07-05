using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using NotifyService.Data;

namespace NotifyService.Features.Subscriptions;

public static class SubscriptionEndpoints
{
    public static IEndpointRouteBuilder MapSubscriptionEndpoints(this IEndpointRouteBuilder app)
    {
        // Public — PWAs need this before subscribing.
        app.MapGet("/vapid-public-key", () =>
        {
            var key = Environment.GetEnvironmentVariable("VAPID_PUBLIC_KEY");
            if (string.IsNullOrEmpty(key))
                return Results.Problem("VAPID_PUBLIC_KEY not configured", statusCode: 503);
            return Results.Ok(new { publicKey = key });
        }).AllowAnonymous();

        var group = app.MapGroup("/").RequireAuthorization();

        group.MapPost("/subscribe", async (SubscribeRequest req, ClaimsPrincipal user, AppDbContext db) =>
        {
            var uid = user.FindFirst(ClaimTypes.NameIdentifier)?.Value;
            var username = user.FindFirst(ClaimTypes.Name)?.Value ?? "";
            if (string.IsNullOrEmpty(uid)) return Results.Unauthorized();

            if (string.IsNullOrEmpty(req.Endpoint) ||
                string.IsNullOrEmpty(req.Keys?.P256dh) ||
                string.IsNullOrEmpty(req.Keys?.Auth))
                return Results.BadRequest(new { error = "endpoint and keys.p256dh and keys.auth are required" });

            var existing = await db.PushSubscriptions.FirstOrDefaultAsync(s => s.Endpoint == req.Endpoint);
            if (existing is null)
            {
                db.PushSubscriptions.Add(new PushSubscription
                {
                    UserUid = uid,
                    Username = username,
                    Endpoint = req.Endpoint,
                    P256dh = req.Keys.P256dh,
                    Auth = req.Keys.Auth,
                    UserAgent = req.UserAgent,
                });
            }
            else
            {
                existing.UserUid = uid;
                existing.Username = username;
                existing.P256dh = req.Keys.P256dh;
                existing.Auth = req.Keys.Auth;
                existing.UserAgent = req.UserAgent;
                existing.LastUsedAt = DateTime.UtcNow;
            }
            await db.SaveChangesAsync();
            return Results.Ok(new { ok = true });
        });

        group.MapDelete("/unsubscribe", async ([FromBody] UnsubscribeRequest req, AppDbContext db) =>
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

public record SubscribeRequest(string Endpoint, SubscribeKeys Keys, string? UserAgent);
public record SubscribeKeys(string P256dh, string Auth);
public record UnsubscribeRequest(string Endpoint);

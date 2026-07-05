using Microsoft.EntityFrameworkCore;
using NotifyService.Common.Internal;
using NotifyService.Data;
using NotifyService.Services;

namespace NotifyService.Features.Internal;

public static class SendEndpoints
{
    public static IEndpointRouteBuilder MapInternalSendEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/_internal/notify").RequireInternalSecret();

        group.MapPost("/", async (SendRequest req, AppDbContext db, PushSender sender) =>
        {
            if (string.IsNullOrEmpty(req.To))
                return Results.BadRequest(new { error = "to is required" });
            if (string.IsNullOrEmpty(req.Title) || string.IsNullOrEmpty(req.Body))
                return Results.BadRequest(new { error = "title and body are required" });

            // Resolve target user: prefer Uid match, fall back to most recent Username match.
            var uid = await db.PushSubscriptions
                .Where(s => s.UserUid == req.To)
                .Select(s => s.UserUid)
                .FirstOrDefaultAsync();

            if (uid is null)
            {
                uid = await db.PushSubscriptions
                    .Where(s => s.Username == req.To)
                    .OrderByDescending(s => s.LastUsedAt)
                    .Select(s => s.UserUid)
                    .FirstOrDefaultAsync();
            }

            if (uid is null)
                return Results.NotFound(new { error = $"no subscriptions for '{req.To}'" });

            var actions = req.Actions?.Take(2).Select(a => new NotificationAction(a.Label, a.Url)).ToList();

            var notification = new Notification
            {
                UserUid = uid,
                SourceApp = req.SourceApp ?? "unknown",
                Title = req.Title,
                Body = req.Body,
                IconUrl = req.IconUrl,
                BadgeUrl = req.BadgeUrl,
                ClickUrl = req.ClickUrl,
                Actions = actions,
            };
            db.Notifications.Add(notification);
            await db.SaveChangesAsync();

            var payload = new PushPayload(
                notification.Id,
                req.Title, req.Body,
                req.IconUrl, req.BadgeUrl, req.ClickUrl,
                actions);

            var (delivered, failed) = await sender.SendToUserAsync(db, uid, payload);
            notification.DeliveredCount = delivered;
            notification.FailedCount = failed;
            await db.SaveChangesAsync();

            return Results.Ok(new { notificationId = notification.Id, delivered, failed });
        });

        return app;
    }
}

public record SendRequest(
    string To,
    string? SourceApp,
    string Title,
    string Body,
    string? IconUrl,
    string? BadgeUrl,
    string? ClickUrl,
    List<NotificationAction>? Actions);

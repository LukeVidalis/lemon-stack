using System.Security.Claims;
using Microsoft.EntityFrameworkCore;
using NotifyService.Data;

namespace NotifyService.Features.Notifications;

public static class NotificationEndpoints
{
    public static IEndpointRouteBuilder MapNotificationEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/notifications").RequireAuthorization();

        group.MapGet("/", async (ClaimsPrincipal user, AppDbContext db, bool? unreadOnly, int? limit) =>
        {
            var uid = user.FindFirst(ClaimTypes.NameIdentifier)?.Value;
            if (string.IsNullOrEmpty(uid)) return Results.Unauthorized();

            var take = Math.Clamp(limit ?? 50, 1, 200);
            var q = db.Notifications.Where(n => n.UserUid == uid);
            if (unreadOnly == true) q = q.Where(n => n.ReadAt == null);

            var rows = await q.OrderByDescending(n => n.CreatedAt).Take(take).ToListAsync();
            return Results.Ok(rows);
        });

        group.MapPost("/{id:guid}/read", async (Guid id, ClaimsPrincipal user, AppDbContext db) =>
        {
            var uid = user.FindFirst(ClaimTypes.NameIdentifier)?.Value;
            if (string.IsNullOrEmpty(uid)) return Results.Unauthorized();

            var n = await db.Notifications.FirstOrDefaultAsync(x => x.Id == id && x.UserUid == uid);
            if (n is null) return Results.NotFound();
            n.ReadAt ??= DateTime.UtcNow;
            await db.SaveChangesAsync();
            return Results.Ok(new { ok = true });
        });

        group.MapPost("/read-all", async (ClaimsPrincipal user, AppDbContext db) =>
        {
            var uid = user.FindFirst(ClaimTypes.NameIdentifier)?.Value;
            if (string.IsNullOrEmpty(uid)) return Results.Unauthorized();

            var now = DateTime.UtcNow;
            var rows = await db.Notifications
                .Where(n => n.UserUid == uid && n.ReadAt == null)
                .ExecuteUpdateAsync(s => s.SetProperty(n => n.ReadAt, now));
            return Results.Ok(new { updated = rows });
        });

        return app;
    }
}

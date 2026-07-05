using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using NotifyService.Data;
using WebPush;
using DbPushSubscription = NotifyService.Data.PushSubscription;
using LibPushSubscription = WebPush.PushSubscription;

namespace NotifyService.Services;

public record PushPayload(
    Guid NotificationId,
    string Title,
    string Body,
    string? IconUrl,
    string? BadgeUrl,
    string? ClickUrl,
    IReadOnlyList<NotificationAction>? Actions);

public class PushSender
{
    private readonly WebPushClient _client;
    private readonly VapidDetails _vapid;
    private readonly ILogger<PushSender> _logger;

    public PushSender(WebPushClient client, VapidDetails vapid, ILogger<PushSender> logger)
    {
        _client = client;
        _vapid = vapid;
        _logger = logger;
    }

    public async Task<(int Delivered, int Failed)> SendToUserAsync(
        AppDbContext db, string userUid, PushPayload payload, CancellationToken ct = default)
    {
        var subs = await db.PushSubscriptions
            .Where(s => s.UserUid == userUid)
            .ToListAsync(ct);

        if (subs.Count == 0) return (0, 0);

        var json = JsonSerializer.Serialize(payload, new JsonSerializerOptions
        {
            PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
            DefaultIgnoreCondition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull
        });

        var dead = new List<DbPushSubscription>();
        var delivered = 0;
        var failed = 0;

        foreach (var sub in subs)
        {
            try
            {
                var lib = new LibPushSubscription(sub.Endpoint, sub.P256dh, sub.Auth);
                await _client.SendNotificationAsync(lib, json, _vapid, ct);
                sub.LastUsedAt = DateTime.UtcNow;
                delivered++;
            }
            catch (WebPushException ex) when (
                ex.StatusCode == System.Net.HttpStatusCode.Gone ||
                ex.StatusCode == System.Net.HttpStatusCode.NotFound)
            {
                _logger.LogInformation("Removing dead subscription {Id} ({Status})", sub.Id, ex.StatusCode);
                dead.Add(sub);
                failed++;
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Push send failed for subscription {Id}", sub.Id);
                failed++;
            }
        }

        if (dead.Count > 0) db.PushSubscriptions.RemoveRange(dead);
        await db.SaveChangesAsync(ct);

        return (delivered, failed);
    }
}

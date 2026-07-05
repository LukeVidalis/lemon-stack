using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace NotifyService.Data;

public class PushSubscription
{
    public Guid Id { get; set; } = Guid.NewGuid();

    [Required] public string UserUid { get; set; } = "";
    [Required] public string Username { get; set; } = "";
    [Required] public string Endpoint { get; set; } = "";
    [Required] public string P256dh { get; set; } = "";
    [Required] public string Auth { get; set; } = "";

    public string? UserAgent { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime LastUsedAt { get; set; } = DateTime.UtcNow;
}

public class Notification
{
    public Guid Id { get; set; } = Guid.NewGuid();

    [Required] public string UserUid { get; set; } = "";
    [Required] public string SourceApp { get; set; } = "";
    [Required] public string Title { get; set; } = "";
    [Required] public string Body { get; set; } = "";

    public string? IconUrl { get; set; }
    public string? BadgeUrl { get; set; }
    public string? ClickUrl { get; set; }

    [Column(TypeName = "jsonb")]
    public List<NotificationAction>? Actions { get; set; }

    public DateTime? ReadAt { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    public int DeliveredCount { get; set; }
    public int FailedCount { get; set; }
}

public record NotificationAction(string Label, string Url);

using NotifyService.Common.Internal;

namespace NotifyService.Features.Internal;

// Dashboard integration. The master planner at dashboard.{{DOMAIN}} calls this
// over the Docker host network (127.0.0.1:<port>) with a shared secret to build
// a per-user summary card. Contract documented at ~/.claude/skills/dashboard/SKILL.md.
//
// Replace the stub payload below with real per-user data once your app has
// user-scoped tables. Until then the dashboard will render a "TODO" card so
// the missing implementation is visible.
public static class UserSummaryEndpoints
{
    public static IEndpointRouteBuilder MapInternalUserSummary(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/_internal").RequireInternalSecret();

        group.MapGet("/user-summary", (string uid) =>
        {
            return Results.Ok(new UserSummary(
                Uid: uid,
                Title: null,
                Primary: "TODO: implement /api/_internal/user-summary for this app",
                Items: Array.Empty<SummaryItem>(),
                Metrics: Array.Empty<SummaryMetric>(),
                DeepLink: null
            ));
        }).ExcludeFromDescription();

        return app;
    }
}

public record UserSummary(
    string Uid,
    string? Title,
    string Primary,
    IReadOnlyList<SummaryItem> Items,
    IReadOnlyList<SummaryMetric> Metrics,
    string? DeepLink);

public record SummaryItem(string Label, string? Sub = null, string Tone = "info");

public record SummaryMetric(string Label, object Value, string Tone = "info");

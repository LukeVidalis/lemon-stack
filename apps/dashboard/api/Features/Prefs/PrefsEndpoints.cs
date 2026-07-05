using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;

namespace Dashboard.Features.Prefs;

public static class PrefsEndpoints
{
    public static IEndpointRouteBuilder MapPrefs(this IEndpointRouteBuilder app)
    {
        app.MapGet("/api/prefs", [Authorize] async (ClaimsPrincipal user, PrefsStore store) =>
        {
            var uid = user.FindFirstValue(ClaimTypes.NameIdentifier);
            if (string.IsNullOrEmpty(uid)) return Results.Problem("UID missing", statusCode: 401);
            return Results.Ok(await store.GetPrefsAsync(uid));
        });

        app.MapPut("/api/prefs", [Authorize] async (ClaimsPrincipal user, PrefsStore store, PrefsDocument body) =>
        {
            var uid = user.FindFirstValue(ClaimTypes.NameIdentifier);
            if (string.IsNullOrEmpty(uid)) return Results.Problem("UID missing", statusCode: 401);

            if (body.Theme is not ("auto" or "light" or "dark"))
                return Results.BadRequest(new { error = "theme must be auto|light|dark" });
            if (body.RefreshIntervalSec is < 10 or > 3600)
                return Results.BadRequest(new { error = "refreshIntervalSec must be 10–3600" });

            await store.UpsertPrefsAsync(uid, body);
            return Results.Ok(await store.GetPrefsAsync(uid));
        });

        return app;
    }
}

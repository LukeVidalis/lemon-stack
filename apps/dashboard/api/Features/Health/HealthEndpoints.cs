using Dashboard.Features.Aggregate;
using Dashboard.Features.Prefs;
using Dashboard.Features.Services;

namespace Dashboard.Features.Health;

public static class HealthEndpoints
{
    public static IEndpointRouteBuilder MapHealthEndpoints(this IEndpointRouteBuilder app)
    {
        app.MapGet("/health/live", () => Results.Ok(new { status = "ok" }));

        app.MapGet("/health/ready", (DataSourceRegistry dsReg, ServicesRegistry svcReg, PrefsStore store) =>
        {
            var checks = new List<string>();

            if (string.IsNullOrEmpty(Environment.GetEnvironmentVariable("INTERNAL_SUMMARY_SECRET")))
                checks.Add("INTERNAL_SUMMARY_SECRET not set");

            if (dsReg.Sources.Count == 0)
                checks.Add("no data sources loaded");

            _ = svcReg.Services.Count;

            try { store.Ping(); }
            catch (Exception ex) { checks.Add($"sqlite: {ex.Message}"); }

            return checks.Count == 0
                ? Results.Ok(new { status = "ok" })
                : Results.Json(new { status = "degraded", checks }, statusCode: 503);
        });

        app.MapGet("/health", async Task<IResult> (HttpRequest request, DataSourceRegistry registry) =>
        {
            var now = DateTime.UtcNow;
            if (request.Query["deep"] != "1")
                return Results.Ok(new { status = "ok", time = now });

            var probes = await Task.WhenAll(registry.Sources.Select(async src =>
            {
                var sw = System.Diagnostics.Stopwatch.StartNew();
                bool reachable;
                try
                {
                    using var tcp = new System.Net.Sockets.TcpClient();
                    using var cts = new CancellationTokenSource(250);
                    await tcp.ConnectAsync(src.Host, src.Port, cts.Token);
                    reachable = true;
                }
                catch { reachable = false; }
                sw.Stop();
                return new { slug = src.Slug, reachable, latencyMs = (int)sw.ElapsedMilliseconds };
            }));

            return Results.Ok(new { status = "ok", time = DateTime.UtcNow, sources = probes });
        });

        return app;
    }
}

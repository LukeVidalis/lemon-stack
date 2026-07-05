namespace Dashboard.Features.BuildInfo;

public static class BuildInfoEndpoints
{
    public static IEndpointRouteBuilder MapBuildInfo(this IEndpointRouteBuilder app)
    {
        var info = new BuildInfo(
            Environment.GetEnvironmentVariable("BUILD_SHA") ?? "dev",
            Environment.GetEnvironmentVariable("BUILD_TIME") ?? "unknown",
            Environment.GetEnvironmentVariable("BUILD_VERSION") ?? "dev");

        app.MapGet("/api/buildinfo", () => Results.Ok(info));
        return app;
    }
}

public record BuildInfo(string Sha, string BuiltAt, string Version);

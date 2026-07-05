namespace Dashboard.Features.Services;

public static class ServicesEndpoints
{
    public static IEndpointRouteBuilder MapServices(this IEndpointRouteBuilder app)
    {
        app.MapGet("/api/services", (ServicesRegistry registry) =>
            Results.Ok(registry.Services));

        return app;
    }
}

namespace NotifyService.Common.Middleware;

public sealed class CorrelationMiddleware
{
    public const string HeaderName = "X-Request-Id";
    private readonly RequestDelegate _next;
    private readonly ILogger<CorrelationMiddleware> _logger;

    public CorrelationMiddleware(RequestDelegate next, ILogger<CorrelationMiddleware> logger)
    {
        _next = next;
        _logger = logger;
    }

    public async Task InvokeAsync(HttpContext ctx)
    {
        var id = ctx.Request.Headers[HeaderName].ToString();
        if (string.IsNullOrWhiteSpace(id) || id.Length > 64)
            id = Guid.NewGuid().ToString("N")[..12];

        ctx.TraceIdentifier = id;
        ctx.Response.Headers[HeaderName] = id;

        using (_logger.BeginScope(new Dictionary<string, object> { ["requestId"] = id }))
        {
            await _next(ctx);
        }
    }
}

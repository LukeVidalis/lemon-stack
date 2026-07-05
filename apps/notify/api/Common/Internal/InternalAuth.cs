using System.Security.Cryptography;
using System.Text;

namespace NotifyService.Common.Internal;

public static class InternalAuth
{
    public const string EnvVar = "INTERNAL_SUMMARY_SECRET";
    public const string HeaderName = "X-Internal-Secret";

    public static RouteGroupBuilder RequireInternalSecret(this RouteGroupBuilder group)
    {
        group.AddEndpointFilter(async (ctx, next) =>
        {
            var expected = Environment.GetEnvironmentVariable(EnvVar);
            if (string.IsNullOrEmpty(expected))
                return Results.Problem(
                    detail: $"{EnvVar} is not configured on the server.",
                    statusCode: StatusCodes.Status503ServiceUnavailable);

            var supplied = ctx.HttpContext.Request.Headers[HeaderName].ToString();
            if (!ConstantTimeEquals(supplied, expected))
                return Results.Unauthorized();

            return await next(ctx);
        });
        return group;
    }

    // Compare regardless of length: pad to the longer length, FixedTimeEquals,
    // then AND with the length match. Avoids the early-return timing oracle.
    private static bool ConstantTimeEquals(string supplied, string expected)
    {
        var a = Encoding.UTF8.GetBytes(supplied);
        var b = Encoding.UTF8.GetBytes(expected);
        var len = Math.Max(a.Length, b.Length);
        var aPad = new byte[len];
        var bPad = new byte[len];
        Buffer.BlockCopy(a, 0, aPad, 0, a.Length);
        Buffer.BlockCopy(b, 0, bPad, 0, b.Length);
        var equal = CryptographicOperations.FixedTimeEquals(aPad, bPad);
        return equal & (a.Length == b.Length);
    }
}

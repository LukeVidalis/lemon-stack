using System.Security.Claims;
using System.Text.Encodings.Web;
using Microsoft.AspNetCore.Authentication;
using Microsoft.Extensions.Options;

namespace NotifyService.Common.Auth;

public class AuthentikAuthHandler : AuthenticationHandler<AuthenticationSchemeOptions>
{
    public AuthentikAuthHandler(
        IOptionsMonitor<AuthenticationSchemeOptions> options,
        ILoggerFactory logger,
        UrlEncoder encoder) : base(options, logger, encoder) { }

    protected override Task<AuthenticateResult> HandleAuthenticateAsync()
    {
        var username = Request.Headers["X-Authentik-Username"].ToString();
        if (string.IsNullOrEmpty(username))
            return Task.FromResult(AuthenticateResult.NoResult());

        var claims = new List<Claim> { new(ClaimTypes.Name, username) };

        var email = Request.Headers["X-Authentik-Email"].ToString();
        if (!string.IsNullOrEmpty(email))
            claims.Add(new Claim(ClaimTypes.Email, email));

        var uid = Request.Headers["X-Authentik-Uid"].ToString();
        if (!string.IsNullOrEmpty(uid))
            claims.Add(new Claim(ClaimTypes.NameIdentifier, uid));

        // Groups are pipe-separated: "admins|users|..."
        var groups = Request.Headers["X-Authentik-Groups"].ToString();
        if (!string.IsNullOrEmpty(groups))
            foreach (var group in groups.Split('|', StringSplitOptions.RemoveEmptyEntries))
                claims.Add(new Claim(ClaimTypes.Role, group.Trim()));

        var identity = new ClaimsIdentity(claims, Scheme.Name);
        var ticket = new AuthenticationTicket(new ClaimsPrincipal(identity), Scheme.Name);
        return Task.FromResult(AuthenticateResult.Success(ticket));
    }
}

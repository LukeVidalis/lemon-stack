"""HTTP probe of an app's subdomain via Caddy on localhost."""
from urllib.parse import urlparse

from ..sources import http_check


def _resolve(arg: str) -> tuple[str, str]:
    """Accept either a short app name or a full URL/hostname. Return (host, path)."""
    if arg.startswith("http://") or arg.startswith("https://"):
        p = urlparse(arg)
        return p.netloc, (p.path or "/") + (f"?{p.query}" if p.query else "")
    if "." in arg:
        return arg, "/"
    return config.app_host(arg), "/"


def run(args) -> dict:
    host, path = _resolve(args.target)
    follow = not args.no_follow
    res = http_check.smoke(host, path=path, follow=follow)
    res["target"] = args.target
    return res


def render_text(r: dict) -> str:
    out = [
        f"target:        {r['target']}",
        f"host:          {r['host']}",
        f"status:        {r['status']}",
        f"final_url:     {r['final_url']}",
        f"auth_redirect: {r['auth_redirect']}",
        f"elapsed_ms:    {r['elapsed_ms']}",
    ]
    if r.get("error"):
        out.append(f"error:         {r['error']}")
    if r["redirect_chain"]:
        out.append("chain:")
        for h in r["redirect_chain"]:
            loc = h.get("location")
            tail = f"  ->  {loc[:120]}" if loc else ""
            out.append(f"  {h['status']:>3}  {h['host']}{tail}")
    if r.get("body_preview"):
        out.append("body_preview:")
        out.append("  " + r["body_preview"].replace("\n", "\n  ")[:300])
    return "\n".join(out)

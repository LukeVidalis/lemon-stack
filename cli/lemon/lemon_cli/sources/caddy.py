"""Parse /etc/caddy/Caddyfile into structured route records."""
import re
from typing import Optional

from .. import config

# Match block opener: "http(s)://host.<your domain> {"  or "host.<your domain> {"
_BLOCK_RE = re.compile(
    r"^\s*(?:https?://)?([a-z0-9._-]+\.lemoncode\.dev)\s*\{\s*$"
)
_PROXY_RE = re.compile(r"reverse_proxy\s+\S*?:(\d+)")
_AUTH_RE = re.compile(r"\bimport\s+authentik\b")


def parse() -> list[dict]:
    try:
        with open(config.CADDYFILE, "r") as f:
            text = f.read()
    except OSError as e:
        config.dbg(f"caddyfile read failed: {e}")
        return []

    routes: list[dict] = []
    cur_domain: Optional[str] = None
    cur_body: list[str] = []
    depth = 0

    for raw_line in text.splitlines():
        line = raw_line
        if cur_domain is None:
            m = _BLOCK_RE.match(line)
            if m:
                cur_domain = m.group(1)
                cur_body = []
                depth = 1
            continue

        # We are inside a block; track brace depth (naive but fine for Caddyfile)
        depth += line.count("{") - line.count("}")
        if depth <= 0:
            # Block closed — emit
            body = "\n".join(cur_body)
            port = None
            pm = _PROXY_RE.search(body)
            if pm:
                try:
                    port = int(pm.group(1))
                except ValueError:
                    port = None
            auth = "authentik" if _AUTH_RE.search(body) else "none"
            routes.append({"domain": cur_domain, "port": port, "auth": auth})
            cur_domain = None
            cur_body = []
        else:
            cur_body.append(line)
    return routes


def for_domain(domain: str) -> Optional[dict]:
    for r in parse():
        if r["domain"] == domain:
            return r
    return None


def for_app(app: str) -> Optional[dict]:
    """Look up the route whose subdomain matches `<app>.<your domain>`."""
    return for_domain(config.app_host(app))

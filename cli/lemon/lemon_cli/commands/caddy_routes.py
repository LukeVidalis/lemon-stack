"""All Caddy routes parsed from /etc/caddy/Caddyfile."""
from ..sources import caddy as c_src


def run(args) -> list[dict]:
    return c_src.parse()


def render_text(rows: list[dict]) -> str:
    if not rows:
        return "(no routes)"
    out = [f"{'DOMAIN':<40} {'PORT':<8} AUTH", "-" * 60]
    for r in rows:
        out.append(f"{r['domain']:<40} {str(r['port'] or '-'):<8} {r['auth']}")
    return "\n".join(out)

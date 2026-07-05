"""List Bao keys for an app."""
from ..sources import bao as b_src


def run(args) -> dict:
    app = args.app
    res = b_src.list_keys(app)
    return {"app": app, **res}


def render_text(r: dict) -> str:
    out = [
        f"app:       {r['app']}",
        f"reachable: {r['reachable']}",
    ]
    if r.get("error"):
        out.append(f"error:     {r['error']}")
    out.append(f"keys ({len(r.get('keys') or [])}):")
    for k in r.get("keys") or []:
        out.append(f"  - {k}")
    return "\n".join(out)

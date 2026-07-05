"""Authentik wiring sanity check for an app."""
from ..sources import caddy as c_src
from ..sources import http_check


def run(args) -> dict:
    app = args.app
    host = config.app_host(app)

    route = c_src.for_app(app)
    has_block = route is not None
    has_authentik_import = bool(route and route.get("auth") == "authentik")

    outpost_ok = http_check.authentik_outpost_reachable()

    # Anonymous probe — no follow, expect either 302 to outpost (authentik wired)
    # or 200 (no auth) or 401/403 (auth challenge inline).
    probe = http_check.probe_no_follow(host)

    challenged = (
        probe["auth_redirect"]
        or probe["status"] in (401, 403)
    )

    expected_auth = has_authentik_import

    checks = [
        {"name": "caddy_block_exists", "pass": has_block, "detail": route},
        {"name": "outpost_reachable", "pass": outpost_ok,
         "detail": "GET http://127.0.0.1:9000/-/health/live/"},
    ]
    if expected_auth:
        checks.append({
            "name": "import_authentik_present", "pass": True,
            "detail": "Caddy block includes `import authentik`",
        })
        checks.append({
            "name": "anonymous_request_challenged", "pass": challenged,
            "detail": f"status={probe['status']} auth_redirect={probe['auth_redirect']}",
        })
    else:
        # App is not expected to have auth — assert that anon WAS NOT challenged.
        checks.append({
            "name": "anonymous_request_not_challenged", "pass": not challenged,
            "detail": f"status={probe['status']} auth_redirect={probe['auth_redirect']}",
        })

    ok = all(c["pass"] for c in checks)

    return {
        "app": app,
        "ok": ok,
        "expected_auth": expected_auth,
        "checks": checks,
        "probe": probe,
    }


def render_text(r: dict) -> str:
    out = [f"app:           {r['app']}", f"ok:            {r['ok']}", f"expected_auth: {r['expected_auth']}", "checks:"]
    for c in r["checks"]:
        mark = "✓" if c["pass"] else "✗"
        out.append(f"  {mark} {c['name']}")
    p = r["probe"]
    out.append(f"probe: status={p['status']} auth_redirect={p['auth_redirect']} chain_len={len(p['redirect_chain'])}")
    return "\n".join(out)

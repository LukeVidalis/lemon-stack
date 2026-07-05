"""Single objective gate before declaring an app `done`.

Bundles: container running + Caddy route present + HTTP probe via Caddy returns
something sensible + no fresh errors in container logs. Returns {ok, checks:[]}.
"""
import re
import time

from ..sources import caddy as c_src
from ..sources import docker as d_src
from ..sources import http_check
from ..sources import ports as p_src


_ERROR_RE = re.compile(r"\b(error|exception|fatal|panic|traceback)\b", re.IGNORECASE)


def _recent_log_errors(name: str, since_seconds: int) -> list[str]:
    """Errors emitted in the last <since_seconds> seconds."""
    # Use docker logs --since=<duration>; passes through to docker's parser.
    rc, out, err = d_src._run(  # type: ignore[attr-defined]
        ["docker", "logs", "--since", f"{since_seconds}s", name], timeout=8
    )
    combined = (out or "") + (err or "")
    hits = []
    for line in combined.splitlines():
        if _ERROR_RE.search(line):
            hits.append(line.strip()[:500])
    return hits


def run(args) -> dict:
    app = args.app
    since = args.since
    host = config.app_host(app)

    checks: list[dict] = []

    # 1. Caddy route exists
    route = c_src.for_app(app)
    checks.append({
        "name": "caddy_route",
        "pass": route is not None,
        "detail": route,
    })

    # 2. Container running
    container = d_src.find_container(app)
    running = bool(container and container.get("State") == "running")
    checks.append({
        "name": "container_running",
        "pass": running,
        "detail": {
            "name": (container or {}).get("Names"),
            "state": (container or {}).get("State"),
            "status": (container or {}).get("Status"),
        },
    })

    # 3. Port assigned in ports.json
    port_entry = p_src.for_app(app)
    checks.append({
        "name": "port_assigned",
        "pass": port_entry is not None,
        "detail": port_entry,
    })

    # 4. HTTP probe through Caddy (follow redirects)
    probe = http_check.smoke(host, path="/", follow=True)
    # "sensible" = either 2xx, or got challenged by Authentik (302 to outpost / 401)
    http_ok = (
        probe["status"] is not None
        and (
            200 <= probe["status"] < 400
            or probe["auth_redirect"]
            or probe["status"] in (401, 403)
        )
    )
    checks.append({
        "name": "http_responds",
        "pass": http_ok,
        "detail": {
            "status": probe["status"],
            "elapsed_ms": probe["elapsed_ms"],
            "auth_redirect": probe["auth_redirect"],
            "error": probe.get("error"),
        },
    })

    # 5. Authentik wiring matches Caddy declaration
    expected_auth = bool(route and route.get("auth") == "authentik")
    if expected_auth:
        # Anonymous probe (no follow) must be challenged
        anon = http_check.probe_no_follow(host)
        challenged = anon["auth_redirect"] or anon["status"] in (401, 403)
        checks.append({
            "name": "authentik_challenges_anon",
            "pass": challenged,
            "detail": {"status": anon["status"], "auth_redirect": anon["auth_redirect"]},
        })

    # 6. No fresh log errors
    log_errors: list[str] = []
    if container and container.get("Names"):
        log_errors = _recent_log_errors(container["Names"], since)
    checks.append({
        "name": f"no_errors_in_last_{since}s",
        "pass": len(log_errors) == 0,
        "detail": {"count": len(log_errors), "samples": log_errors[:5]},
    })

    ok = all(c["pass"] for c in checks)
    return {
        "app": app,
        "ok": ok,
        "since_seconds": since,
        "checks": checks,
    }


def render_text(r: dict) -> str:
    out = [f"=== verify: {r['app']} ===", f"ok: {r['ok']}", "checks:"]
    for c in r["checks"]:
        mark = "✓" if c["pass"] else "✗"
        out.append(f"  {mark} {c['name']}")
        if not c["pass"]:
            out.append(f"      detail: {c['detail']}")
    return "\n".join(out)

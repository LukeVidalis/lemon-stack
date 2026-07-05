"""Composite read: container + port + caddy + bao + recent errors for one app."""
from ..sources import docker as d_src
from ..sources import ports as p_src
from ..sources import caddy as c_src
from ..sources import bao as b_src
from ..sources import filesystem as fs


def _container_summary(c: dict | None) -> dict | None:
    if c is None:
        return None
    return {
        "name": c.get("Names"),
        "state": c.get("State"),
        "status": c.get("Status"),
        "image": c.get("Image"),
        "id": c.get("ID"),
    }


def _bao_summary(app: str) -> dict:
    if not fs.has_bao_role(app):
        # Fallback file?
        n = fs.secrets_env_key_count(app)
        if n is not None:
            return {"source": "file", "bao_reachable": False, "key_count": n, "has_role_id": False}
        return {"source": "none", "bao_reachable": False, "key_count": 0, "has_role_id": False}
    res = b_src.list_keys(app)
    if res["reachable"] and res.get("keys"):
        return {
            "source": "bao",
            "bao_reachable": True,
            "key_count": len(res["keys"]),
            "has_role_id": True,
        }
    # Reachable but empty, or unreachable -> fallback to file count if present
    fb = fs.secrets_env_key_count(app)
    return {
        "source": "file" if fb is not None else ("bao" if res["reachable"] else "none"),
        "bao_reachable": res["reachable"],
        "key_count": fb if fb is not None else len(res.get("keys", [])),
        "has_role_id": True,
        **({"bao_error": res["error"]} if res.get("error") else {}),
    }


def run(args) -> dict:
    app = args.app
    errors: list[str] = []

    port_entry = p_src.for_app(app)
    ports = p_src.flatten(port_entry)

    # Best-guess container: name often equals app, sometimes with service suffix.
    # Try exact, then any container whose name contains the app.
    container = d_src.find_container(app)
    container_summary = _container_summary(container)

    caddy_route = c_src.for_app(app)

    bao_summary = _bao_summary(app)

    recent_errors: list[str] = []
    if container and container.get("Names"):
        recent_errors = d_src.recent_errors(container["Names"])

    if container is None:
        errors.append(f"no docker container matched name '{app}'")
    if port_entry is None:
        errors.append(f"no port entry in ports.json for '{app}'")
    if caddy_route is None:
        errors.append(f"no Caddy block for {app}.<your domain>")

    out = {
        "app": app,
        "container": container_summary,
        "ports": ports,
        "port_map": port_entry,
        "caddy": caddy_route,
        "bao": bao_summary,
        "recent_errors": recent_errors,
        "filesystem": {
            "app_dir_exists": fs.exists(app),
            "has_compose": fs.has_compose(app),
            "has_dockerfile": fs.has_dockerfile(app),
        },
        "errors": errors,
    }
    return out


def render_text(result: dict) -> str:
    lines = []
    lines.append(f"=== {result['app']} ===")
    c = result.get("container")
    if c:
        lines.append(f"container: {c['name']} [{c['state']}] {c['status']}")
        lines.append(f"  image:   {c['image']}")
    else:
        lines.append("container: (none found)")
    ports = result.get("ports") or []
    lines.append(f"ports:     {ports if ports else '(unassigned)'}")
    caddy = result.get("caddy")
    if caddy:
        lines.append(f"caddy:     {caddy['domain']} -> :{caddy['port']}  auth={caddy['auth']}")
    else:
        lines.append("caddy:     (no block)")
    bao = result.get("bao", {})
    lines.append(
        f"secrets:   source={bao.get('source')}  keys={bao.get('key_count')}  "
        f"bao_reachable={bao.get('bao_reachable')}"
    )
    errs = result.get("recent_errors") or []
    if errs:
        lines.append(f"recent_errors ({len(errs)}):")
        for e in errs[:10]:
            lines.append(f"  - {e[:160]}")
    else:
        lines.append("recent_errors: none")
    issues = result.get("errors") or []
    if issues:
        lines.append("issues:")
        for i in issues:
            lines.append(f"  ! {i}")
    return "\n".join(lines)

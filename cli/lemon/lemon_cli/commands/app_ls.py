"""Inventory of all apps known to ports.json with quick state."""
from ..sources import docker as d_src
from ..sources import ports as p_src
from ..sources import caddy as c_src
from ..sources import filesystem as fs


def run(args) -> list[dict]:
    ports_data = p_src.load()
    routes_by_domain = {r["domain"]: r for r in c_src.parse()}
    containers = d_src.ps_all()

    def find_container(app: str) -> dict | None:
        for c in containers:
            n = c.get("Names", "")
            if n == app or app in n.split(","):
                return c
        # fallback to substring
        for c in containers:
            if app in c.get("Names", ""):
                return c
        return None

    rows: list[dict] = []
    for app, entry in sorted(ports_data.items()):
        ports = p_src.flatten(entry)
        c = find_container(app)
        route = routes_by_domain.get(config.app_host(app))
        rows.append({
            "app": app,
            "ports": ports,
            "container_state": (c or {}).get("State"),
            "container_name": (c or {}).get("Names"),
            "domain": route["domain"] if route else None,
            "auth": route["auth"] if route else None,
            "has_compose": fs.has_compose(app),
            "has_dockerfile": fs.has_dockerfile(app),
        })
    return rows


def render_text(rows: list[dict]) -> str:
    if not rows:
        return "(no apps)"
    headers = ["APP", "PORTS", "STATE", "DOMAIN", "AUTH"]
    out = [
        f"{'APP':<22} {'PORTS':<14} {'STATE':<10} {'DOMAIN':<32} AUTH",
        "-" * 90,
    ]
    for r in rows:
        ports = ",".join(str(p) for p in r["ports"]) or "-"
        state = r["container_state"] or "-"
        domain = r["domain"] or "-"
        auth = r["auth"] or "-"
        out.append(f"{r['app']:<22} {ports:<14} {state:<10} {domain:<32} {auth}")
    return "\n".join(out)

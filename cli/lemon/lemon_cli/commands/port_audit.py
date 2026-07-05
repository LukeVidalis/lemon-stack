"""Cross-check ports.json vs running containers vs Caddy routes."""
import re

from ..sources import docker as d_src
from ..sources import ports as p_src
from ..sources import caddy as c_src


_PORT_RE = re.compile(r"(?:127\.0\.0\.1|0\.0\.0\.0):(\d+)->")


def _container_host_ports(c: dict) -> list[int]:
    ports_field = c.get("Ports", "") or ""
    return [int(m.group(1)) for m in _PORT_RE.finditer(ports_field)]


def run(args) -> dict:
    declared = p_src.all_ports()  # port -> "app[/svc]"
    routes = c_src.parse()
    route_ports = {r["port"] for r in routes if r.get("port")}

    container_ports: dict[int, str] = {}
    for c in d_src.ps_all():
        for hp in _container_host_ports(c):
            container_ports[hp] = c.get("Names", "?")

    declared_set = set(declared)
    container_set = set(container_ports)

    ports_no_container = sorted(declared_set - container_set)
    containers_no_port = sorted(container_set - declared_set)
    caddy_no_port = sorted(route_ports - declared_set - container_set)

    ok = sorted(declared_set & container_set)

    return {
        "declared_count": len(declared_set),
        "container_count": len(container_set),
        "caddy_routes_count": len(routes),
        "orphans": {
            "ports_no_container": [
                {"port": p, "app": declared.get(p)} for p in ports_no_container
            ],
            "containers_no_port": [
                {"port": p, "container": container_ports.get(p)} for p in containers_no_port
            ],
            "caddy_no_port": [
                {"port": p, "domains": [r["domain"] for r in routes if r.get("port") == p]}
                for p in caddy_no_port
            ],
        },
        "ok": [{"port": p, "app": declared.get(p), "container": container_ports.get(p)} for p in ok],
    }


def render_text(r: dict) -> str:
    out = [
        f"declared: {r['declared_count']}  containers_with_ports: {r['container_count']}  "
        f"caddy_routes: {r['caddy_routes_count']}",
        "",
        f"PORTS_NO_CONTAINER ({len(r['orphans']['ports_no_container'])}):",
    ]
    for x in r["orphans"]["ports_no_container"]:
        out.append(f"  {x['port']:<7} {x['app']}")
    out.append(f"CONTAINERS_NO_PORT ({len(r['orphans']['containers_no_port'])}):")
    for x in r["orphans"]["containers_no_port"]:
        out.append(f"  {x['port']:<7} {x['container']}")
    out.append(f"CADDY_NO_PORT ({len(r['orphans']['caddy_no_port'])}):")
    for x in r["orphans"]["caddy_no_port"]:
        out.append(f"  {x['port']:<7} {','.join(x['domains'])}")
    out.append(f"OK ({len(r['ok'])}):")
    for x in r["ok"]:
        out.append(f"  {x['port']:<7} {x['app']:<24} -> {x['container']}")
    return "\n".join(out)

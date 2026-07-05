"""Composite server health: containers, disk, failed units, tunnel, monitoring, runner."""
import subprocess
import urllib.request
import urllib.error

from .. import config


def _run(args: list, timeout: int = 5) -> tuple[int, str, str]:
    config.dbg("exec: " + " ".join(args))
    try:
        p = subprocess.run(args, capture_output=True, text=True, timeout=timeout)
        return p.returncode, p.stdout, p.stderr
    except subprocess.TimeoutExpired:
        return 124, "", "timeout"
    except FileNotFoundError as e:
        return 127, "", str(e)


def _http_ok(url: str, timeout: float = 2.0) -> bool:
    config.dbg(f"GET {url}")
    try:
        with urllib.request.urlopen(url, timeout=timeout) as r:
            return r.status < 400
    except Exception:
        return False


def run(args) -> dict:
    errors: list[str] = []

    # 1. Container counts
    rc, out, _ = _run(["docker", "ps", "-a", "--format", "{{.State}}"])
    states = [s.strip() for s in out.strip().splitlines() if s.strip()]
    running = sum(1 for s in states if s == "running")
    total = len(states)

    # 2. Disk usage on /
    rc, out, _ = _run(["df", "-h", "/"])
    disk: dict | None = None
    lines = out.strip().splitlines()
    if len(lines) >= 2:
        parts = lines[1].split()
        if len(parts) >= 5:
            disk = {
                "total": parts[1],
                "used": parts[2],
                "available": parts[3],
                "use_pct": parts[4],
            }

    # 3. Failed systemd units
    rc, out, _ = _run(["systemctl", "--failed", "--no-legend", "--plain"])
    failed_units: list[str] = []
    for line in out.strip().splitlines():
        parts = line.split()
        if parts and not line.startswith("0 "):
            failed_units.append(parts[0])
    if failed_units:
        errors.append(f"failed units: {', '.join(failed_units)}")

    # 4. Cloudflare tunnel
    rc, out, _ = _run(["docker", "inspect", "cloudflared", "--format", "{{.State.Status}}"])
    tunnel_ok = out.strip() == "running"
    if not tunnel_ok:
        errors.append("cloudflared not running")

    # 5. Monitoring stack
    loki_ok = _http_ok("http://localhost:3100/ready")
    grafana_ok = _http_ok("http://localhost:3200/api/health")
    if not loki_ok:
        errors.append("loki not ready")
    if not grafana_ok:
        errors.append("grafana not healthy")

    # 6. GitHub Actions runner
    rc, out, _ = _run(["systemctl", "is-active", f"actions.runner.{config.require_org()}.{config.HOSTNAME}"])
    runner_ok = out.strip() == "active"
    if not runner_ok:
        errors.append("GitHub Actions runner not active")

    return {
        "containers": {"running": running, "total": total},
        "disk": disk,
        "failed_units": failed_units,
        "tunnel_ok": tunnel_ok,
        "monitoring": {"loki_ok": loki_ok, "grafana_ok": grafana_ok},
        "runner_ok": runner_ok,
        "ok": len(errors) == 0,
        "errors": errors,
    }


def render_text(r: dict) -> str:
    lines = ["=== server health ==="]
    c = r.get("containers", {})
    lines.append(f"containers: {c.get('running')}/{c.get('total')} running")
    d = r.get("disk") or {}
    lines.append(f"disk:       {d.get('used')}/{d.get('total')} ({d.get('use_pct')} used, {d.get('available')} free)")
    fu = r.get("failed_units") or []
    lines.append(f"failed:     {', '.join(fu) if fu else 'none'}")
    lines.append(f"tunnel:     {'OK' if r.get('tunnel_ok') else 'DOWN'}")
    m = r.get("monitoring", {})
    lines.append(f"loki:       {'OK' if m.get('loki_ok') else 'DOWN'}")
    lines.append(f"grafana:    {'OK' if m.get('grafana_ok') else 'DOWN'}")
    lines.append(f"gh_runner:  {'active' if r.get('runner_ok') else 'INACTIVE'}")
    lines.append(f"overall:    {'OK' if r.get('ok') else 'DEGRADED'}")
    errs = r.get("errors") or []
    if errs:
        lines.append("issues:")
        for e in errs:
            lines.append(f"  ! {e}")
    return "\n".join(lines)

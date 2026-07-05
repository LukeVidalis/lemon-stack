"""Loki log query for a deployed app.

Usage:
  lemon logs <app> [--since 15m] [--limit 50] [--errors]
"""
import json
import re
import time
import urllib.error
import urllib.parse
import urllib.request

from .. import config

LOKI_ADDR = "http://localhost:3100"
_SINCE_RE = re.compile(r"^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$")


def _parse_since(s: str) -> int:
    """Convert '15m', '1h', '2h30m', '90s' -> seconds."""
    m = _SINCE_RE.match(s)
    if not m:
        raise ValueError(f"invalid --since value '{s}' (examples: 15m, 1h, 2h30m, 90s)")
    h, mi, sec = (int(x or 0) for x in m.groups())
    total = h * 3600 + mi * 60 + sec
    if total == 0:
        raise ValueError(f"--since parsed to 0 seconds from '{s}'")
    return total


def _loki_query(query: str, start_ns: int, end_ns: int, limit: int) -> list[dict] | None:
    params = urllib.parse.urlencode({
        "query": query,
        "limit": str(limit),
        "start": str(start_ns),
        "end": str(end_ns),
        "direction": "backward",
    })
    url = f"{LOKI_ADDR}/loki/api/v1/query_range?{params}"
    config.dbg(f"loki GET {url}")
    try:
        with urllib.request.urlopen(url, timeout=6) as resp:
            data = json.loads(resp.read())
    except (urllib.error.URLError, TimeoutError, OSError) as e:
        config.dbg(f"loki error: {e}")
        return None
    results = data.get("data", {}).get("result", [])
    if not results:
        return []
    lines: list[dict] = []
    for stream in results:
        labels = stream.get("stream", {})
        for ts_str, line in stream.get("values", []):
            lines.append({"ts_ns": int(ts_str), "line": line, "labels": labels})
    return lines


def run(args) -> dict:
    app: str = args.app
    since_str: str = args.since
    limit: int = args.limit
    errors_only: bool = args.errors

    try:
        since_secs = _parse_since(since_str)
    except ValueError as e:
        return {"app": app, "lines": [], "errors": [str(e)]}

    end_ns = int(time.time() * 1_000_000_000)
    start_ns = end_ns - since_secs * 1_000_000_000

    error_filter = ' |~ "(?i)(error|exception|fatal|panic|traceback)"' if errors_only else ""

    # Try loki_project label first (injected by deploy.sh), then container name
    label_used: str | None = None
    raw_lines: list[dict] = []
    query_errors: list[str] = []

    for label in ("loki_project", "container"):
        query = f'{{{label}="{app}"}}{error_filter}'
        result = _loki_query(query, start_ns, end_ns, limit)
        if result is None:
            query_errors.append(f"loki unreachable on label={label}")
            break
        if result:
            label_used = label
            raw_lines = result
            break

    if not raw_lines and not query_errors:
        query_errors.append(f"no logs found for '{app}' in last {since_str}")

    # Sort oldest-first for readability
    raw_lines.sort(key=lambda x: x["ts_ns"])

    lines_out = []
    for entry in raw_lines:
        ts_sec = entry["ts_ns"] / 1_000_000_000
        lines_out.append({
            "time": time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(ts_sec)),
            "line": entry["line"],
        })

    return {
        "app": app,
        "since": since_str,
        "label_used": label_used,
        "errors_only": errors_only,
        "count": len(lines_out),
        "lines": lines_out,
        "errors": query_errors,
    }


def render_text(r: dict) -> str:
    out = [f"=== logs: {r['app']} (last {r['since']}) ==="]
    if r.get("label_used"):
        out.append(f"source: loki label {r['label_used']}={r['app']}")
    if r.get("errors_only"):
        out.append("filter: errors only")
    out.append(f"lines:  {r['count']}")
    out.append("")
    for entry in r.get("lines", []):
        out.append(f"[{entry['time']}] {entry['line']}")
    errs = r.get("errors") or []
    if errs:
        out.append("")
        for e in errs:
            out.append(f"! {e}")
    return "\n".join(out)

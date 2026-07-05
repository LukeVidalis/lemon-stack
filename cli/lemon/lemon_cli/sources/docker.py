"""Docker queries via subprocess."""
import json
import re
import subprocess
from typing import Any, Optional

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


def ps_all() -> list[dict]:
    """Return list of containers from `docker ps --format '{{json .}}'`."""
    rc, out, err = _run(["docker", "ps", "-a", "--format", "{{json .}}"])
    if rc != 0:
        config.dbg(f"docker ps failed: {err}")
        return []
    containers = []
    for line in out.strip().splitlines():
        try:
            containers.append(json.loads(line))
        except json.JSONDecodeError:
            continue
    return containers


def find_container(name_or_label: str) -> Optional[dict]:
    """Find a container whose name contains the given substring."""
    for c in ps_all():
        names = c.get("Names", "")
        if name_or_label == names or name_or_label in names:
            return c
    return None


def inspect(name: str) -> Optional[dict]:
    rc, out, err = _run(["docker", "inspect", name])
    if rc != 0:
        return None
    try:
        return json.loads(out)[0]
    except (json.JSONDecodeError, IndexError):
        return None


_ERROR_RE = re.compile(r"\b(error|exception|fatal|panic|traceback|fail(ed)?)\b", re.IGNORECASE)


def recent_errors(name: str, tail: int = 100, limit: int = 10) -> list[str]:
    rc, out, err = _run(
        ["docker", "logs", "--tail", str(tail), name], timeout=8
    )
    combined = (out or "") + (err or "")
    if not combined:
        return []
    hits: list[str] = []
    for line in combined.splitlines():
        if _ERROR_RE.search(line):
            hits.append(line.strip()[:500])
            if len(hits) >= limit:
                break
    return hits

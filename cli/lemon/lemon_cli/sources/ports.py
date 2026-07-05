"""Parse ~/deploy/ports.json."""
import json
from typing import Any, Optional

from .. import config


def load() -> dict[str, Any]:
    try:
        with open(config.PORTS_JSON, "r") as f:
            return json.load(f)
    except (OSError, json.JSONDecodeError) as e:
        config.dbg(f"ports.json read failed: {e}")
        return {}


def for_app(app: str) -> Optional[Any]:
    """Return either an int port or a dict of {service: port}."""
    data = load()
    return data.get(app)


def flatten(entry: Any) -> list[int]:
    """Turn an int or dict into a list of ports."""
    if entry is None:
        return []
    if isinstance(entry, int):
        return [entry]
    if isinstance(entry, dict):
        return [v for v in entry.values() if isinstance(v, int)]
    return []


def all_ports() -> dict[int, str]:
    """Map port -> 'app[/service]'."""
    out: dict[int, str] = {}
    for app, entry in load().items():
        if isinstance(entry, int):
            out[entry] = app
        elif isinstance(entry, dict):
            for svc, p in entry.items():
                if isinstance(p, int):
                    out[p] = f"{app}/{svc}"
    return out

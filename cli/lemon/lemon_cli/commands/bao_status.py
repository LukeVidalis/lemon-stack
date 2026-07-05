"""OpenBao seal/health status + apps with AppRole credentials."""
import os

from ..sources import bao as b_src
from .. import config

# Bao health endpoint status codes
_STATUS_MAP = {
    200: {"sealed": False, "initialized": True, "label": "active"},
    429: {"sealed": False, "initialized": True, "label": "standby"},
    472: {"sealed": False, "initialized": True, "label": "recovery"},
    501: {"sealed": True, "initialized": False, "label": "not-initialized"},
    503: {"sealed": True, "initialized": True, "label": "sealed"},
}


def run(args) -> dict:
    h = b_src.health()
    code = h.get("status_code", 0)
    data = h.get("data") or {}
    errors: list[str] = []

    status_info = _STATUS_MAP.get(code, {})
    sealed = status_info.get("sealed")
    initialized = status_info.get("initialized")
    label = status_info.get("label", "unknown")

    if not h["reachable"]:
        errors.append("bao unreachable (network error or not running)")
    elif sealed:
        errors.append("bao is sealed — run ~/docker/openbao/unseal.sh")

    # Apps with AppRole credentials on disk
    apps_with_approle: list[str] = []
    try:
        for entry in sorted(os.listdir(config.DOCKER_ROOT)):
            role_path = os.path.join(config.DOCKER_ROOT, entry, ".bao-role-id")
            if os.path.isfile(role_path):
                apps_with_approle.append(entry)
    except OSError as e:
        errors.append(f"could not scan docker root: {e}")

    return {
        "reachable": h["reachable"],
        "status_code": code,
        "status": label,
        "sealed": sealed,
        "initialized": initialized,
        "version": data.get("version"),
        "apps_with_approle": apps_with_approle,
        "approle_count": len(apps_with_approle),
        "errors": errors,
    }


def render_text(r: dict) -> str:
    lines = ["=== bao status ==="]
    lines.append(f"reachable:  {r.get('reachable')}")
    lines.append(f"status:     {r.get('status')} (HTTP {r.get('status_code')})")
    lines.append(f"sealed:     {r.get('sealed')}")
    lines.append(f"version:    {r.get('version') or 'unknown'}")
    apps = r.get("apps_with_approle") or []
    lines.append(f"approle apps ({r.get('approle_count', 0)}): {', '.join(apps) if apps else 'none'}")
    errs = r.get("errors") or []
    if errs:
        lines.append("issues:")
        for e in errs:
            lines.append(f"  ! {e}")
    return "\n".join(lines)

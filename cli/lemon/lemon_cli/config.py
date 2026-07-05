"""Shared paths and constants for the lemon CLI.

All install-specific values come from environment variables so the CLI works
on any lemon-stack host. setup.sh writes these into the shell rc file.
"""
import os

HOME = os.path.expanduser("~")
DEPLOY_DIR = os.environ.get("LEMON_DEPLOY_DIR", os.path.join(HOME, "deploy"))
PORTS_JSON = os.path.join(DEPLOY_DIR, "ports.json")
BAO_FETCH_SH = os.path.join(DEPLOY_DIR, "bao-fetch.sh")
DOCKER_ROOT = os.environ.get("LEMON_DOCKER_ROOT", os.path.join(HOME, "docker"))
CADDYFILE = os.environ.get("LEMON_CADDYFILE", "/etc/caddy/Caddyfile")
BAO_ADDR = os.environ.get("BAO_ADDR", "http://127.0.0.1:8200")
BAO_TOKEN_CACHE = "/tmp/lemon-bao-token"
BAO_TOKEN_TTL = 300  # seconds

# Install-specific identity. Set by setup.sh; fail loudly elsewhere via msg().
DOMAIN = os.environ.get("LEMON_DOMAIN", "")
GITHUB_ORG = os.environ.get("LEMON_GITHUB_ORG", "")
HOSTNAME = os.environ.get("LEMON_HOSTNAME", os.uname().nodename)
PLANE_HOST = os.environ.get("LEMON_PLANE_HOST", f"plane.{DOMAIN}" if DOMAIN else "")

DEBUG = False
NO_BAO = False


def dbg(msg: str) -> None:
    if DEBUG:
        import sys
        print(f"[lemon:debug] {msg}", file=sys.stderr)


def require_domain() -> str:
    """Return LEMON_DOMAIN or raise a clear error if it's unset."""
    if not DOMAIN:
        raise SystemExit(
            "LEMON_DOMAIN is not set. Run setup.sh, or export it in your shell rc."
        )
    return DOMAIN


def require_org() -> str:
    if not GITHUB_ORG:
        raise SystemExit(
            "LEMON_GITHUB_ORG is not set. Run setup.sh, or export it in your shell rc."
        )
    return GITHUB_ORG


def app_host(app: str) -> str:
    return f"{app}.{require_domain()}"

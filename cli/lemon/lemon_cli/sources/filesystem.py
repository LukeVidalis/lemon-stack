"""Filesystem checks under ~/docker/."""
import os
from typing import Optional

from .. import config


def app_dir(app: str) -> str:
    return os.path.join(config.DOCKER_ROOT, app)


def exists(app: str) -> bool:
    return os.path.isdir(app_dir(app))


def has_compose(app: str) -> bool:
    d = app_dir(app)
    return os.path.isfile(os.path.join(d, "docker-compose.yml")) or os.path.isfile(
        os.path.join(d, "compose.yml")
    )


def has_dockerfile(app: str) -> bool:
    return os.path.isfile(os.path.join(app_dir(app), "Dockerfile"))


def has_bao_role(app: str) -> bool:
    d = app_dir(app)
    return os.path.isfile(os.path.join(d, ".bao-role-id")) and os.path.isfile(
        os.path.join(d, ".bao-secret-id")
    )


def secrets_env_key_count(app: str) -> Optional[int]:
    p = os.path.join(app_dir(app), "secrets.env")
    if not os.path.isfile(p):
        return None
    try:
        with open(p, "r") as f:
            n = 0
            for line in f:
                s = line.strip()
                if not s or s.startswith("#"):
                    continue
                if "=" in s:
                    n += 1
            return n
    except OSError:
        return None


def list_app_dirs() -> list[str]:
    """All directory entries under ~/docker/ (best-effort)."""
    try:
        return sorted(
            e for e in os.listdir(config.DOCKER_ROOT)
            if os.path.isdir(os.path.join(config.DOCKER_ROOT, e))
        )
    except OSError:
        return []

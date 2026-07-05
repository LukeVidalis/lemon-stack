"""OpenBao queries via stdlib urllib + AppRole login cached in /tmp."""
import json
import os
import time
import urllib.error
import urllib.request
from typing import Optional

from .. import config


def _http(
    method: str,
    path: str,
    *,
    token: Optional[str] = None,
    body: Optional[dict] = None,
    timeout: float = 3.0,
) -> tuple[int, Optional[dict]]:
    url = config.BAO_ADDR.rstrip("/") + path
    headers = {"Content-Type": "application/json"}
    if token:
        headers["X-Vault-Token"] = token
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    config.dbg(f"bao {method} {url}")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read()
            if not raw:
                return resp.status, None
            return resp.status, json.loads(raw)
    except urllib.error.HTTPError as e:
        return e.code, None
    except (urllib.error.URLError, TimeoutError, OSError, json.JSONDecodeError) as e:
        config.dbg(f"bao error: {e}")
        return 0, None


def health() -> dict:
    code, data = _http("GET", "/v1/sys/health")
    return {"reachable": code != 0, "status_code": code, "data": data}


def _read_app_creds(app: str) -> Optional[tuple[str, str]]:
    role_p = os.path.join(config.DOCKER_ROOT, app, ".bao-role-id")
    secret_p = os.path.join(config.DOCKER_ROOT, app, ".bao-secret-id")
    if not (os.path.isfile(role_p) and os.path.isfile(secret_p)):
        return None
    try:
        with open(role_p) as f:
            role = f.read().strip()
        with open(secret_p) as f:
            secret = f.read().strip()
    except OSError:
        return None
    if not role or not secret:
        return None
    return role, secret


def _cache_path(app: str) -> str:
    return f"{config.BAO_TOKEN_CACHE}-{app}"


def _read_cached_token(app: str) -> Optional[str]:
    path = _cache_path(app)
    try:
        st = os.stat(path)
    except OSError:
        return None
    if time.time() - st.st_mtime > config.BAO_TOKEN_TTL:
        return None
    try:
        with open(path) as f:
            tok = f.read().strip()
        return tok or None
    except OSError:
        return None


def _write_cached_token(app: str, token: str) -> None:
    path = _cache_path(app)
    try:
        # mode 600
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, "w") as f:
            f.write(token)
    except OSError as e:
        config.dbg(f"token cache write failed: {e}")


def login(app: str) -> Optional[str]:
    """Return a client token (cached up to BAO_TOKEN_TTL)."""
    if config.NO_BAO:
        return None
    cached = _read_cached_token(app)
    if cached:
        return cached
    creds = _read_app_creds(app)
    if not creds:
        config.dbg(f"no AppRole creds for {app}")
        return None
    role_id, secret_id = creds
    code, data = _http(
        "POST", "/v1/auth/approle/login",
        body={"role_id": role_id, "secret_id": secret_id},
        timeout=5.0,
    )
    if code != 200 or not data:
        return None
    tok = data.get("auth", {}).get("client_token")
    if tok:
        _write_cached_token(app, tok)
    return tok


def list_keys(app: str) -> dict:
    """Return {reachable, keys, error?}. Keys are leaf names only (no trailing /)."""
    if config.NO_BAO:
        return {"reachable": False, "keys": [], "error": "skipped via --no-bao"}
    h = health()
    if not h["reachable"]:
        return {"reachable": False, "keys": [], "error": "bao unreachable/sealed"}
    token = login(app)
    if not token:
        return {"reachable": True, "keys": [], "error": "approle login failed or missing creds"}
    code, data = _http(
        "GET", f"/v1/secret/metadata/apps/{app}?list=true", token=token, timeout=5.0,
    )
    if code == 404:
        return {"reachable": True, "keys": []}
    if code != 200 or not data:
        return {"reachable": True, "keys": [], "error": f"list failed ({code})"}
    keys = data.get("data", {}).get("keys", []) or []
    leaves = [k for k in keys if not k.endswith("/")]
    return {"reachable": True, "keys": leaves}

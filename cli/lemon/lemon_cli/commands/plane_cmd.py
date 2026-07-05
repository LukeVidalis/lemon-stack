"""Plane project management queries.

Commands:
  lemon plane ls [--state backlog|todo|in-progress|done|cancelled|open]
"""
import csv
import json
import os
import urllib.error
import urllib.request

from .. import config

# Route via Caddy on localhost (port 80 + Host header) to avoid Cloudflare bot detection
PLANE_BASE = "http://localhost/api/v1"
# config.PLANE_HOST resolved lazily via config.config.PLANE_HOST
WORKSPACE = os.environ.get("LEMON_PLANE_WORKSPACE", "")
PROJECT_ID = os.environ.get("LEMON_PLANE_PROJECT_ID", "")
API_KEY_FILE = os.environ.get("LEMON_PLANE_API_KEY_FILE", os.path.join(config.HOME, ".plane-api-key"))

# State IDs in the {{PLANE_PROJECT_PREFIX}} project
_STATES = {
    "backlog":     "2ee3bd1f-099c-40d6-aa87-0325687f4368",
    "todo":        "897788b0-2d97-4899-9751-c7b45a342326",
    "in-progress": "2c5a246a-3fdb-4c3a-9e60-9b53d72ce36e",
    "done":        "62db1238-ee79-42b3-85de-5f73f4a6865a",
    "cancelled":   "2d619b39-f9c5-4ce5-80cf-a52da6a1f458",
}
_OPEN_STATES = {"backlog", "todo", "in-progress"}


def _api_key() -> str | None:
    # Accept either a plain-text key file (one line) or a CSV (row 2, col 4)
    # produced by Plane's API token export.
    try:
        with open(API_KEY_FILE, newline="") as f:
            content = f.read().strip()
            if not content:
                return None
            if "," in content.splitlines()[0]:
                rows = list(csv.reader(content.splitlines()))
                return rows[1][3].strip()
            return content.splitlines()[0].strip()
    except (OSError, IndexError):
        return None


def _get(path: str, api_key: str) -> tuple[int, dict | None]:
    url = PLANE_BASE + path
    config.dbg(f"plane GET {url}")
    req = urllib.request.Request(url, headers={"X-Api-Key": api_key, "Host": config.PLANE_HOST})
    try:
        with urllib.request.urlopen(req, timeout=8) as resp:
            return resp.status, json.loads(resp.read())
    except urllib.error.HTTPError as e:
        return e.code, None
    except (urllib.error.URLError, TimeoutError, OSError) as e:
        config.dbg(f"plane error: {e}")
        return 0, None


def _issue_summary(issue: dict) -> dict:
    return {
        "id": issue.get("sequence_id"),
        "name": issue.get("name"),
        "priority": issue.get("priority"),
        "state_id": issue.get("state"),
        "created_at": (issue.get("created_at") or "")[:10],
        "updated_at": (issue.get("updated_at") or "")[:10],
        "labels": issue.get("label_ids") or [],
    }


def run_ls(args) -> dict:
    state_filter: str = getattr(args, "state", "open")
    api_key = _api_key()
    if not api_key:
        return {"issues": [], "errors": [f"cannot read API key from {API_KEY_FILE}"]}

    if state_filter != "open" and state_filter not in _STATES:
        return {"issues": [], "errors": [f"unknown state '{state_filter}'; choose: open, {', '.join(_STATES)}"]}

    # Fetch all issues and filter client-side (Plane ignores ?state= query param)
    path = f"/workspaces/{WORKSPACE}/projects/{PROJECT_ID}/issues/"
    code, data = _get(path, api_key)
    errors: list[str] = []
    if code == 0 or data is None:
        errors.append("plane unreachable")
        return {"issues": [], "errors": errors}
    if code != 200:
        errors.append(f"plane API returned {code}")
        return {"issues": [], "errors": errors}

    # Build reverse lookup: state_id -> state_name
    state_id_to_name = {v: k for k, v in _STATES.items()}

    if state_filter == "open":
        keep_state_ids = {_STATES[s] for s in _OPEN_STATES}
    else:
        keep_state_ids = {_STATES[state_filter]}

    all_issues: list[dict] = []
    for issue in data.get("results") or []:
        state_id = issue.get("state", "")
        if state_id not in keep_state_ids:
            continue
        summary = _issue_summary(issue)
        summary["state"] = state_id_to_name.get(state_id, state_id)
        all_issues.append(summary)

    all_issues.sort(key=lambda x: (x.get("id") or 0, x.get("state") or ""))

    return {
        "workspace": WORKSPACE,
        "project_id": PROJECT_ID,
        "state_filter": state_filter,
        "count": len(all_issues),
        "issues": all_issues,
        "errors": errors,
    }


def render_ls_text(r: dict) -> str:
    lines = [f"=== plane issues ({r.get('state_filter')}) — {r.get('count', 0)} total ==="]
    for issue in r.get("issues") or []:
        state = issue.get("state", "?")
        pri = (issue.get("priority") or "none")[0].upper()
        lines.append(f"#{issue['id']:<4} [{pri}] [{state:<12}] {issue['name']}")
    errs = r.get("errors") or []
    if errs:
        for e in errs:
            lines.append(f"! {e}")
    return "\n".join(lines)

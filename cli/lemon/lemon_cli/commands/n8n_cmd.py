"""n8n workflow queries via the n8n REST API.

Commands:
  lemon n8n ls                  — list all workflows (id, active, name)
  lemon n8n status <id|name>    — get one workflow's details
"""
import json
import os
import urllib.error
import urllib.parse
import urllib.request

from .. import config

N8N_BASE = "http://localhost:5678/api/v1"
N8N_ENV_FILE = os.path.join(config.HOME, ".config", "lemon", "n8n.env")


def _api_key() -> str:
    key = os.environ.get("N8N_API_KEY")
    if key:
        return key
    try:
        with open(N8N_ENV_FILE) as f:
            for line in f:
                line = line.strip()
                if line.startswith("N8N_API_KEY="):
                    return line.split("=", 1)[1]
    except OSError:
        pass
    return ""


def _get(path: str) -> tuple[int, dict | list | None]:
    url = N8N_BASE + path
    config.dbg(f"n8n GET {url}")
    req = urllib.request.Request(url, headers={"X-N8N-API-KEY": _api_key()})
    try:
        with urllib.request.urlopen(req, timeout=5) as resp:
            return resp.status, json.loads(resp.read())
    except urllib.error.HTTPError as e:
        return e.code, None
    except (urllib.error.URLError, TimeoutError, OSError) as e:
        config.dbg(f"n8n error: {e}")
        return 0, None


def _workflow_summary(w: dict) -> dict:
    return {
        "id": w.get("id"),
        "name": w.get("name"),
        "active": w.get("active"),
        "updated_at": (w.get("updatedAt") or "")[:19],
        "tags": [t.get("name") for t in (w.get("tags") or [])],
    }


def run_ls(args) -> dict:
    code, data = _get("/workflows?limit=100")
    if code == 0 or data is None:
        return {"workflows": [], "errors": ["n8n unreachable or API key invalid"]}
    if code != 200:
        return {"workflows": [], "errors": [f"n8n API returned {code}"]}
    workflows = [_workflow_summary(w) for w in (data.get("data") or [])]
    return {
        "count": len(workflows),
        "workflows": workflows,
        "errors": [],
    }


def run_status(args) -> dict:
    target: str = args.workflow
    # Try as ID first, then search by name
    code, data = _get(f"/workflows/{urllib.parse.quote(target, safe='')}")
    if code == 200 and data:
        return {"workflow": _workflow_summary(data), "nodes": len(data.get("nodes") or []), "errors": []}

    # Fall back to name search
    code, all_data = _get("/workflows?limit=100")
    if code != 200 or all_data is None:
        return {"workflow": None, "errors": [f"n8n API returned {code}"]}
    matches = [w for w in (all_data.get("data") or []) if target.lower() in w.get("name", "").lower()]
    if not matches:
        return {"workflow": None, "errors": [f"no workflow found with id or name matching '{target}'"]}
    w = matches[0]
    return {
        "workflow": _workflow_summary(w),
        "nodes": len(w.get("nodes") or []),
        "matched_by": "name",
        "errors": [],
    }


def render_ls_text(r: dict) -> str:
    lines = [f"=== n8n workflows ({r.get('count', 0)}) ==="]
    for w in r.get("workflows") or []:
        active_mark = "●" if w.get("active") else "○"
        tags = f"  [{', '.join(w['tags'])}]" if w.get("tags") else ""
        lines.append(f"{active_mark} {w['id']:<20} {w['name']}{tags}")
    errs = r.get("errors") or []
    if errs:
        for e in errs:
            lines.append(f"! {e}")
    return "\n".join(lines)


def render_status_text(r: dict) -> str:
    w = r.get("workflow")
    if not w:
        lines = ["=== n8n workflow ===", "not found"]
    else:
        lines = [
            f"=== n8n: {w['name']} ===",
            f"id:      {w['id']}",
            f"active:  {w['active']}",
            f"updated: {w['updated_at']}",
            f"nodes:   {r.get('nodes', '?')}",
            f"tags:    {', '.join(w.get('tags') or []) or 'none'}",
        ]
    errs = r.get("errors") or []
    if errs:
        for e in errs:
            lines.append(f"! {e}")
    return "\n".join(lines)

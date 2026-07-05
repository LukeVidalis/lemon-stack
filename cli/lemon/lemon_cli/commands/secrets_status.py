"""Where does <app>'s secrets live and how many keys."""
from ..sources import bao as b_src
from ..sources import filesystem as fs


def run(args) -> dict:
    app = args.app
    has_role = fs.has_bao_role(app)
    file_count = fs.secrets_env_key_count(app)
    bao_res = b_src.list_keys(app) if has_role else {"reachable": False, "keys": []}

    if has_role and bao_res["reachable"] and bao_res.get("keys"):
        source = "bao"
        key_count = len(bao_res["keys"])
    elif file_count is not None:
        source = "file"
        key_count = file_count
    else:
        source = "none"
        key_count = 0

    return {
        "app": app,
        "source": source,
        "bao_reachable": bao_res["reachable"],
        "key_count": key_count,
        "has_role_id": has_role,
        "file_key_count": file_count,
        **({"bao_error": bao_res["error"]} if bao_res.get("error") else {}),
    }


def render_text(r: dict) -> str:
    lines = [
        f"app:           {r['app']}",
        f"source:        {r['source']}",
        f"key_count:     {r['key_count']}",
        f"bao_reachable: {r['bao_reachable']}",
        f"has_role_id:   {r['has_role_id']}",
        f"file_keys:     {r['file_key_count']}",
    ]
    if r.get("bao_error"):
        lines.append(f"bao_error:     {r['bao_error']}")
    return "\n".join(lines)

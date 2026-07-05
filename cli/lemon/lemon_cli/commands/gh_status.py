"""GitHub Actions run status for a repo in <your GitHub org>."""
import json
import subprocess
from datetime import datetime, timezone

from .. import config

ORG = ""  # lazily resolved via config.require_org() inside handlers


def _run(args: list, timeout: int = 15) -> tuple[int, str, str]:
    config.dbg("exec: " + " ".join(args))
    try:
        p = subprocess.run(args, capture_output=True, text=True, timeout=timeout)
        return p.returncode, p.stdout, p.stderr
    except subprocess.TimeoutExpired:
        return 124, "", "timeout"
    except FileNotFoundError as e:
        return 127, "", str(e)


def _elapsed(run: dict) -> int | None:
    try:
        created = datetime.fromisoformat(run["createdAt"].replace("Z", "+00:00"))
        updated = datetime.fromisoformat(run["updatedAt"].replace("Z", "+00:00"))
        return int((updated - created).total_seconds())
    except Exception:
        return None


def run(args) -> dict:
    repo: str = args.repo
    limit: int = getattr(args, "limit", 5)

    rc, out, err = _run([
        "gh", "run", "list",
        "--repo", f"{config.require_org()}/{repo}",
        "--limit", str(limit),
        "--json", "databaseId,status,conclusion,createdAt,updatedAt,displayTitle,event,headBranch,url",
    ])

    if rc != 0:
        return {
            "repo": repo,
            "org": config.require_org(),
            "latest": None,
            "runs": [],
            "errors": [err.strip() or f"gh exited {rc}"],
        }

    try:
        runs: list[dict] = json.loads(out)
    except json.JSONDecodeError as e:
        return {"repo": repo, "org": config.require_org(), "latest": None, "runs": [], "errors": [str(e)]}

    for r in runs:
        r["elapsed_s"] = _elapsed(r)

    return {
        "repo": repo,
        "org": config.require_org(),
        "latest": runs[0] if runs else None,
        "runs": runs,
        "errors": [],
    }


def render_text(r: dict) -> str:
    lines = [f"=== gh-status: {r['org']}/{r['repo']} ==="]
    runs = r.get("runs") or []
    if not runs:
        lines.append("no runs found")
    for run in runs:
        status = run.get("conclusion") or run.get("status") or "?"
        elapsed = run.get("elapsed_s")
        elapsed_str = f"  ({elapsed}s)" if elapsed is not None else ""
        lines.append(
            f"{run.get('createdAt', '')[:19]}  {status:<12} {run.get('displayTitle', '')[:60]}{elapsed_str}"
        )
    errs = r.get("errors") or []
    if errs:
        for e in errs:
            lines.append(f"! {e}")
    return "\n".join(lines)

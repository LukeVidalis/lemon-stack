"""CI pipeline status and warning analysis for <your GitHub org> repos."""
import json
import re
import subprocess
from datetime import datetime, timezone

from .. import config

ORG = ""  # lazily resolved via config.require_org() inside handlers

# Jobs that carry warning signals from the deploy pipeline
_CHECK_JOBS = {"scan", "size-check", "lighthouse"}

# Per-job patterns that indicate a warning worth surfacing
_WARN_PATTERNS = {
    "scan": [
        # Trivy table output with unfixed HIGH/CRITICAL vulns
        re.compile(r"\b([1-9]\d*)\s+(?:HIGH|CRITICAL)\b"),
        # Our explicit output line
        re.compile(r"\d+\s+HIGH/CRITICAL CVEs"),
    ],
    "size-check": [
        re.compile(r"\bWARNING\b.*\bgrew by\b", re.IGNORECASE),
    ],
    "lighthouse": [
        re.compile(r"scores below threshold", re.IGNORECASE),
        re.compile(r"Lighthouse.*warning", re.IGNORECASE),
    ],
}


def _run(args: list, timeout: int = 20) -> tuple[int, str, str]:
    config.dbg("exec: " + " ".join(args))
    try:
        p = subprocess.run(args, capture_output=True, text=True, timeout=timeout)
        return p.returncode, p.stdout, p.stderr
    except subprocess.TimeoutExpired:
        return 124, "", "timeout"
    except FileNotFoundError as e:
        return 127, "", str(e)


def _age_seconds(iso: str) -> float | None:
    try:
        dt = datetime.fromisoformat(iso.replace("Z", "+00:00"))
        return (datetime.now(timezone.utc) - dt).total_seconds()
    except Exception:
        return None


def _latest_run(repo: str) -> dict | None:
    rc, out, _ = _run([
        "gh", "run", "list",
        "--repo", f"{config.require_org()}/{repo}",
        "--limit", "1",
        "--status", "completed",
        "--json", "databaseId,conclusion,createdAt,updatedAt,displayTitle,url",
    ])
    if rc != 0:
        return None
    try:
        runs = json.loads(out)
        return runs[0] if runs else None
    except Exception:
        return None


def _jobs_for_run(repo: str, run_id: int) -> list[dict]:
    rc, out, _ = _run([
        "gh", "api",
        f"/repos/{config.require_org()}/{repo}/actions/runs/{run_id}/jobs",
        "--jq", ".jobs[] | {id, name, conclusion, started_at, completed_at}",
    ])
    if rc != 0:
        return []
    jobs = []
    for line in out.strip().splitlines():
        try:
            jobs.append(json.loads(line))
        except Exception:
            pass
    return jobs


def _job_logs(repo: str, job_id: int) -> str:
    rc, out, _ = _run([
        "gh", "api",
        f"/repos/{config.require_org()}/{repo}/actions/jobs/{job_id}/logs",
    ], timeout=30)
    if rc != 0:
        return ""
    return out


def _strip_timestamp(line: str) -> str:
    """Remove the leading timestamp GitHub prepends to every log line."""
    # Format: 2026-05-24T19:00:00.0000000Z  message
    return re.sub(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+Z\s*", "", line)


def _parse_warnings(job_name: str, log_text: str) -> list[str]:
    patterns = _WARN_PATTERNS.get(job_name, [])
    if not patterns:
        return []
    warnings = []
    for raw_line in log_text.splitlines():
        line = _strip_timestamp(raw_line)
        for pat in patterns:
            if pat.search(line):
                warnings.append(line.strip())
                break  # one match per line is enough
    return warnings


def run_repo(args) -> dict:
    """lemon ci <repo> — analyse the latest completed run for warnings."""
    repo: str = args.repo

    run = _latest_run(repo)
    if run is None:
        return {
            "repo": repo,
            "run": None,
            "warnings": [],
            "ok": True,
            "errors": [f"no completed runs found for {config.require_org()}/{repo}"],
        }

    run_id = run["databaseId"]
    jobs = _jobs_for_run(repo, run_id)

    # Job names are prefixed by the calling workflow: "deploy / scan" etc.
    check_jobs = [j for j in jobs if j["name"].split(" / ")[-1] in _CHECK_JOBS]

    warnings: list[dict] = []
    for job in check_jobs:
        bare_name = job["name"].split(" / ")[-1]
        logs = _job_logs(repo, job["id"])
        matches = _parse_warnings(bare_name, logs)
        if matches:
            warnings.append({"job": bare_name, "lines": matches})

    age = _age_seconds(run.get("updatedAt", ""))

    return {
        "repo": repo,
        "run": {
            "id": run_id,
            "conclusion": run.get("conclusion"),
            "title": run.get("displayTitle"),
            "url": run.get("url"),
            "age_seconds": int(age) if age is not None else None,
            "jobs_checked": [j["name"].split(" / ")[-1] for j in check_jobs],
        },
        "warnings": warnings,
        "ok": len(warnings) == 0,
        "errors": [],
    }


def run_ls(args) -> dict:
    """lemon ci ls — latest run status for every repo in the org fleet."""
    rc, out, _ = _run([
        "gh", "repo", "list", config.require_org(),
        "--limit", "100",
        "--json", "name",
        "--no-archived",
    ])
    if rc != 0:
        return {"repos": [], "errors": ["could not list org repos"]}

    try:
        repo_names = [r["name"] for r in json.loads(out)]
    except Exception:
        return {"repos": [], "errors": ["failed to parse repo list"]}

    repos = []
    for name in sorted(repo_names):
        run = _latest_run(name)
        if run is None:
            repos.append({"repo": name, "conclusion": None, "age_seconds": None, "url": None})
            continue
        age = _age_seconds(run.get("updatedAt", ""))
        repos.append({
            "repo": name,
            "conclusion": run.get("conclusion"),
            "title": run.get("displayTitle"),
            "url": run.get("url"),
            "age_seconds": int(age) if age is not None else None,
        })

    failures = [r for r in repos if r.get("conclusion") == "failure"]
    return {
        "repos": repos,
        "total": len(repos),
        "failures": len(failures),
        "errors": [],
    }


def render_repo_text(r: dict) -> str:
    lines = [f"=== ci: {r['repo']} ==="]
    run = r.get("run")
    if run:
        age = run.get("age_seconds")
        age_str = f"  ({age // 60}m ago)" if age is not None else ""
        lines.append(f"Run #{run['id']}  {run.get('conclusion', '?')}{age_str}")
        lines.append(f"  {run.get('title', '')}")
        lines.append(f"  {run.get('url', '')}")
        checked = run.get("jobs_checked") or []
        lines.append(f"  Jobs checked: {', '.join(checked) or 'none'}")
    else:
        lines.append("  no completed run found")

    warnings = r.get("warnings") or []
    if warnings:
        lines.append("")
        lines.append("WARNINGS:")
        for w in warnings:
            lines.append(f"  [{w['job']}]")
            for line in w["lines"]:
                lines.append(f"    {line}")
    else:
        lines.append("  No warnings found.")

    errs = r.get("errors") or []
    for e in errs:
        lines.append(f"! {e}")
    return "\n".join(lines)


def render_ls_text(r: dict) -> str:
    lines = ["=== ci ls ==="]
    for repo in r.get("repos") or []:
        conclusion = repo.get("conclusion") or "no runs"
        age = repo.get("age_seconds")
        age_str = f"  ({age // 60}m ago)" if age is not None else ""
        symbol = "✓" if conclusion == "success" else ("✗" if conclusion == "failure" else "·")
        lines.append(f"  {symbol} {repo['repo']:<35} {conclusion}{age_str}")
    summary = f"\n{r.get('total', 0)} repos  |  {r.get('failures', 0)} failures"
    lines.append(summary)
    return "\n".join(lines)

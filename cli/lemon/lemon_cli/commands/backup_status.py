"""Backup status: last run from ~/backup.log + latest restic snapshot."""
import json
import os
import re
import subprocess

from .. import config

BACKUP_LOG = os.path.join(config.HOME, "backup.log")
RESTIC_ENV = os.path.join(config.HOME, ".restic-env")
_TS_RE = re.compile(r"^\[(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})\]")
_COMPLETE_RE = re.compile(r"=== Backup complete ===")
_ERROR_RE = re.compile(r"\b(error|failed|Error|FAILED)\b")


def _parse_log() -> dict:
    """Read backup.log and return info about the most recent run."""
    try:
        with open(BACKUP_LOG) as f:
            lines = f.readlines()
    except OSError:
        return {"found": False, "error": f"cannot read {BACKUP_LOG}"}

    # Walk backwards to find the last "Backup complete" line
    last_complete_ts: str | None = None
    last_complete_idx: int | None = None
    for i in range(len(lines) - 1, -1, -1):
        if _COMPLETE_RE.search(lines[i]):
            m = _TS_RE.match(lines[i])
            if m:
                last_complete_ts = m.group(1)
                last_complete_idx = i
            break

    if last_complete_ts is None:
        return {"found": False, "error": "no completed backup run found in log"}

    # Scan from the previous run boundary (prev "Backup complete" or start)
    # to find any error lines in that run
    run_start = 0
    for i in range(last_complete_idx - 1, -1, -1):
        if _COMPLETE_RE.search(lines[i]):
            run_start = i + 1
            break

    run_lines = lines[run_start:last_complete_idx + 1]
    error_lines = [l.strip() for l in run_lines if _ERROR_RE.search(l)]

    return {
        "found": True,
        "last_complete": last_complete_ts,
        "run_had_errors": len(error_lines) > 0,
        "error_lines": error_lines[:5],
    }


def _restic_latest() -> dict:
    """Get the latest restic snapshot using credentials from ~/.restic-env."""
    env_vars: dict[str, str] = {}
    try:
        with open(RESTIC_ENV) as f:
            for line in f:
                line = line.strip()
                if line.startswith("export "):
                    line = line[len("export "):]
                if "=" in line and not line.startswith("#"):
                    k, _, v = line.partition("=")
                    env_vars[k.strip()] = v.strip().strip('"').strip("'")
    except OSError:
        return {"error": f"cannot read {RESTIC_ENV}"}

    env = {**os.environ, **env_vars}
    config.dbg("exec: restic snapshots --latest 1 --json")
    try:
        p = subprocess.run(
            ["restic", "snapshots", "--latest", "1", "--json"],
            capture_output=True, text=True, timeout=15, env=env,
        )
    except (subprocess.TimeoutExpired, FileNotFoundError) as e:
        return {"error": str(e)}

    if p.returncode != 0:
        return {"error": p.stderr.strip()[:200]}

    try:
        snaps = json.loads(p.stdout)
        if not snaps:
            return {"error": "no snapshots found"}
        s = snaps[-1]
        return {
            "id": s.get("id", "")[:8],
            "time": s.get("time", "")[:19].replace("T", " "),
            "paths": s.get("paths"),
            "tags": s.get("tags"),
        }
    except (json.JSONDecodeError, IndexError) as e:
        return {"error": str(e)}


def run(args) -> dict:
    log_info = _parse_log()
    errors: list[str] = []

    snapshot: dict | None = None
    if not getattr(args, "no_restic", False):
        snapshot = _restic_latest()
        if "error" in snapshot:
            errors.append(f"restic: {snapshot['error']}")

    if not log_info.get("found"):
        errors.append(log_info.get("error", "log not found"))

    if log_info.get("run_had_errors"):
        errors.append("last backup run contained error lines")

    return {
        "last_complete": log_info.get("last_complete"),
        "run_had_errors": log_info.get("run_had_errors", False),
        "error_lines": log_info.get("error_lines", []),
        "latest_snapshot": snapshot,
        "ok": len(errors) == 0,
        "errors": errors,
    }


def render_text(r: dict) -> str:
    lines = ["=== backup status ==="]
    lines.append(f"last_complete:  {r.get('last_complete') or 'unknown'}")
    lines.append(f"run_had_errors: {r.get('run_had_errors')}")
    snap = r.get("latest_snapshot") or {}
    if snap and "error" not in snap:
        lines.append(f"latest_snapshot: {snap.get('id')} at {snap.get('time')}")
    elif snap.get("error"):
        lines.append(f"latest_snapshot: error — {snap['error']}")
    lines.append(f"overall: {'OK' if r.get('ok') else 'DEGRADED'}")
    errs = r.get("errors") or []
    if errs:
        lines.append("issues:")
        for e in errs:
            lines.append(f"  ! {e}")
    return "\n".join(lines)

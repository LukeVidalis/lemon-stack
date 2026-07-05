#!/usr/bin/env python3
"""Ingest memory notes and trajectory JSONL into the FTS5 memory index.

Idempotent: skips sources whose (path, mtime) already match a stored row.
Called by `lemon memory ingest` and by the systemd path-unit watcher.

Sources (lean — see plan.md / {{PLANE_PROJECT_PREFIX}}-50):
  - memory_note: ~/.claude/projects/-home-lemon/memory/*.md (no LLM)
  - trajectory:  ~/claude-runner/logs/trajectories/*.jsonl (Haiku summary)
"""
from __future__ import annotations

import datetime as _dt
import json
import os
import pathlib
import re
import shutil
import sqlite3
import subprocess
import sys
from dataclasses import dataclass

HOME = pathlib.Path.home()
MEMORY_DIR = HOME / ".claude" / "memory"
DB_PATH = MEMORY_DIR / "memory.db"
SCHEMA_PATH = MEMORY_DIR / "schema.sql"

NOTES_DIR = HOME / ".claude" / "projects" / "-home-lemon" / "memory"
TRAJ_DIR = HOME / "claude-runner" / "logs" / "trajectories"

CLAUDE_BIN = shutil.which("claude") or str(HOME / ".local" / "bin" / "claude")
HAIKU_MAX_INPUT = 8 * 1024  # 8 KB cap on prompt input
HAIKU_TIMEOUT = 60          # seconds


def _utcnow() -> str:
    return _dt.datetime.now(_dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def connect() -> sqlite3.Connection:
    MEMORY_DIR.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    with open(SCHEMA_PATH) as f:
        conn.executescript(f.read())
    return conn


@dataclass
class Doc:
    source_type: str
    source_path: str
    source_id: str
    title: str
    raw_text: str
    summary: str
    mtime: float
    meta: dict


def upsert(conn: sqlite3.Connection, d: Doc) -> str:
    """Insert or update; return 'inserted' | 'updated' | 'skipped'."""
    cur = conn.execute(
        "SELECT id, mtime FROM documents WHERE source_type=? AND source_path=?",
        (d.source_type, d.source_path),
    )
    row = cur.fetchone()
    now = _utcnow()
    meta_json = json.dumps(d.meta, ensure_ascii=False, sort_keys=True)
    if row is None:
        conn.execute(
            """INSERT INTO documents
               (source_type, source_path, source_id, title, raw_text, summary,
                mtime, ingested_at, meta_json)
               VALUES (?,?,?,?,?,?,?,?,?)""",
            (d.source_type, d.source_path, d.source_id, d.title, d.raw_text,
             d.summary, d.mtime, now, meta_json),
        )
        return "inserted"
    if abs(row["mtime"] - d.mtime) < 1e-6:
        return "skipped"
    conn.execute(
        """UPDATE documents
           SET source_id=?, title=?, raw_text=?, summary=?, mtime=?,
               ingested_at=?, meta_json=?
           WHERE id=?""",
        (d.source_id, d.title, d.raw_text, d.summary, d.mtime, now,
         meta_json, row["id"]),
    )
    return "updated"


# ---------- memory notes ----------

def _note_title(path: pathlib.Path, text: str) -> str:
    lines = text.splitlines()
    # YAML frontmatter? Pull `name:` if present.
    if lines and lines[0].strip() == "---":
        for line in lines[1:]:
            s = line.strip()
            if s == "---":
                break
            if s.lower().startswith("name:"):
                return s.split(":", 1)[1].strip().strip('"').strip("'")
    for line in lines:
        s = line.strip()
        if s.startswith("# "):
            return s.lstrip("# ").strip()
    return path.stem


def _note_summary(text: str) -> str:
    # Skip YAML frontmatter, then take first non-heading paragraph.
    lines = text.splitlines()
    start = 0
    if lines and lines[0].strip() == "---":
        for i, line in enumerate(lines[1:], start=1):
            if line.strip() == "---":
                start = i + 1
                break
    para: list[str] = []
    for line in lines[start:]:
        s = line.strip()
        if not s:
            if para:
                break
            continue
        if s.startswith("#"):
            continue
        para.append(s)
    return " ".join(para)[:400]


def ingest_note(conn: sqlite3.Connection, path: pathlib.Path) -> str:
    text = path.read_text(encoding="utf-8", errors="replace")
    doc = Doc(
        source_type="memory_note",
        source_path=str(path),
        source_id=path.stem,
        title=_note_title(path, text),
        raw_text=text,
        summary=_note_summary(text),
        mtime=path.stat().st_mtime,
        meta={"size": path.stat().st_size},
    )
    return upsert(conn, doc)


# ---------- trajectories ----------

def _parse_traj(path: pathlib.Path) -> tuple[dict, dict | None, list[dict]]:
    """Return (session_start, session_summary_or_None, tool_calls)."""
    start: dict = {}
    summary: dict | None = None
    tools: list[dict] = []
    with open(path, "r", encoding="utf-8", errors="replace") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                obj = json.loads(line)
            except json.JSONDecodeError:
                continue
            kind = obj.get("kind")
            if kind == "session_start":
                start = obj
            elif kind == "session_summary":
                summary = obj
            elif kind == "tool_call":
                tools.append(obj)
    return start, summary, tools


def _haiku_summarise(prompt: str) -> str:
    """Call `claude -p` with Haiku for a one-shot summary. Empty string on failure."""
    if not CLAUDE_BIN or not os.path.exists(CLAUDE_BIN):
        return ""
    if len(prompt) > HAIKU_MAX_INPUT:
        prompt = prompt[:HAIKU_MAX_INPUT] + "\n[...truncated]"
    try:
        proc = subprocess.run(
            [CLAUDE_BIN, "--model", "haiku",
             "--dangerously-skip-permissions",
             "--no-session-persistence",
             "-p", prompt],
            capture_output=True, text=True, timeout=HAIKU_TIMEOUT,
        )
        if proc.returncode != 0:
            return ""
        out = proc.stdout.strip()
        # Trim wrapping blank lines.
        return re.sub(r"\n{3,}", "\n\n", out)[:1200]
    except Exception:
        return ""


def _traj_digest(start: dict, summary: dict | None, tools: list[dict]) -> str:
    """Build the prompt fed to Haiku."""
    bits = []
    handler = start.get("handler") or "unknown"
    label = start.get("label") or ""
    started = start.get("ts") or ""
    bits.append(f"Run handler: {handler}  label: {label}  started: {started}")
    if summary:
        bits.append(f"Outcome: {summary.get('outcome')}")
        inv = summary.get("investigated") or []
        chg = summary.get("changed") or []
        if inv:
            bits.append("Investigated:")
            bits.extend(f"  - {x}" for x in inv)
        if chg:
            bits.append("Changes made:")
            bits.extend(f"  - {x}" for x in chg)
        tgs = summary.get("tg_summary")
        if tgs:
            bits.append(f"Telegram summary: {tgs}")
        pt = summary.get("plane_ticket")
        if pt:
            bits.append(f"Plane ticket: {pt}")
    if tools:
        bits.append(f"Tool calls (n={len(tools)}); first 20 commands:")
        for t in tools[:20]:
            cmd = (t.get("command") or t.get("tool") or "")[:160]
            bits.append(f"  - {cmd}")
    body = "\n".join(bits)
    return (
        "Summarise this server-maintenance run in 2-3 sentences for future recall. "
        "Lead with what was investigated and the outcome. "
        "Mention concrete things (container names, error keywords, ticket ids) that someone "
        "searching for a recurring incident would type. No preamble.\n\n"
        + body
    )


def ingest_trajectory(conn: sqlite3.Connection, path: pathlib.Path,
                      *, allow_llm: bool = True) -> str:
    start, summary, tools = _parse_traj(path)
    handler = start.get("handler") or path.stem.split("-")[1] if "-" in path.stem else "unknown"
    label = start.get("label") or ""
    outcome = (summary or {}).get("outcome") or "incomplete"
    plane_ticket = (summary or {}).get("plane_ticket") or ""
    tg_summary = (summary or {}).get("tg_summary") or ""
    title_bits = [handler]
    if label:
        title_bits.append(label)
    title_bits.append(outcome)
    if plane_ticket:
        title_bits.append(plane_ticket)
    title = " · ".join(title_bits)

    raw = path.read_text(encoding="utf-8", errors="replace")

    # Only call Haiku when we have a real summary line — otherwise the
    # run was interrupted and there's nothing useful to abstract.
    blurb = ""
    if summary and allow_llm:
        blurb = _haiku_summarise(_traj_digest(start, summary, tools))
    if not blurb:
        # Fall back to a deterministic blurb so search still has something.
        parts = [f"{handler} run, outcome={outcome}"]
        if tg_summary:
            parts.append(tg_summary[:400])
        elif summary and summary.get("investigated"):
            parts.append("investigated: " + ", ".join(summary["investigated"]))
        blurb = ". ".join(parts)

    meta = {
        "handler": handler,
        "label": label,
        "outcome": outcome,
        "plane_ticket": plane_ticket,
        "tool_calls": len(tools),
        "has_summary": summary is not None,
    }
    doc = Doc(
        source_type="trajectory",
        source_path=str(path),
        source_id=path.stem,
        title=title,
        raw_text=raw,
        summary=blurb,
        mtime=path.stat().st_mtime,
        meta=meta,
    )
    return upsert(conn, doc)


# ---------- public API ----------

def ingest_all(*, since: float | None = None, allow_llm: bool = True,
               quiet: bool = False) -> dict:
    """Walk both source dirs; return per-source counters."""
    counts = {
        "memory_note": {"inserted": 0, "updated": 0, "skipped": 0, "errors": 0},
        "trajectory":  {"inserted": 0, "updated": 0, "skipped": 0, "errors": 0},
    }
    conn = connect()
    try:
        if NOTES_DIR.is_dir():
            for p in sorted(NOTES_DIR.glob("*.md")):
                if since is not None and p.stat().st_mtime < since:
                    continue
                try:
                    counts["memory_note"][ingest_note(conn, p)] += 1
                except Exception as e:
                    counts["memory_note"]["errors"] += 1
                    if not quiet:
                        print(f"  ! {p}: {e}", file=sys.stderr)
        if TRAJ_DIR.is_dir():
            for p in sorted(TRAJ_DIR.glob("*.jsonl")):
                if since is not None and p.stat().st_mtime < since:
                    continue
                try:
                    counts["trajectory"][ingest_trajectory(conn, p,
                                                           allow_llm=allow_llm)] += 1
                except Exception as e:
                    counts["trajectory"]["errors"] += 1
                    if not quiet:
                        print(f"  ! {p}: {e}", file=sys.stderr)
        conn.commit()
    finally:
        conn.close()
    return counts


def ingest_path(path: pathlib.Path, *, allow_llm: bool = True) -> str:
    """Single-file ingest dispatch by path location."""
    conn = connect()
    try:
        if NOTES_DIR in path.parents and path.suffix == ".md":
            r = ingest_note(conn, path)
        elif TRAJ_DIR in path.parents and path.suffix == ".jsonl":
            r = ingest_trajectory(conn, path, allow_llm=allow_llm)
        else:
            raise ValueError(f"unknown source path: {path}")
        conn.commit()
        return r
    finally:
        conn.close()


def reindex() -> int:
    """Rebuild FTS from documents. Returns row count."""
    conn = connect()
    try:
        conn.execute("INSERT INTO documents_fts(documents_fts) VALUES('rebuild')")
        conn.commit()
        return conn.execute("SELECT COUNT(*) FROM documents").fetchone()[0]
    finally:
        conn.close()


def stats() -> dict:
    conn = connect()
    try:
        out = {"db": str(DB_PATH), "size_bytes": DB_PATH.stat().st_size}
        out["by_source"] = {}
        for row in conn.execute(
            "SELECT source_type, COUNT(*) AS n, MAX(ingested_at) AS last "
            "FROM documents GROUP BY source_type"
        ):
            out["by_source"][row["source_type"]] = {
                "count": row["n"], "last_ingested": row["last"],
            }
        out["total"] = sum(v["count"] for v in out["by_source"].values())
        return out
    finally:
        conn.close()


def search(query: str, *, limit: int = 10, source_type: str | None = None,
           since: str | None = None) -> list[dict]:
    conn = connect()
    try:
        sql = (
            "SELECT d.id, d.source_type, d.source_path, d.source_id, d.title, "
            "       d.summary, d.ingested_at, d.meta_json, "
            "       bm25(documents_fts, 5.0, 2.0, 1.0) AS score "
            "FROM documents_fts "
            "JOIN documents d ON d.id = documents_fts.rowid "
            "WHERE documents_fts MATCH ? "
        )
        params: list = [query]
        if source_type:
            sql += "AND d.source_type = ? "
            params.append(source_type)
        if since:
            sql += "AND d.ingested_at >= ? "
            params.append(since)
        sql += "ORDER BY score LIMIT ?"
        params.append(limit)
        rows = []
        for r in conn.execute(sql, params):
            rows.append({
                "id": r["id"],
                "source_type": r["source_type"],
                "source_path": r["source_path"],
                "source_id": r["source_id"],
                "title": r["title"],
                "summary": r["summary"],
                "ingested_at": r["ingested_at"],
                "score": r["score"],
                "meta": json.loads(r["meta_json"] or "{}"),
            })
        return rows
    finally:
        conn.close()


def show(doc_id: int) -> dict | None:
    conn = connect()
    try:
        r = conn.execute(
            "SELECT * FROM documents WHERE id = ?", (doc_id,)
        ).fetchone()
        if r is None:
            return None
        out = dict(r)
        out["meta"] = json.loads(out.pop("meta_json") or "{}")
        return out
    finally:
        conn.close()


# ---------- CLI fallback (also reachable via `lemon memory`) ----------

def _main(argv: list[str]) -> int:
    import argparse
    ap = argparse.ArgumentParser(prog="memory-ingest")
    sub = ap.add_subparsers(dest="cmd", required=True)
    p_ing = sub.add_parser("ingest")
    p_ing.add_argument("--since", type=float, help="epoch seconds")
    p_ing.add_argument("--no-llm", action="store_true")
    p_ing.add_argument("--path", help="single file to ingest")
    sub.add_parser("reindex")
    sub.add_parser("stats")
    p_sr = sub.add_parser("search")
    p_sr.add_argument("query")
    p_sr.add_argument("--limit", type=int, default=10)
    p_sr.add_argument("--type")
    args = ap.parse_args(argv)
    if args.cmd == "ingest":
        if args.path:
            r = ingest_path(pathlib.Path(args.path), allow_llm=not args.no_llm)
            print(r)
        else:
            print(json.dumps(ingest_all(since=args.since,
                                        allow_llm=not args.no_llm), indent=2))
    elif args.cmd == "reindex":
        print(json.dumps({"rows": reindex()}))
    elif args.cmd == "stats":
        print(json.dumps(stats(), indent=2))
    elif args.cmd == "search":
        for r in search(args.query, limit=args.limit, source_type=args.type):
            print(json.dumps(r, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(_main(sys.argv[1:]))

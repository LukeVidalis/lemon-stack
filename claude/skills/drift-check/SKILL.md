---
name: drift-check
description: "Detect and fix doc drift across CLAUDE.md, ~/.claude/skills, the Obsidian vault, and project READMEs. Verifies extracted claims (paths, containers, ports, subdomains, services, skills, vault refs) against live system state. Run weekly or after major server changes."
allowed-tools:
  - Bash
  - Read
  - Edit
  - Write
  - Grep
  - Glob
---

<objective>
Find and fix outdated facts in documentation. The heavy lifting (claim extraction, system probing, diff) is done by deterministic scripts so this skill spends almost no tokens on a clean run.

Use when the user says "drift check", "verify docs", "is anything stale", "weekly drift", or after major server reconfiguration.
</objective>

<how-it-works>
Three scripts in `scripts/`:

1. **`extract.py`** — regex-based claim extractor. Reads a markdown doc on stdin, emits structured claims as JSON. Claim types: `path`, `container`, `port`, `subdomain`, `command`, `service`, `skill`, `vault`.
2. **`verify.py`** — checks each claim against live state with one cached shell call per category (`docker ps`, `ss -tln`, Caddyfile, etc.). Emits only failures.
3. **`scan.sh`** — orchestrates: hashes each doc, skips unchanged ones (incremental), feeds changed ones to `extract.py`, then runs `verify.py` over all claims, then renders `report.md`.

State lives in `~/.claude/drift/`:
- `index.json` — per-doc fingerprint + cached claims
- `report.md` — human-readable findings (the only thing you read)
- `report.json` — machine-readable findings
- `run-log.jsonl` — append-only run history; one JSON line per scan with `ts`, `mode`, `docs`, `claims`, `findings`

Each scan prints "Last run: Xd Yh ago (ISO timestamp) — N finding(s)" to stderr before scanning, so you always know how stale the last check is.
</how-it-works>

<workflow>
## Step 1 — Run the scan

```bash
bash ~/.claude/skills/drift-check/scripts/scan.sh
```

Modes:
- (default) incremental — only re-extracts docs whose content hash changed
- `--force` — full re-extract; use after editing extract.py or once a month
- `--report-only` — re-verify cached claims without re-extracting (fastest)

Extra flags (composable with any mode):
- `--scope <repo>` — limit manifest to docs that mention `<repo>` (plus its
  workspace README/CLAUDE.md if found under `~/projects/<repo>` or
  `~/docker/<repo>`). Used by `deploy.sh` post-deploy. Writes its index +
  report to `~/.claude/drift/scoped/<repo>.{index,report}.{json,md}` so the
  global cache is never clobbered.
- `--notify-on-drift` — send a tg-notify message only when the set of findings
  differs from the previous run (per-scope fingerprint stored in
  `~/.claude/drift/scoped/<scope>.prev-fingerprint`).

The script reads everything itself. Do NOT pre-read CLAUDE.md, skills, or vault docs.

## Step 2 — Read the report

```bash
cat ~/.claude/drift/report.md
```

Clean output ("No drift detected") → tell the user, done.

Otherwise, you'll see a list grouped by doc:
```
## skill:deploy
- L42 **container** `n8n` → container not running
  > Logs flow from n8n container to Loki via Promtail.
```

## Step 3 — Triage each finding

For every finding, decide which is wrong:

- **Doc is stale (most common)** — system reality changed; update the doc.
  - For `~/.claude/CLAUDE.md` and `~/.claude/skills/*/SKILL.md`: use Edit.
  - For vault docs (`vault:foo.md`): write to a temp file, then `sudo docker cp /tmp/foo.md obsidian:/config/obsidian/Lemon-vault/foo.md`. Read current content first via `sudo cat /var/lib/docker/volumes/obsidian_obsidian_config/_data/obsidian/Lemon-vault/foo.md`.
- **System is wrong** — something that should be running isn't. Flag to the user; do not edit docs.
- **False positive** — extractor caught a non-claim (example, hypothetical, archived feature). Two options:
  - Mark the line in the doc with surrounding context that makes it obviously non-literal (e.g. wrap example values in "example:" prose).
  - If the extractor is genuinely too greedy for a recurring pattern, propose a regex tweak to `scripts/extract.py` and ask before editing.

Only Read the specific doc you're about to fix. Never re-read the whole corpus.

## Step 4 — Re-verify

```bash
bash ~/.claude/skills/drift-check/scripts/scan.sh --force
```

Confirm `report.md` is clean (or only contains items you've consciously deferred). Tell the user a one-line summary: docs touched, findings remaining.

## Step 5 — If you added or moved infrastructure during this session

If the user *just* changed something (added a service, renamed a container, moved a path), run `--force` once at the end of the work — the new fact will be ingested and locked in by hash, so next week's run won't flag it.
</workflow>

<token-budget>
Clean weekly run: ~3k tokens (this SKILL.md + report.md only).
Dirty run with N findings: + ~500 tokens per affected doc (read + edit).
First-ever run (no index): same as `--force`, expect ~5k tokens for SKILL+report; doc reads only happen during fixes.
</token-budget>

<extending>
- **Add a claim type:** edit `scripts/extract.py` (regex + emit) and `scripts/verify.py` (deterministic check using a cached snapshot — never one-shell-per-claim).
- **Add docs to scan:** edit the `manifest()` function in `scripts/scan.sh`. To include project READMEs, add a `find ~/projects -name README.md -maxdepth 3` block.
- **Tighten false positives:** the `CONTAINER_NAMED` set in extract.py is the allowlist for ambiguous backticked tokens. Add new container names there.
- **Per-claim suppression:** if a doc deliberately contains stale or example references, prefix the line with `<!-- drift:ignore -->` and add a one-line skip in extract.py — do this rather than weakening regex.
</extending>

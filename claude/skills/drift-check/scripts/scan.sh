#!/usr/bin/env bash
# Drift scanner orchestrator.
#
# Modes:
#   scan.sh              — incremental: only re-extract docs whose hash changed
#   scan.sh --force      — full re-extract of every doc
#   scan.sh --report-only — re-verify cached claims without re-extracting
#
# Extra flags (composable with any mode):
#   --scope <repo>        Limit manifest to docs that mention <repo> (plus the
#                         repo's own README/CLAUDE.md if its workspace is found
#                         under ~/projects/<repo> or ~/docker/<repo>). Used by
#                         deploy.sh post-deploy to keep scoped scans cheap.
#   --notify-on-drift     Send a tg-notify summary if (and only if) the set of
#                         findings differs from the previous scoped report.
#
# Outputs:
#   ~/.claude/drift/index.json   — per-doc fingerprint + extracted claims
#   ~/.claude/drift/report.md    — human-readable drift findings (only failures)
#   ~/.claude/drift/report.json  — machine-readable findings
#   ~/.claude/drift/scoped/<repo>.json  — per-scope previous findings (for diff)
set -euo pipefail

DRIFT_DIR="$HOME/.claude/drift"
SKILL_DIR="$HOME/.claude/skills/drift-check"
INDEX="$DRIFT_DIR/index.json"
REPORT_MD="$DRIFT_DIR/report.md"
REPORT_JSON="$DRIFT_DIR/report.json"
EXTRACT="$SKILL_DIR/scripts/extract.py"
VERIFY="$SKILL_DIR/scripts/verify.py"
VAULT="/var/lib/docker/volumes/obsidian_obsidian_config/_data/obsidian/Lemon-vault"

RUN_LOG="$DRIFT_DIR/run-log.jsonl"

mkdir -p "$DRIFT_DIR" "$DRIFT_DIR/scoped"
[[ -f "$INDEX" ]] || echo '{}' > "$INDEX"

# ---- Parse flags (mode + extras) ----
MODE="incremental"
SCOPE=""
NOTIFY_ON_DRIFT=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --force|--report-only) MODE="$1"; shift ;;
    --scope) SCOPE="${2:-}"; shift 2 ;;
    --scope=*) SCOPE="${1#--scope=}"; shift ;;
    --notify-on-drift) NOTIFY_ON_DRIFT=1; shift ;;
    incremental) MODE="incremental"; shift ;;
    *) echo "scan.sh: unknown arg: $1" >&2; exit 2 ;;
  esac
done

# ---- Report time since last run ----
if [[ -f "$RUN_LOG" ]] && [[ -s "$RUN_LOG" ]]; then
  python3 -c "
import json, sys
from datetime import datetime, timezone
last = None
with open('$RUN_LOG') as f:
    for line in f:
        line = line.strip()
        if line:
            last = json.loads(line)
if last:
    ts = datetime.fromisoformat(last['ts'].replace('Z','+00:00'))
    now = datetime.now(timezone.utc)
    delta = now - ts
    days = delta.days
    hours, rem = divmod(delta.seconds, 3600)
    mins = rem // 60
    if days > 0:
        age = f'{days}d {hours}h ago'
    elif hours > 0:
        age = f'{hours}h {mins}m ago'
    else:
        age = f'{mins}m ago'
    print(f'Last run: {age} ({last[\"ts\"]}) — {last[\"findings\"]} finding(s), {last[\"mode\"]} mode', file=sys.stderr)
" 2>&1
else
  echo "No previous run recorded." >&2
fi

# ---- Collect docs to scan ----
# Each entry: <kind>\t<id>\t<source-path-or-cmd-to-stdout>
manifest() {
  # CLAUDE.md
  echo -e "claude\tCLAUDE.md\t$HOME/.claude/CLAUDE.md"
  # Skills
  while IFS= read -r f; do
    name=$(basename "$(dirname "$f")")
    [[ "$name" == "drift-check" ]] && continue  # don't drift-check ourselves
    echo -e "skill\t$name\t$f"
  done < <(find "$HOME/.claude/skills" -maxdepth 2 -name SKILL.md 2>/dev/null)
  # Vault docs (read via sudo+docker)
  for vf in $(sudo ls "$VAULT" 2>/dev/null | grep '\.md$'); do
    echo -e "vault\t$vf\tsudo:$VAULT/$vf"
  done
  # Repo's own docs (only when --scope <repo> is set and a workspace exists)
  if [[ -n "$SCOPE" ]]; then
    for base in "$HOME/projects" "$HOME/docker" "$HOME"; do
      for doc in README.md CLAUDE.md .planning/intel/README.md; do
        local p="$base/$SCOPE/$doc"
        [[ -f "$p" ]] && echo -e "repo\t${SCOPE}/${doc}\t$p"
      done
    done
  fi
}

# Filter manifest by --scope: keep only docs whose content mentions the scope
# token (word-bounded). The repo's own docs (kind=repo) are always kept.
scoped_manifest() {
  if [[ -z "$SCOPE" ]]; then
    manifest
    return
  fi
  while IFS=$'\t' read -r kind id src; do
    if [[ "$kind" == "repo" ]]; then
      echo -e "${kind}\t${id}\t${src}"
      continue
    fi
    local content
    if [[ "$src" == sudo:* ]]; then
      content=$(sudo cat "${src#sudo:}" 2>/dev/null || true)
    else
      content=$(cat "$src" 2>/dev/null || true)
    fi
    if echo "$content" | grep -qw -- "$SCOPE"; then
      echo -e "${kind}\t${id}\t${src}"
    fi
  done < <(manifest)
}

read_doc() {
  local src="$1"
  if [[ "$src" == sudo:* ]]; then
    sudo cat "${src#sudo:}"
  else
    cat "$src"
  fi
}

# ---- Build new index by extracting claims from docs ----
# In scoped mode, --report-only re-uses the scoped index from the previous run.
if [[ -n "$SCOPE" && "$MODE" == "--report-only" ]]; then
  INDEX="$DRIFT_DIR/scoped/${SCOPE}.index.json"
  [[ -f "$INDEX" ]] || { echo "scan.sh: no cached scoped index for $SCOPE" >&2; exit 2; }
fi
if [[ "$MODE" == "--report-only" ]]; then
  python3 -c "
import json, sys
idx = json.load(open('$INDEX'))
docs = len(idx.get('docs', {}))
claims = len(idx.get('all_claims', []))
print(f'Using cached index: {docs} docs, {claims} claims (report-only)', file=sys.stderr)
" 2>&1
else
  TMP_INDEX=$(mktemp)
  echo '{"docs": {}, "all_claims": []}' > "$TMP_INDEX"

  OLD_INDEX=$(cat "$INDEX")

  while IFS=$'\t' read -r kind id src; do
    content=$(read_doc "$src" 2>/dev/null || echo "")
    [[ -z "$content" ]] && continue
    hash=$(echo "$content" | sha256sum | cut -c1-16)
    doc_key="${kind}:${id}"

    cached_hash=$(echo "$OLD_INDEX" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('docs',{}).get('$doc_key',{}).get('hash',''))" 2>/dev/null || echo "")

    if [[ "$MODE" == "--force" || "$cached_hash" != "$hash" ]]; then
      claims=$(echo "$content" | python3 "$EXTRACT" "$doc_key" 2>/dev/null || echo "[]")
    else
      # Reuse cached claims
      claims=$(echo "$OLD_INDEX" | python3 -c "import json,sys; d=json.load(sys.stdin); print(json.dumps(d.get('docs',{}).get('$doc_key',{}).get('claims',[])))")
    fi

    # Merge into index
    python3 -c "
import json
with open('$TMP_INDEX') as f: idx = json.load(f)
idx['docs']['$doc_key'] = {'kind':'$kind','id':'$id','hash':'$hash','claims':$claims}
with open('$TMP_INDEX','w') as f: json.dump(idx, f, indent=2)
"
  done < <(scoped_manifest)

  # Flatten all claims
  python3 -c "
import json
with open('$TMP_INDEX') as f: idx = json.load(f)
all_c = []
for k,v in idx['docs'].items():
    all_c.extend(v['claims'])
idx['all_claims'] = all_c
with open('$TMP_INDEX','w') as f: json.dump(idx, f, indent=2)
print(f'Indexed {len(idx[\"docs\"])} docs, {len(all_c)} claims', file=__import__('sys').stderr)
"

  # In scoped mode, never overwrite the global index — we'd lose claims for
  # docs that weren't in scope. Write the slice to a per-scope file instead.
  if [[ -n "$SCOPE" ]]; then
    mv "$TMP_INDEX" "$DRIFT_DIR/scoped/${SCOPE}.index.json"
    INDEX="$DRIFT_DIR/scoped/${SCOPE}.index.json"
  else
    mv "$TMP_INDEX" "$INDEX"
  fi
fi

# In scoped mode, write reports to scoped/ so we don't clobber the global view.
if [[ -n "$SCOPE" ]]; then
  REPORT_MD="$DRIFT_DIR/scoped/${SCOPE}.report.md"
  REPORT_JSON="$DRIFT_DIR/scoped/${SCOPE}.report.json"
fi

# ---- Verify all claims ----
python3 -c "import json; d=json.load(open('$INDEX')); print(json.dumps(d['all_claims']))" \
  | python3 "$VERIFY" > "$REPORT_JSON"

# ---- Render markdown report ----
python3 <<PY > "$REPORT_MD"
import json
from collections import defaultdict
findings = json.load(open("$REPORT_JSON"))
print("# Drift report")
print()
if not findings:
    print("No drift detected. All claims verified.")
else:
    print(f"**{len(findings)} finding(s)** — claims that no longer match reality.")
    print()
    by_doc = defaultdict(list)
    for f in findings:
        by_doc[f["doc"]].append(f)
    for doc, items in sorted(by_doc.items()):
        print(f"## {doc}")
        for it in items:
            print(f"- L{it['line']} **{it['type']}** \`{it['value']}\` → {it['actual']}")
            print(f"  > {it['context']}")
        print()
PY

echo "Report: $REPORT_MD"
wc -l "$REPORT_MD"

# ---- Append run record to log ----
python3 -c "
import json, sys
from datetime import datetime, timezone
findings = json.load(open('$REPORT_JSON'))
idx = json.load(open('$INDEX'))
record = {
    'ts': datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
    'mode': '$MODE',
    'docs': len(idx.get('docs', {})),
    'claims': len(idx.get('all_claims', [])),
    'findings': len(findings),
}
with open('$RUN_LOG', 'a') as f:
    f.write(json.dumps(record) + '\n')
"

# ---- Notify on (new) drift -------------------------------------------------
# Activated by --notify-on-drift. Fires a tg-notify message only when the
# findings differ from the previous scoped report. Compares by a normalised
# fingerprint (doc + type + value) so cosmetic changes don't re-fire.
if [[ "$NOTIFY_ON_DRIFT" -eq 1 ]]; then
  PREV_FILE="$DRIFT_DIR/scoped/${SCOPE:-_global}.prev-fingerprint"
  CUR_FP=$(python3 -c "
import json, hashlib
fs = json.load(open('$REPORT_JSON'))
keys = sorted([(f['doc'], f['type'], f['value']) for f in fs])
h = hashlib.sha256(repr(keys).encode()).hexdigest()
print(f'{len(fs)} {h}')
")
  CUR_COUNT=${CUR_FP%% *}
  PREV_FP=$(cat "$PREV_FILE" 2>/dev/null || echo "")
  echo "$CUR_FP" > "$PREV_FILE"

  if [[ "$CUR_COUNT" -gt 0 && "$CUR_FP" != "$PREV_FP" ]]; then
    SECRETS_FILE="$HOME/docker/tg-notify/secrets.env"
    if [[ -f "$SECRETS_FILE" ]]; then
      API_SECRET=$(grep '^API_SECRET=' "$SECRETS_FILE" | cut -d= -f2-)
      SUMMARY=$(python3 -c "
import json
fs = json.load(open('$REPORT_JSON'))
from collections import Counter
by_doc = Counter(f['doc'] for f in fs)
lines = [f'• {d}: {n}' for d, n in by_doc.most_common(8)]
print('\n'.join(lines))
")
      SCOPE_TAG="${SCOPE:-global}"
      TITLE="⚠️ Drift detected ($SCOPE_TAG): $CUR_COUNT finding(s)"
      MSG="$SUMMARY

Full report: $REPORT_MD
Run \`/drift-check\` to triage and fix."
      JSON_PAYLOAD=$(python3 -c "
import json, os
print(json.dumps({'level':'warning','title':os.environ['T'],'message':os.environ['M']}))
" T="$TITLE" M="$MSG")
      curl -sf -X POST http://127.0.0.1:10020/send \
        -H "Authorization: Bearer $API_SECRET" \
        -H "Content-Type: application/json" \
        -d "$JSON_PAYLOAD" > /dev/null || true
    fi
  fi
fi

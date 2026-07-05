#!/usr/bin/env bash
# promote.sh — copy a live lemon-server file into the lemon-stack repo,
# applying personal-data → {{VAR}} substitutions and placing it at the
# correct repo path (with .template suffix where required).
#
# Live-first workflow:
#   1. Edit and test on the host (e.g. ~/.claude/skills/foo/SKILL.md).
#   2. Run `./scripts/promote.sh <live-path>` here.
#   3. Review staged diff with `git diff --cached`, then commit + push.
#
# Mapping table (live → repo target):
#   ~/.claude/skills/<name>/...          → claude/skills/<name>/...
#   ~/.claude/agents/<name>.md           → claude/agents/<name>.md
#   ~/deploy/<file>                      → deploy/<file>.template
#   ~/bin/<file>                         → bin/<file>.template
#   ~/claude-runner/<rel>                → apps/claude-runner/<rel>   (already-templated, no .template suffix)
#   ~/docker/<svc>/docker-compose.yml    → infra/<svc>/docker-compose.yml.template
#   ~/docker/<svc>/Caddyfile.fragment    → infra/<svc>/Caddyfile.fragment.template
#   ~/docker/<svc>/Caddyfile             → infra/<svc>/Caddyfile.template
#   ~/docker/<svc>/<other-config>        → infra/<svc>/<other-config>.template
#
# Files that legitimately stay host-only (dashboard inventories, personal
# telemetry, machine-specific migration patches) should NOT be promoted —
# leave them on the host and add a `# host-only` comment if needed.
#
# Usage:
#   ./scripts/promote.sh <live-path> [<live-path> ...]
#   ./scripts/promote.sh --dry-run <live-path>     show target + diff, don't write
#   ./scripts/promote.sh --no-stage <live-path>    write but don't `git add`
#
# Exits non-zero if `scripts/check-templates.sh` finds any leak after promotion,
# so a bad promote cannot be pushed.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

DRY=0
STAGE=1
PATHS=()
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY=1 ;;
    --no-stage) STAGE=0 ;;
    -h|--help) sed -n '2,33p' "$0"; exit 0 ;;
    --*) echo "unknown flag: $arg" >&2; exit 2 ;;
    *) PATHS+=("$arg") ;;
  esac
done
[[ ${#PATHS[@]} -gt 0 ]] || { echo "usage: $0 <live-path> [...]" >&2; exit 2; }

# Resolve a live path to its in-repo target. Echoes "<target>|<needs_template_suffix>".
# Returns non-zero if the path is outside the known mapping.
resolve_target() {
  local p="$1"
  # Normalise to absolute path under $HOME without requiring existence.
  case "$p" in
    /*) ;;
    ~/*) p="$HOME/${p#~/}" ;;
    *) p="$PWD/$p" ;;
  esac

  local rel target needs_template=1
  if [[ $p == "$HOME/.claude/skills/"* ]]; then
    rel="${p#$HOME/.claude/skills/}"
    target="claude/skills/$rel"
    needs_template=0
  elif [[ $p == "$HOME/.claude/agents/"* ]]; then
    rel="${p#$HOME/.claude/agents/}"
    target="claude/agents/$rel"
    needs_template=0
  elif [[ $p == "$HOME/deploy/"* ]]; then
    rel="${p#$HOME/deploy/}"
    target="deploy/$rel"
  elif [[ $p == "$HOME/bin/"* ]]; then
    rel="${p#$HOME/bin/}"
    target="bin/$rel"
  elif [[ $p == "$HOME/claude-runner/"* ]]; then
    rel="${p#$HOME/claude-runner/}"
    # claude-runner ships under apps/claude-runner/ in the repo. Files are
    # stored already-templated WITHOUT a .template suffix (see install.sh).
    if [[ ! -d "apps/claude-runner" ]]; then
      return 1
    fi
    target="apps/claude-runner/$rel"
    needs_template=0
  elif [[ $p == "$HOME/docker/"* ]]; then
    rel="${p#$HOME/docker/}"
    # First path segment is the service name. Only allow promotion if a matching
    # infra/<svc>/ directory already exists upstream — otherwise this is almost
    # certainly a pipeline-generated compose (output of deploy.sh) and must not
    # be templated back into the repo.
    local svc="${rel%%/*}"
    if [[ ! -d "infra/$svc" ]]; then
      return 1
    fi
    target="infra/$rel"
  else
    return 1
  fi

  if [[ $needs_template -eq 1 ]]; then
    target="${target}.template"
  fi
  printf '%s|%d|%s\n' "$target" "$needs_template" "$p"
}

promote_one() {
  local live="$1"
  if [[ ! -f $live ]]; then
    echo "SKIP: $live — file not found on host"
    return 1
  fi

  local resolved target needs_template src
  if ! resolved=$(resolve_target "$live"); then
    echo "SKIP: $live — outside the promote mapping (host-only or unknown layout)" >&2
    return 1
  fi
  IFS='|' read -r target needs_template src <<<"$resolved"

  echo "── $live → $target ──"
  mkdir -p "$(dirname "$target")"

  # Copy then templatize in-place. template-skill.sh handles all the standard
  # personal-data substitutions; markdown/.md files end up rendered as-is too.
  if [[ $DRY -eq 1 ]]; then
    local tmp
    tmp=$(mktemp)
    cp "$src" "$tmp"
    bash scripts/template-skill.sh "$tmp" >/dev/null 2>&1 || true
    if [[ -f $target ]]; then
      diff -u "$target" "$tmp" || true
    else
      echo "(new file would be created at $target)"
      head -40 "$tmp"
    fi
    rm -f "$tmp"
    return 0
  fi

  cp "$src" "$target"
  bash scripts/template-skill.sh "$target" >/dev/null 2>&1 || true

  if [[ $STAGE -eq 1 ]]; then
    git add "$target"
  fi
}

errors=0
for p in "${PATHS[@]}"; do
  promote_one "$p" || errors=$((errors + 1))
done

if [[ $DRY -eq 1 ]]; then
  exit $errors
fi

# Leak guard: if anything personal slipped through, fail loudly and unstage.
if ! bash scripts/check-templates.sh >/dev/null 2>&1; then
  echo
  echo "promote: LEAK DETECTED. Running scripts/check-templates.sh for details:" >&2
  bash scripts/check-templates.sh >&2 || true
  echo "promote: unstaging — fix template-skill.sh patterns and re-run." >&2
  for p in "${PATHS[@]}"; do
    resolved=$(resolve_target "$p" 2>/dev/null) || continue
    IFS='|' read -r target _ _ <<<"$resolved"
    git reset HEAD -- "$target" >/dev/null 2>&1 || true
  done
  exit 1
fi

if [[ $errors -gt 0 ]]; then
  echo
  echo "promote: completed with $errors skipped path(s)." >&2
fi

echo
echo "Done. Review with: git diff --cached"
echo "Then: git commit -m '<msg>' && git push origin main"

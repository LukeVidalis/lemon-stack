#!/usr/bin/env bash
# install-skills.sh — copy claude/skills/ into agent skill dirs and render CLAUDE.md.template.
# Skills already in target dirs are left alone unless --force is passed (so user edits survive).

set -euo pipefail

cd "$(dirname "$0")/.."
FORCE=0
[[ "${1:-}" == --force ]] && FORCE=1

# Skills ship with {{VAR}} placeholders (same convention as *.template files).
# Render them in the installed copies from setup/parameters.env; the repo
# copies keep their placeholders. Blank values substitute to empty — the
# render-templates.sh blank-parameter warning covers visibility.
PARAMS="${PARAMS:-setup/parameters.env}"
SED_ARGS=()
if [[ -f $PARAMS ]]; then
  while IFS='=' read -r key val; do
    [[ -z $key || $key == \#* ]] && continue
    esc=$(printf '%s' "$val" | sed -e 's/[\/&|]/\\&/g')
    SED_ARGS+=(-e "s|{{$key}}|$esc|g")
  done < <(grep -E '^[A-Z_][A-Z0-9_]*=' "$PARAMS")
else
  echo "install-skills: $PARAMS not found — installing skills with {{VAR}} placeholders unrendered." >&2
fi

render_placeholders_in() {
  [[ ${#SED_ARGS[@]} -eq 0 ]] && return 0
  find "$1" -type f -print0 | while IFS= read -r -d '' f; do
    grep -Iq . "$f" 2>/dev/null || continue
    grep -Eq '\{\{[A-Z_]+\}\}' "$f" || continue
    sed -i "${SED_ARGS[@]}" "$f"
  done
}

install_skills_to() {
  local label="$1"
  local target="$2"
  local installed=0
  local skipped=0

  mkdir -p "$target"
  for src in claude/skills/*/; do
    name=$(basename "$src")
    dst="$target/$name"
    if [[ -d $dst && $FORCE -eq 0 ]]; then
      skipped=$((skipped+1)); continue
    fi
    rsync -a --delete "$src" "$dst/"
    render_placeholders_in "$dst"
    installed=$((installed+1))
  done
  echo "$label skills: installed=$installed skipped=$skipped (use --force to overwrite)"
}

install_skills_to "claude" "$HOME/.claude/skills"
install_skills_to "codex" "$HOME/.codex/skills"

# Agents — same convention as skills (keep user edits unless --force).
if [[ -d claude/agents ]]; then
  mkdir -p "$HOME/.claude/agents"
  a_installed=0; a_skipped=0
  for src in claude/agents/*.md; do
    [[ -e $src ]] || continue
    name=$(basename "$src")
    dst="$HOME/.claude/agents/$name"
    if [[ -f $dst && $FORCE -eq 0 ]]; then
      a_skipped=$((a_skipped+1)); continue
    fi
    cp "$src" "$dst"
    if [[ ${#SED_ARGS[@]} -gt 0 ]]; then
      sed -i "${SED_ARGS[@]}" "$dst"
    fi
    a_installed=$((a_installed+1))
  done
  echo "agents: installed=$a_installed skipped=$a_skipped (use --force to overwrite)"
fi

# Render CLAUDE.md.template once if ~/.claude/CLAUDE.md doesn't already exist.
if [[ ! -f "$HOME/.claude/CLAUDE.md" ]]; then
  bash setup/render-templates.sh >/dev/null
  if [[ -f claude/CLAUDE.md ]]; then
    cp claude/CLAUDE.md "$HOME/.claude/CLAUDE.md"
    echo "wrote $HOME/.claude/CLAUDE.md from template"
  fi
else
  echo "$HOME/.claude/CLAUDE.md exists — leaving alone (edit by hand if needed)"
fi

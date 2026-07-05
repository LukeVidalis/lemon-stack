#!/usr/bin/env bash
# identifiers.lib.sh — shared loader for the personal identifiers used by the
# leak guard and templatizer. The real values live in scripts/identifiers.env
# (gitignored, per-host); scripts/identifiers.example.env documents the format.
#
# Sourcing this file sets:
#   IDENTIFIERS_LOADED=1|0   — whether identifiers.env was found and sourced
# and defines:
#   templatize_stream <f>    — personal-value → {{VAR}} substitution, to stdout
#   templatize_file <f>      — same, in place
#   leak_patterns            — print one grep -E leak pattern per line
#
# Override the env file location with LEMON_STACK_IDENTIFIERS (used by CI,
# which writes the file from a repo secret).

_IDENT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
IDENTIFIERS_ENV="${LEMON_STACK_IDENTIFIERS:-$_IDENT_DIR/identifiers.env}"

IDENTIFIERS_LOADED=0
if [[ -f "$IDENTIFIERS_ENV" ]]; then
  # shellcheck source=identifiers.example.env
  source "$IDENTIFIERS_ENV"
  IDENTIFIERS_LOADED=1
fi

_ident_require() {
  if [[ $IDENTIFIERS_LOADED -ne 1 ]]; then
    echo "identifiers.lib.sh: $IDENTIFIERS_ENV not found." >&2
    echo "Copy scripts/identifiers.example.env to scripts/identifiers.env and fill in your values." >&2
    return 1
  fi
}

# Escape a literal value for use inside a grep -E / sed -E regex.
_re() { printf '%s' "$1" | sed 's/[.[\*^$()+?{}|\\]/\\&/g'; }

# sed -E expressions, most-specific first (admin@domain before bare domain,
# full email before bare username). \b suffixes match the original guard
# semantics for USER_HOME and the Plane project prefix.
_ident_sed_args() {
  _ident_require || return 1
  printf -- '-e\ns|admin@%s|admin@{{DOMAIN}}|g\n' "$(_re "$IDENT_DOMAIN")"
  printf -- '-e\ns|%s|{{ADMIN_EMAIL}}|g\n' "$(_re "$IDENT_ADMIN_EMAIL")"
  printf -- '-e\ns|%s|{{DOMAIN}}|g\n' "$(_re "$IDENT_DOMAIN")"
  printf -- '-e\ns|%s|{{GITHUB_ORG}}|g\n' "$(_re "$IDENT_GITHUB_ORG")"
  printf -- '-e\ns|%s|{{GITHUB_USERNAME}}|g\n' "$(_re "$IDENT_GITHUB_USERNAME")"
  printf -- '-e\ns|%s|{{TELEGRAM_CHAT_ID}}|g\n' "$(_re "$IDENT_TELEGRAM_CHAT_ID")"
  printf -- '-e\ns|%s|{{SERVER_IP}}|g\n' "$(_re "$IDENT_SERVER_IP")"
  printf -- '-e\ns|%s\\b|{{USER_HOME}}|g\n' "$(_re "$IDENT_USER_HOME")"
  printf -- '-e\ns|%s|{{PLANE_PROJECT_ID}}|g\n' "$(_re "$IDENT_PLANE_PROJECT_ID")"
  printf -- '-e\ns|%s|{{PLANE_API_KEY_FILE_ID}}|g\n' "$(_re "$IDENT_PLANE_API_KEY_FILE_ID")"
  printf -- '-e\ns|\\b%s\\b|{{PLANE_PROJECT_PREFIX}}|g\n' "$(_re "$IDENT_PLANE_PROJECT_PREFIX")"
}

templatize_stream() {
  _ident_require || return 1
  local args
  mapfile -t args < <(_ident_sed_args)
  sed -E "${args[@]}" "$1"
}

templatize_file() {
  _ident_require || return 1
  local args
  mapfile -t args < <(_ident_sed_args)
  sed -E -i "${args[@]}" "$1"
}

# grep -E patterns that must never appear in the public tree.
leak_patterns() {
  _ident_require || return 1
  _re "$IDENT_DOMAIN"; echo
  _re "$IDENT_GITHUB_ORG"; echo
  _re "$IDENT_GITHUB_USERNAME"; echo
  _re "$IDENT_TELEGRAM_CHAT_ID"; echo
  _re "$IDENT_SERVER_IP"; echo
  printf '%s\\b\n' "$(_re "$IDENT_USER_HOME")"
  _re "$IDENT_PLANE_PROJECT_ID"; echo
  _re "$IDENT_PLANE_API_KEY_FILE_ID"; echo
  printf '\\b%s\\b\n' "$(_re "$IDENT_PLANE_PROJECT_PREFIX")"
  # Generic secret shapes — value-independent, so they catch keys that were
  # never declared as identifiers (an n8n API key slipped through this way once).
  echo 'n8n_api_[a-f0-9]{20,}'
  echo 'plane_api_[a-f0-9]{20,}'
  echo 'sk-ant-[A-Za-z0-9_-]{20,}'
  echo 'ghp_[A-Za-z0-9]{20,}'
  echo 'github_pat_[A-Za-z0-9_]{20,}'
  echo 'AKIA[0-9A-Z]{16}'
  echo 'hvs\.[A-Za-z0-9]{20,}'
  echo 'discord(app)?\.com/api/webhooks/[0-9]+/[A-Za-z0-9_-]{30,}'
  echo '[0-9]{8,10}:AA[A-Za-z0-9_-]{30,}'
  echo 'BEGIN( [A-Z]+)? PRIVATE KEY'
}

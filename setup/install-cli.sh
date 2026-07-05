#!/usr/bin/env bash
# install-cli.sh — link the lemon CLI onto PATH and export config env.

set -euo pipefail

cd "$(dirname "$0")/.."
PARAMS=setup/parameters.env
[[ -f $PARAMS ]] || { echo "missing $PARAMS"; exit 1; }
# shellcheck disable=SC1090
set -a; source <(grep -E '^[A-Z_][A-Z0-9_]*=' "$PARAMS"); set +a

BIN_DIR="$HOME/.local/bin"
mkdir -p "$BIN_DIR"
ln -sf "$(pwd)/cli/lemon/lemon" "$BIN_DIR/lemon"
echo "linked $BIN_DIR/lemon → $(pwd)/cli/lemon/lemon"

# Add to PATH in shell rc if needed
RC=""
if [[ -n "${BASH_VERSION:-}" || $SHELL == */bash ]]; then RC="$HOME/.bashrc"
elif [[ $SHELL == */zsh ]]; then RC="$HOME/.zshrc"
fi
if [[ -n $RC && -f $RC ]]; then
  if ! grep -q 'lemon-stack env' "$RC"; then
    {
      echo
      echo '# lemon-stack env (managed by setup.sh)'
      echo 'export PATH="$HOME/.local/bin:$PATH"'
      echo "export LEMON_DOMAIN=\"$DOMAIN\""
      echo "export LEMON_GITHUB_ORG=\"$GITHUB_ORG\""
      echo "export LEMON_HOSTNAME=\"$HOSTNAME\""
      echo "export LEMON_PLANE_HOST=\"plane.$DOMAIN\""
    } >> "$RC"
    echo "appended lemon-stack env to $RC — open a new shell or 'source $RC'"
  else
    echo "$RC already has lemon-stack env block — leaving alone"
  fi
fi

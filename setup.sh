#!/usr/bin/env bash
# setup.sh — top-level lemon-stack installer.
#
# Idempotent. Safe to re-run after editing parameters.env.
#
# Usage:
#   ./setup.sh                  full install (default)
#   ./setup.sh --render-only    just render templates from parameters.env
#   ./setup.sh --reconfigure    re-run interactive prompts
#   ./setup.sh --check          run post-install checks
#   ./setup.sh --bring-up       (re)bring up docker compose stacks
#
# Phase ordering: prompts → render → bring-up → install-deploy → install-cli
#                 → install-skills → post-install-checks.
# OpenBao init / unseal stays manual (security-sensitive) — see
# infra/openbao/README.md.

set -euo pipefail

cd "$(dirname "$0")"
cmd=${1:-}

step() { echo; echo "════════════════════════════════════════════════════════════════"; echo "  $*"; echo "════════════════════════════════════════════════════════════════"; }

case "$cmd" in
  --render-only)
    bash setup/render-templates.sh
    exit 0
    ;;
  --check)
    bash setup/post-install-checks.sh
    exit $?
    ;;
  --bring-up)
    bash setup/bring-up.sh
    exit $?
    ;;
  --reconfigure)
    bash setup/prompts.sh
    bash setup/render-templates.sh
    echo "Re-rendered. Run ./setup.sh --bring-up to apply container-side changes."
    exit 0
    ;;
  -h|--help)
    sed -n '2,15p' "$0"
    exit 0
    ;;
  "")
    ;;
  *)
    echo "unknown flag: $cmd. See ./setup.sh --help." >&2
    exit 2
    ;;
esac

step "1/6  Collect parameters"
if [[ ! -f setup/parameters.env ]]; then
  bash setup/prompts.sh
else
  echo "setup/parameters.env exists. Re-run with --reconfigure to re-prompt."
  echo "Or edit it directly: \$EDITOR setup/parameters.env"
fi

step "2/6  Render templates"
bash setup/render-templates.sh

step "3/6  Bring up docker compose stacks"
bash setup/bring-up.sh

step "4/6  Install deploy pipeline → ~/deploy/"
bash setup/install-deploy.sh

step "5/6  Install lemon CLI + Claude skills + agent memory"
bash setup/install-cli.sh
bash setup/install-bin.sh
# setup.sh doesn't source parameters.env (each installer does) — read COMPONENTS
# from the file to decide whether the backup component was ticked.
if grep -E '^COMPONENTS=' setup/parameters.env 2>/dev/null | grep -q 'backup'; then
  bash setup/install-backup.sh
fi
bash setup/install-skills.sh
bash setup/install-memory.sh

# Install git hooks so the leak guard runs on every commit in this repo.
if [[ -d .git/hooks && -f hooks/pre-commit ]]; then
  cp hooks/pre-commit .git/hooks/pre-commit
  chmod +x .git/hooks/pre-commit
  echo "git hooks: pre-commit (leak guard) installed"
fi

step "6/6  Post-install checks"
if bash setup/post-install-checks.sh; then
  echo
  echo "🎉 lemon-stack is up. Next steps:"
  echo "   1. Visit https://auth.\$DOMAIN and complete the Authentik admin setup."
  echo "   2. If you ticked openbao: bring it up + run infra/openbao/init.sh"
  echo "      (it prints the unseal keys exactly once — store them safely)."
  echo "   3. Register the GitHub Actions runner for auto-deploy:"
  echo "        cd ~/actions-runner && ./config.sh --url https://github.com/\$GITHUB_ORG --token <runner-token>"
  echo "      Token: GitHub → org settings → Actions → Runners → New self-hosted runner."
else
  echo
  echo "⚠️  Some checks failed — see output above. Rerun './setup.sh --check' after fixing."
  exit 1
fi

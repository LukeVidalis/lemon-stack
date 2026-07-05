#!/usr/bin/env bash
# bring-up.sh — docker compose up for core + selected optional components, in the
# right order. Idempotent: re-running just brings up anything that's down.

set -euo pipefail

cd "$(dirname "$0")/.."
PARAMS=setup/parameters.env
[[ -f $PARAMS ]] || { echo "missing $PARAMS"; exit 1; }
# shellcheck disable=SC1090
set -a; source <(grep -E '^[A-Z_][A-Z0-9_]*=' "$PARAMS"); set +a

# Ensure the shared network exists before any compose references it.
if ! docker network inspect lemon-internal >/dev/null 2>&1; then
  echo "creating lemon-internal network"
  docker network create lemon-internal
fi

# Render the templates first.
bash setup/render-templates.sh

bring_up() {
  local dir="$1"
  if [[ ! -f "$dir/docker-compose.yml" ]]; then
    echo "skip $dir (no docker-compose.yml after rendering)"
    return
  fi
  echo "── up: $dir ──"
  (cd "$dir" && docker compose up -d)
}

# Core: order matters.
bring_up infra/cloudflare
bring_up infra/postgres-shared

# Provision the authentik DB on postgres-shared (idempotent helper).
if [[ -x infra/postgres-shared/provision-db.sh ]]; then
  echo "── provisioning authentik DB ──"
  (cd infra/postgres-shared && ./provision-db.sh authentik) || true
fi

bring_up infra/authentik
bring_up infra/caddy

# Optional components (parse COMPONENTS from parameters.env).
IFS=',' read -r -a OPT <<<"${COMPONENTS:-}"
for c in "${OPT[@]}"; do
  [[ -z $c ]] && continue
  if [[ -d "infra/$c" ]]; then
    bring_up "infra/$c"
  else
    echo "WARN: COMPONENTS lists '$c' but infra/$c doesn't exist"
  fi
done

# Self-built apps: build from source (no external image dependency).
# Each app's docker-compose.yml uses build: directives, so compose handles it.
# We call `docker compose build` first so progress is visible before bring-up.

build_app() {
  local dir="$1"
  local name
  name=$(basename "$dir")

  if [[ ! -f "$dir/docker-compose.yml" ]]; then
    echo "skip app $name (no docker-compose.yml — run render-templates.sh first)"
    return
  fi

  # admin-ui's web stage needs a github-packages-token file for the
  # BuildKit secret. Stub it out if the user hasn't set one up so the
  # build doesn't abort on a missing-secret error.
  if [[ "$name" == "admin-ui" && ! -f "$HOME/.github-packages-token" ]]; then
    echo "note: ~/.github-packages-token not found; creating empty stub for build"
    echo "" > "$HOME/.github-packages-token"
    chmod 600 "$HOME/.github-packages-token"
  fi

  echo "── build: $name ──"
  (cd "$dir" && DOCKER_BUILDKIT=1 docker compose build)
  echo "── up: $name ──"
  (cd "$dir" && docker compose up -d)
}

echo
echo "Building and starting self-built apps (this may take a few minutes on first run)..."
for app in apps/tg-notify apps/notify apps/dashboard apps/admin-ui; do
  build_app "$app"
done

# Host-level optional services (not Docker containers).
if [[ " ${OPT[*]} " == *" claude-runner "* ]]; then
  if [[ -x apps/claude-runner/install.sh ]]; then
    echo
    echo "── installing claude-runner (host systemd service) ──"
    (cd apps/claude-runner && ./install.sh)
  else
    echo "WARN: COMPONENTS lists 'claude-runner' but apps/claude-runner/install.sh is missing"
  fi
fi

echo
echo "done. Next: bring up OpenBao manually if installed (see infra/openbao/README.md for"
echo "the init + unseal flow — setup.sh never auto-saves unseal keys)."

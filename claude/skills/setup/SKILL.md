---
name: setup
description: "Guide users through installing or re-configuring a lemon-stack host from this repo's setup.sh"
allowed-tools:
  - Bash
  - Read
---

# setup skill

Helps a user install lemon-stack from scratch, or re-run individual steps.

## When invoked

Triggered by phrases like "install lemon-stack", "set up the stack", "redo
authentik bootstrap", "where do I get the Cloudflare token", "I lost my
OpenBao unseal keys".

## Steps for a fresh install

1. Confirm prerequisites are present (`docker`, `docker compose`, `curl`,
   `openssl`, `jq`, `python3`, `gh`). If any are missing, instruct the user
   how to install them on their distro.
2. Clone the lemon-stack repo to `~/lemon-stack/` (or another location).
3. Walk the user through `./setup.sh`:
   - Step 1 collects parameters interactively (see `setup/parameters.example.env`).
   - Step 2 renders `*.template` files in place.
   - Step 3 brings up core compose stacks.
   - Step 4 installs `~/deploy/` pipeline.
   - Step 5 links `~/.local/bin/lemon` and copies skills to `~/.claude/skills/`.
   - Step 6 runs `setup/post-install-checks.sh`.
4. Post-install: walk through Authentik admin setup, OpenBao init (if selected),
   and registering the GitHub Actions runner.

## Steps for re-config

- Change a parameter: edit `setup/parameters.env`, then `./setup.sh --render-only`
  followed by `./setup.sh --bring-up`.
- Re-run prompts: `./setup.sh --reconfigure`.
- Health check anytime: `./setup.sh --check`.

## OpenBao unseal flow (security-sensitive — never automate)

The unseal keys are printed exactly **once** by `infra/openbao/init.sh`.
Never write them to any file in this repo or in `~/lemon-stack/`. Confirm
the user has them stored offline (password manager, encrypted note) before
proceeding. After every host reboot, the user must run
`infra/openbao/unseal.sh` and paste 3 of 5 keys.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `Caddy: tls handshake failed` for `auth.{{DOMAIN}}` | Cloudflare tunnel not connected | Check `docker logs cloudflared` |
| `authentik-server` exits with `password authentication failed` | Wrong `AUTHENTIK_DB_PASSWORD` for an existing DB | The bootstrap password only applies on first install — reset via `psql` if needed |
| `lemon: command not found` after install | `~/.local/bin` not on PATH | `source ~/.bashrc` or open a new shell |
| Post-install check fails on `loki not ready` | Slow start | Wait 30s, re-run `./setup.sh --check` |

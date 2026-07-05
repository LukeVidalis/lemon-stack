# Changelog

All notable changes to lemon-stack will be documented in this file.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and the project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added — 2026-07-05: backup & restore component
- `backup` optional component: restic-based daily backups with a generic
  engine (`infra/backup/backup.sh`) + pluggable dump hooks (`~/backup.d/`)
- Shipped hooks: postgres-shared (globals + every DB), n8n (SQLite),
  OpenBao (Raft snapshot)
- Guided `restore.sh`: staging-first file restore, scratch-DB restore for
  postgres-shared (`--in-place` behind typed confirmation), OpenBao staging
- `setup/install-backup.sh`: prompts for any restic backend (S3/R2, sftp,
  local), writes `~/.restic-env` (600), installs cron (daily 03:00 backup,
  monthly `restic check`)
- `verify-install.sh` checks: backup cron present, `.restic-env` mode 600
- Stub-based test suites for engine/hooks/restore, wired into CI
- `docs/backup-restore.md` with hook contract + disaster-recovery runbook;
  fixed the dead `architecture.md#backup--restore` anchor

## [Public baseline]

Everything below is shipped and drift-checked against the reference production
server. Git history starts at the public baseline commit; prior development
happened in a private mirror.

### Skills + agents
- 28 Claude Code skills covering deploy, SSO, networking, DNS, logging,
  secrets, Plane, n8n, notifications, and day-2 operations
- 4 agents: `server-maintainer` (daily health pass), `security-auditor`
  (weekly sweep), `intel-updater` (per-repo context files), `deploy-reviewer`
  (post-deploy verification)
- `claude/CLAUDE.md.template` starter context + per-host memory scaffold

### Infrastructure templates (`infra/`)
- Caddy, Cloudflare Tunnel, Authentik (incl. blueprints), postgres-shared
  (with `provision-db.sh`), OpenBao, Loki/Grafana/Promtail/Tempo monitoring,
  Pi-hole, n8n (with starter workflows), Obsidian, dashboard

### Deploy pipeline (`deploy/`)
- `deploy.sh` — push-to-deploy: port allocation, OpenBao/secrets.env loading,
  single-Dockerfile and multi-service compose paths, Caddy block generation,
  per-repo deploy serialization
- GitHub Actions reusable workflow + template repo

### Tooling
- `lemon` CLI (`cli/lemon/`) — composite JSON reads of stack state for LLM use
- `setup.sh` guided installer: parameter prompts, component selection,
  template rendering, bring-up, post-install checks, `verify-install.sh`
- Drift tooling: `drift-check.sh`, `pending-promotes.sh`, `promote.sh`
  (live-host → repo promotion with templating)
- Leak guard: `check-templates.sh` + `identifiers.lib.sh` — personal
  identifiers from a gitignored env file, plus value-independent generic
  secret-shape patterns (API-key prefixes, webhook URLs, private keys);
  enforced in CI and pre-commit

### App mirrors (`apps/`)
- tg-notify (Discord/Telegram notification hub), notify (Web Push), dashboard
  (per-user aggregator), admin-ui (Authentik management panel), claude-runner
  (agent runtime), memory-index (FTS5 cross-session memory)

### Docs
- Architecture, adding apps, Authentik bootstrap, OpenBao bootstrap,
  pipeline deep-dive, troubleshooting, upgrading

### Planned
- Independent clean-machine validation run of `setup.sh` (installer is beta)
- `backup.sh` Restic template
- Demo screencast

# Obsidian (web)

A self-hosted Obsidian instance using the [linuxserver/obsidian](https://docs.linuxserver.io/images/docker-obsidian/) image. Useful as a notes vault that lives next to the rest of your stack — and as a writable knowledge store the `server-maintainer` agent can update.

## Bring up

Add `obsidian` to `COMPONENTS` in `setup/parameters.env`, then either:

```bash
./setup.sh           # full bring-up
# or just this component:
./setup/render-templates.sh
(cd infra/obsidian && docker compose up -d)
```

Browse to <https://obsidian.{{DOMAIN}}> — protected behind your normal Caddy + Authentik chain.

## Caddy snippet

If you're using the bundled Caddy config, add a route:

```caddy
obsidian.{{DOMAIN}} {
  import authentik_chain
  reverse_proxy 127.0.0.1:3010
}
```

## Vault layout

The container exposes two volumes:

- `obsidian_config` → `/config` — Obsidian app config (themes, plugins, hotkeys)
- `obsidian_vaults` → `/vaults` — your actual vault(s)

Both are local Docker volumes by default. To bind to a host directory (e.g. for backups), swap the volume definition in `docker-compose.yml.template`.

## Reading/writing the vault from outside the container

Copy a file out:

```bash
docker cp obsidian:/vaults/<vault-name>/<file>.md ./<file>.md
```

Write a file in:

```bash
docker cp ./<file>.md obsidian:/vaults/<vault-name>/<file>.md
```

The `server-maintainer` agent uses this same pattern to append daily notes when configured (see `claude/CLAUDE.md` "Obsidian vault" section).

## Backups

The Obsidian volumes are picked up automatically by `scripts/backup.sh` if you've enabled the backup component. To verify:

```bash
docker run --rm -v obsidian_vaults:/v alpine ls /v
```

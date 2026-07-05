# deploy/ — auto-deploy pipeline

`deploy.sh` is invoked by the GitHub Actions self-hosted runner whenever you
push to a repo's `main` branch in the `{{GITHUB_ORG}}` org. It:

1. Pulls the latest code into `{{USER_HOME}}/docker/<repo>/repo/`
2. Auto-assigns a port (tracked in `deploy/ports.json`)
3. Renders the repo's `docker-compose.yml` with the port baked in
4. Inserts a Caddy block at `<repo>.{{DOMAIN}}` (between the managed-block markers)
5. Fetches per-app secrets from OpenBao into `secrets.env` (via `bao-fetch.sh`)
6. Brings the stack up with `docker compose up -d --build`
7. Reloads Caddy

## Files

- **`deploy.sh.template`** — main pipeline (rendered by setup.sh)
- **`bao-fetch.sh.template`** — pull AppRole-issued secrets from OpenBao
- **`ports.example.json`** — copy to `ports.json` after rendering; tracks port assignments

## What setup.sh does for you

When you run `./setup.sh`, the templating step renders `deploy.sh` and
`bao-fetch.sh` from these files into `~/deploy/` on the host, makes them
executable, and seeds `ports.json` with a starting offset (default `10010`).

The GitHub Actions runner workflow (`.github/workflows/deploy.yml` in each
app repo) ssh-execs `~/deploy/deploy.sh <repo-name>` over the runner's
working directory.

## Caddy managed-block contract

`deploy.sh` only edits lines between these two markers in your Caddyfile:

```
# ===== BEGIN deploy.sh managed blocks =====
# ===== END deploy.sh managed blocks =====
```

Anything outside these markers is left untouched. If you need a hand-tuned
route for an app, put it **outside** the markers and `deploy.sh` will skip
generating a block for that repo (it detects the existing block by host name).

## Modifying the pipeline

Edit `deploy.sh.template`, re-run `./setup.sh --render`, then move the rendered
file into place — `~/deploy/deploy.sh`. Or just edit the rendered file in
place if it's a one-off.

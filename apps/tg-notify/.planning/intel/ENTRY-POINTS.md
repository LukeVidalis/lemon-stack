---
updated_at: 2026-05-18T00:00:00Z
generated_by: intel-updater
---

# Entry Points

| Task | Start at | Notes |
|------|----------|-------|
| Add a new endpoint | `index.js` (any line after the middleware setup) | Register with `app.post/get(...)` inline; add `auth` param if it needs auth |
| Change auth mechanism | `index.js:22–27` (`auth` function) | Currently checks `Authorization: Bearer` header against `API_SECRET` |
| Add a new message level / emoji | `index.js:20` (`LEVEL_PREFIX` object) | Add key→emoji entry; falls back to `info` emoji for unknown levels |
| Change Telegram formatting | `index.js:43–58` (`POST /send` handler) | HTML parse mode — use `<b>`, `<i>`, `<code>` tags; escape `<` / `>` in content |
| Change the Telegram bot or chat target | `~/docker/tg-notify/secrets.env` on server | Update `TELEGRAM_BOT_TOKEN` and/or `TELEGRAM_CHAT_ID`; redeploy not needed — restart container |
| Rotate the API secret | `~/docker/tg-notify/secrets.env` on server | Change `API_SECRET`; notify all callers; restart container |
| Add/change a required env var | `index.js:6–18` (destructure + REQUIRED array) | Add to destructure and to `REQUIRED` if mandatory; startup crash on missing |
| Change the port | `PORT` env var (defaults `8080`) | Host port `10020` is fixed in `~/deploy/ports.json`; internal port can vary |
| Update the Docker base image | `Dockerfile:1` | Currently `node:22-alpine`; keep Alpine for image size |
| Trigger a redeploy without code changes | `git commit --allow-empty -m "redeploy" && git push` | See CLAUDE.md Deployment rule |
| View live logs | `docker logs tg-notify --tail 50` | Or filter in Grafana by `container_name="tg-notify"` |
| Call from shell script | See `CLAUDE.md` "Calling from shell scripts" | Uses `https://tg-notify.{{DOMAIN}}/send` with bearer token |
| Call from Docker container / n8n | `http://tg-notify:8080/send` | Must be on `lemon-internal` network; see [GOTCHAS.md](GOTCHAS.md) |

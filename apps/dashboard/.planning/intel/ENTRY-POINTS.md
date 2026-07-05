---
updated_at: 2026-05-18T00:00:00Z
generated_by: intel-updater
---

# Entry Points

| Task | Start at | Notes |
|------|----------|-------|
| Add a data card (new source app) | `api/data-sources.json` | Add entry with slug/host/port/path/icon/deepLink; use `"host": "127.0.0.1"` (not `host.docker.internal`); push to redeploy. Source app must expose `GET /api/_internal/user-summary?uid=<uid>` with `X-Internal-Secret` guard |
| Remove or disable a data card | `api/data-sources.json` | Set `"enabled": false` or delete the entry; push to redeploy |
| Add a static service to the grid | `api/services-config.json` → `static` array | Add `{ name, url, icon, category }`; push to redeploy |
| Hide a pipeline service from the grid | `api/services-config.json` → `overrides` map | Add `"slug": { "hidden": true }`; push to redeploy |
| Change a pipeline service's URL or name | `api/services-config.json` → `overrides` map | Add `"slug": { "name": "...", "url": "..." }` |
| Add a new API endpoint | `api/Features/<Feature>/<Feature>Endpoints.cs` (new file) + `api/Program.cs` (call `app.Map<Feature>()`) | Follow existing MapAggregate / MapServices pattern |
| Change aggregation logic or timeout | `api/Features/Aggregate/AggregateEndpoints.cs` | `PerSourceTimeoutMs = 1500` is a const at line 11; `FetchOne` handles per-source HTTP |
| Change auth behaviour | `api/Common/Auth/AuthentikAuthHandler.cs` | Reads `X-Authentik-*` headers; returns `NoResult` (not `Fail`) when absent |
| Change card UI (status rendering, layout) | `web/src/components/SourceCard.tsx` | Handles `ok`/`empty`/`timeout`/`error` statuses |
| Change services grid UI | `web/src/components/ServiceGrid.tsx` | Categories come from `ServiceEntry.category` field |
| Add a frontend API call | `web/src/api.ts` | Add fetch function + export interface; import in `App.tsx` |
| Change polling interval | `web/src/App.tsx:29` | `setInterval(load, 60_000)` |
| Change Caddy routing | `Caddyfile.fragment` | `{{API_PORT}}` / `{{WEB_PORT}}` are pipeline-substituted placeholders |
| Rotate `INTERNAL_SUMMARY_SECRET` | `~/docker/dashboard/secrets.env` on server | Must also update every source app's secrets.env then redeploy all; see [GOTCHAS.md](GOTCHAS.md) |
| Change CI / deploy pipeline | `.github/workflows/deploy.yml` | Delegates to `{{GITHUB_ORG}}/.github` shared workflow; rarely needs editing |
| Debug a failing source card | `curl -H "X-Internal-Secret: $SECRET" http://127.0.0.1:<port>/api/_internal/user-summary?uid=<uid>` | Run on the server; see CLAUDE.md § Operational notes |

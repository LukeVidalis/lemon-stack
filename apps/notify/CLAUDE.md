# Notify

**URL:** https://notify.{{DOMAIN}}
**Stack:** .NET 10 / ASP.NET Core minimal APIs (NotifyService.csproj, Directory.Build.props)
**Auth:** Two modes: Authentik forward auth (X-Authentik-Uid → NameIdentifier claim) for user-facing routes
**Deploy:** push to `main` → auto-deploys via GitHub Actions

## Services

| Service | Host port | Container port |
|---------|-----------|----------------|
| api | 10016 | 8080 |
## Secrets (`~/docker/notify/secrets.env`)

- `DB_NAME`
- `DB_PASSWORD`
- `DB_USER`
- `INTERNAL_SUMMARY_SECRET`
- `VAPID_PRIVATE_KEY`
- `VAPID_PUBLIC_KEY`
_(inferred from docker-compose.yml — create `~/docker/notify/secrets.env` with these keys)_
## Quick links

- Intel files: [`.planning/intel/`](.planning/intel/) — architecture, conventions, deploy, gotchas, entry-points
- Subdomain routes: `notify.{{DOMAIN}}` → `127.0.0.1:10016` via No Authentik SSO — see deploy.conf


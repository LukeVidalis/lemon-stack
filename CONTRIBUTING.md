# Contributing

Thanks for your interest! lemon-stack is the scrubbed, upstream-shaped mirror
of a real single-host install, so contributions work a little differently
than in a typical project.

## Ground rules

- **Templates, not values.** Anything host-specific (domain, org name, IPs,
  IDs, paths) must be a `{{VAR}}` placeholder, documented in
  `setup/parameters.example.env`. CI runs a leak guard
  (`scripts/check-templates.sh`) and template coverage check on every push.
- **`*.template` files render on the target host** via
  `setup/render-templates.sh`. Don't commit rendered output — the
  `.gitignore` already excludes the known render targets.
- **Shell quality:** scripts must pass `bash -n` and
  `shellcheck --severity=error` (CI enforces both; files containing `{{`
  placeholders are exempt since they aren't valid bash until rendered).

## Workflow

1. Fork, branch, make your change.
2. Run the checks locally:
   ```bash
   bash scripts/check-templates.sh        # needs scripts/identifiers.env; skips without it
   bash scripts/verify-template-coverage.sh
   bash scripts/check-structural-sections.sh
   ```
3. Open a PR against `main` with a short description of what the change does
   on a real install.

## Adding a new component

Follow the existing convention: an `infra/<name>/` directory with
`docker-compose.yml.template`, an optional `Caddyfile.fragment.template`, a
component entry in `setup/component-selector.sh`, and any new `{{VARS}}`
documented in `setup/parameters.example.env`. See `docs/adding-apps.md`.

## Reporting issues

Bug reports about the setup flow, drift between docs and behavior, or
portability problems (different distro, different DNS setup) are all useful.
Security issues: see [SECURITY.md](SECURITY.md).

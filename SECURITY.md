# Security Policy

## Reporting a vulnerability

If you find a security issue in lemon-stack — a secret that leaked past the
templating guard, a flaw in the deploy pipeline, an SSO bypass in the bundled
configs — please report it privately rather than opening a public issue:

- Use GitHub's **private vulnerability reporting** on this repository
  (Security tab → "Report a vulnerability"), or
- Email the maintainer via the address on their GitHub profile.

You should get an acknowledgement within a few days. Please include enough
detail to reproduce the issue (file, commit, config combination).

## Scope notes

- lemon-stack ships *templates*; secrets are supplied per-host via
  `setup/parameters.env` and OpenBao at install time. If you find a real
  credential in the tree or its history, that is always a valid report.
- The stack assumes a single-admin homelab trust model: services bind to
  `127.0.0.1`, public ingress goes through Cloudflare Tunnel + Authentik
  forward auth. Reports about hardening gaps within that model are welcome;
  "this isn't multi-tenant safe" is by design.

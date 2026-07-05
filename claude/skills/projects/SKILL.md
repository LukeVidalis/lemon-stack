---
name: projects
description: "Use when the user asks what's deployed/running on lemon-server, wants a project inventory with ports and URLs, or asks which repos never deployed successfully"
allowed-tools:
  - Bash
  - Read
  - Grep
  - Glob
---

<objective>
Show a complete picture of what's deployed on lemon-server. Combines the port registry,
running containers, and GitHub org repos into a single status view.

Works from the server directly (reads local state) OR from a dev machine (uses gh API + SSH).
</objective>

<process>
1. **Determine context** — are we on lemon-server or a remote dev machine?
   ```bash
   # On lemon-server: ~/deploy/ports.json exists
   if [[ -f ~/deploy/ports.json ]]; then
     echo "ON_SERVER"
   else
     echo "REMOTE"
   fi
   ```

2. **If on server** — gather local state:
   ```bash
   # Port assignments
   cat ~/deploy/ports.json

   # Running containers (deployed projects)
   docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}" | grep -v "NAMES"

   # Org repos (what COULD be deployed)
   gh repo list {{GITHUB_ORG}} --json name,pushedAt,url --limit 50
   ```

3. **If on a remote machine** — use GitHub API only:
   ```bash
   # List org repos
   gh repo list {{GITHUB_ORG}} --json name,pushedAt,url --limit 50

   # Check latest workflow runs for each
   for repo in $(gh repo list {{GITHUB_ORG}} --json name --jq '.[].name'); do
     echo "--- $repo ---"
     gh run list --repo {{GITHUB_ORG}}/$repo --limit 1 --json status,conclusion,createdAt 2>/dev/null
   done
   ```

4. **Format output** as a clean table:

   ```
   Project          Status      Port(s)                URL                                  Last Deploy
   ────────────────────────────────────────────────────────────────────────────────────────────────────
   hello-world      running     10001                  https://hello-world.{{DOMAIN}}    2 hours ago
   food-planner     running     10000                  https://food-planner.{{DOMAIN}}   3 days ago
   friendly         running     api:10002 / web:10003  https://friendly.{{DOMAIN}}       1 hour ago
   obsidian         running     3010                   https://obsidian.{{DOMAIN}}       5 days ago
   ```

   Include:
   - Project name
   - Container status (running/stopped/not deployed)
   - Assigned port
   - Live URL
   - Last deploy time (from git push or container start time)

5. **Flag issues** if any:
   - Container assigned a port but not running
   - Repo in org but no port assigned (never deployed successfully)
   - Failed workflow runs

## Notes
- This skill is read-only — it never modifies state
- On remote machines without SSH access to the server, it can only show GitHub-side info (repos, workflow status)
- The source of truth for "what's actually running" is always `docker ps` on the server
- Multi-service projects show as dict in ports.json (e.g. `{"api": 10002, "web": 10003}`). Display as `api:10002 / web:10003` in the Port(s) column. Check containers via `docker ps --filter label=com.docker.compose.project=<repo>`.
</process>

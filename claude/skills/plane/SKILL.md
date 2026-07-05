---
name: plane
description: "Use when creating, updating, commenting on, or closing Plane issues (the {{PLANE_PROJECT_PREFIX}} audit trail), or when the user asks what was done today / what's next / for a session recap"
allowed-tools:
  - Bash
---

<objective>
Interact with Plane project management via `plane-cli`. All API complexity lives in `~/bin/plane-cli`.
</objective>

## Commands

```bash
# High-level workflow
plane-cli start "Task title"                              # find/create → In Progress + claude label
plane-cli done 42                                         # move to Done by seq number
plane-cli done "partial title"                            # or by fuzzy title match
plane-cli today                                           # done today + in-progress
plane-cli recap                                           # full board summary
plane-cli close-with-comment 42 <pr_url> "bullet1" ...   # post PR link + move Done

# Low-level
plane-cli list [backlog|todo|inprog|done]                 # filtered list
plane-cli search "query"                                  # find by title
plane-cli get 42                                          # issue details + UUID
plane-cli create "Title" [state]                          # create in todo/backlog
plane-cli state 42 done|inprog|todo|backlog|cancel        # change state
plane-cli comment 42 "text"                               # plain-text comment
plane-cli labels                                          # list label IDs

# CASH project
plane-cli --project cash recap
```

## Projects

| Project | Identifier | `--project` flag |
|---|---|---|
| lemon-server (default) | `{{PLANE_PROJECT_PREFIX}}` | `lemonserve` |
| Cashflow | `CASH` | `cash` |

## Known label IDs

| Label | ID |
|---|---|
| Auth | `9cb546c9-e773-44ca-bdbf-96d69d52e7ea` |
| Project Idea | `fbe5b73b-4fd1-4fc0-b4bf-670bd726a28f` |
| Server Management | `bee172ca-0068-4883-95f5-980ca8779c5a` |

The **claude** label (purple `#9B59B6`) is created automatically by `plane-cli start` if it doesn't exist.

## Modes

| User says | Action |
|---|---|
| "I'm working on X" / "start X" | `plane-cli start "X"` |
| "done" / "finished X" | `plane-cli done <seq or title>` |
| "what did I do today" / "end of day" | `plane-cli today` |
| "what's next" / "catch me up" | `plane-cli recap` |
| Agent finished, post PR | `plane-cli close-with-comment <seq> <pr_url> <bullets>` |
| "add X to backlog" | `plane-cli create "X" backlog` |

## Gotchas

- **Cloudflare UA block**: `plane-cli` already sends `User-Agent: curl/8.5.0` on all requests. Never use `python urllib` or `node` directly — they get `403 error code: 1010` on POST/PATCH.
- **`?state=` filter is ignored**: the API returns all issues regardless. `plane-cli` always fetches all and filters in Python.
- **Cycles/Modules must be enabled per project** in Plane UI before the API accepts them.

## Automation context (for debugging webhooks)

Agent users: Claude Code `fd9e35ab-b5ae-4e46-acee-077fedb5a728`, Copilot `37d36bf1-dcf6-44b2-ab8c-c1d3c64df067` (both role=15 Member). Assigning either + moving to In Progress triggers `claude-runner.service` (`~/claude-runner/`, ports 9876–9879). Webhook payload: `action: "updated"`, `activity.field: "state_id"`, assignees always `[]` on state change — fetch via `GET /projects/{proj}/issues/{id}/`.

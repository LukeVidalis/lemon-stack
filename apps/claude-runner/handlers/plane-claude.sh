#!/bin/bash
# Plane → Claude Code handler
# Called by runner.py with issue data as env vars:
#   ISSUE_ID, ISSUE_TITLE, ISSUE_DESCRIPTION, ISSUE_SEQUENCE_ID

set -euo pipefail

API_KEY="${PLANE_API_KEY:?PLANE_API_KEY required}"
PLANE_BASE="https://plane.{{DOMAIN}}/api/v1"
WORKSPACE="{{PLANE_WORKSPACE}}"
PROJECT_ID="{{PLANE_PROJECT_ID}}"
DONE_STATE="${PLANE_DONE_STATE_ID:?PLANE_DONE_STATE_ID required}"
CLAUDE="${CLAUDE_BIN:-{{USER_HOME}}/.local/bin/claude}"
LOG_DIR="{{USER_HOME}}/claude-runner/logs/plane-claude"
mkdir -p "$LOG_DIR"

LOG_FILE="$LOG_DIR/issue-${ISSUE_ID}.log"
exec > >(tee -a "$LOG_FILE") 2>&1
echo "[$(date -u)] Starting handler for {{PLANE_PROJECT_PREFIX}}-${ISSUE_SEQUENCE_ID}: ${ISSUE_TITLE}"

# Determine working directory from description
# Convention: a line starting with "repo: <name>" sets the repo
REPO=$(echo "${ISSUE_DESCRIPTION:-}" | grep -i "^repo:" | head -1 | sed 's/[Rr][Ee][Pp][Oo]://;s/[[:space:]]//g' || true)
WORK_DIR="{{USER_HOME}}"
if [ -n "$REPO" ]; then
    if [ -d "{{USER_HOME}}/$REPO" ]; then
        WORK_DIR="{{USER_HOME}}/$REPO"
    elif [ -d "{{USER_HOME}}/docker/$REPO" ]; then
        WORK_DIR="{{USER_HOME}}/docker/$REPO"
    fi
fi
echo "[$(date -u)] Working directory: $WORK_DIR"

# Trajectory logging (JSONL audit trail) — see {{USER_HOME}}/claude-runner/lib/.
export CLAUDE_HANDLER="${CLAUDE_HANDLER:-plane-claude}"
export CLAUDE_LABEL="${CLAUDE_LABEL:-{{PLANE_PROJECT_PREFIX}}-${ISSUE_SEQUENCE_ID:-${ISSUE_ID}}}"
export CLAUDE_WORK_DIR="$WORK_DIR"
source {{USER_HOME}}/claude-runner/lib/trajectory-init.sh
source {{USER_HOME}}/claude-runner/lib/trajectory-summary.sh
echo "[$(date -u)] Trajectory: $TRAJECTORY_FILE"

# Verify this issue is actually assigned to Claude before doing anything
CLAUDE_USER_ID="${PLANE_CLAUDE_USER_ID:?PLANE_CLAUDE_USER_ID required}"
ASSIGNEES=$(curl -s -H "X-Api-Key: $API_KEY" \
    "$PLANE_BASE/workspaces/$WORKSPACE/projects/$PROJECT_ID/issues/$ISSUE_ID/" | \
    python3 -c "import sys,json; d=json.load(sys.stdin); print(' '.join(d.get('assignees',[])))" 2>/dev/null || true)
if ! echo "$ASSIGNEES" | grep -q "$CLAUDE_USER_ID"; then
    echo "[$(date -u)] Issue not assigned to Claude ($CLAUDE_USER_ID), skipping."
    exit 0
fi

# Helper: add/remove 👀 reaction to signal the bot is looking at the ticket
plane_reaction_add() {
    docker exec plane-api-1 bash -c "cd /code && DJANGO_SETTINGS_MODULE=plane.settings.production python3 manage.py shell -c \"
from plane.db.models import IssueReaction, User, Project, Workspace
u = User.objects.get(email='claude@{{DOMAIN}}')
proj = Project.objects.get(id='{{PLANE_PROJECT_ID}}')
ws = Workspace.objects.get(slug='{{PLANE_WORKSPACE}}')
IssueReaction.objects.get_or_create(issue_id='${ISSUE_ID}', actor=u, reaction='128064', defaults={'project': proj, 'workspace': ws})
\"" 2>/dev/null || true
}

plane_reaction_remove() {
    docker exec plane-api-1 bash -c "cd /code && DJANGO_SETTINGS_MODULE=plane.settings.production python3 manage.py shell -c \"
from plane.db.models import IssueReaction, User
u = User.objects.get(email='claude@{{DOMAIN}}')
IssueReaction.objects.filter(issue_id='${ISSUE_ID}', actor=u, reaction='128064').delete()
\"" 2>/dev/null || true
}

echo "[$(date -u)] Adding 👀 reaction..."
plane_reaction_add

# Build the prompt
PROMPT="You are Claude Code running as an autonomous agent on a home server (Ubuntu 24.04).
You have been assigned a task from the Plane project management system.

Issue: {{PLANE_PROJECT_PREFIX}}-${ISSUE_SEQUENCE_ID}
Title: ${ISSUE_TITLE}
Description:
${ISSUE_DESCRIPTION:-No description provided.}

Working directory: ${WORK_DIR}

Complete this task. The server runs Docker containers for various services.
Relevant paths: ~/docker/ (all compose files), /etc/caddy/Caddyfile (reverse proxy), ~/deploy/ (CI pipeline).
Use 'sudo' for system-level operations. Commit any code changes with git.

When done, end your response with a brief summary of what you did."

# Run Claude Code
echo "[$(date -u)] Running claude..."
cd "$WORK_DIR"

CLAUDE_OUTPUT=$("$CLAUDE" \
    --model claude-sonnet-4-6 \
    --effort medium \
    --dangerously-skip-permissions \
    --no-session-persistence \
    -p "$PROMPT" \
    --allowedTools "Read,Edit,Write,Bash,Glob,Grep,WebSearch" \
    2>&1) && EXIT_CODE=0 || EXIT_CODE=$?

echo "[$(date -u)] Claude exited with code: $EXIT_CODE"

# Trajectory: synthesize a session_summary if the inner agent didn't emit one.
if [ $EXIT_CODE -eq 0 ]; then
    _traj_emit_summary "done" "{{PLANE_PROJECT_PREFIX}}-${ISSUE_SEQUENCE_ID} completed" "{{PLANE_PROJECT_PREFIX}}-${ISSUE_SEQUENCE_ID}"
else
    _traj_emit_summary "error" "{{PLANE_PROJECT_PREFIX}}-${ISSUE_SEQUENCE_ID} failed exit=${EXIT_CODE}" "{{PLANE_PROJECT_PREFIX}}-${ISSUE_SEQUENCE_ID}"
fi

# Truncate output for comment (max ~2000 chars)
SUMMARY=$(echo "$CLAUDE_OUTPUT" | tail -c 2000)

# Post comment
if [ $EXIT_CODE -eq 0 ]; then
    COMMENT_BODY="<p>✅ <strong>Claude Code completed {{PLANE_PROJECT_PREFIX}}-${ISSUE_SEQUENCE_ID}</strong></p><p><strong>Summary:</strong></p><p>$(echo "$SUMMARY" | sed 's/&/\&amp;/g;s/</\&lt;/g;s/>/\&gt;/g' | sed 's/$/\\n/' | tr -d '\n' | sed 's/\\n/<br>/g')</p><p><em>Log: ${LOG_FILE}</em></p>"

    curl -s -X POST \
        -H "X-Api-Key: $API_KEY" \
        -H "Content-Type: application/json" \
        "$PLANE_BASE/workspaces/$WORKSPACE/projects/$PROJECT_ID/issues/$ISSUE_ID/comments/" \
        -d "{\"comment_html\": $(echo "$COMMENT_BODY" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))')}"

    curl -s -X PATCH \
        -H "X-Api-Key: $API_KEY" \
        -H "Content-Type: application/json" \
        "$PLANE_BASE/workspaces/$WORKSPACE/projects/$PROJECT_ID/issues/$ISSUE_ID/" \
        -d "{\"state\": \"$DONE_STATE\"}"

    plane_reaction_remove
    echo "[$(date -u)] Moved to Done and posted comment."
else
    ERROR_COMMENT="<p>❌ <strong>Claude Code failed on {{PLANE_PROJECT_PREFIX}}-${ISSUE_SEQUENCE_ID}</strong></p><p>Exit code: ${EXIT_CODE}</p><p>Check log: <code>${LOG_FILE}</code></p><p><pre>$(echo "$CLAUDE_OUTPUT" | tail -c 500 | sed 's/&/\&amp;/g;s/</\&lt;/g;s/>/\&gt;/g')</pre></p>"

    CANCELLED_STATE="${PLANE_CANCELLED_STATE_ID:?PLANE_CANCELLED_STATE_ID required}"

    curl -s -X POST \
        -H "X-Api-Key: $API_KEY" \
        -H "Content-Type: application/json" \
        "$PLANE_BASE/workspaces/$WORKSPACE/projects/$PROJECT_ID/issues/$ISSUE_ID/comments/" \
        -d "{\"comment_html\": $(echo "$ERROR_COMMENT" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))')}"

    curl -s -X PATCH \
        -H "X-Api-Key: $API_KEY" \
        -H "Content-Type: application/json" \
        "$PLANE_BASE/workspaces/$WORKSPACE/projects/$PROJECT_ID/issues/$ISSUE_ID/" \
        -d "{\"state\": \"$CANCELLED_STATE\"}"

    plane_reaction_remove
    echo "[$(date -u)] Failed — moved to Cancelled and posted error comment."
fi

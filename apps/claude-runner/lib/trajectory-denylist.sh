#!/usr/bin/env bash
# Emits secret VALUES (one per line) that the trajectory hook should redact
# from tool inputs/outputs. Safe to run multiple times — output is consumed,
# never logged. Silent on errors.
set -u

emit() {
    # filter very short values to avoid over-redaction
    awk 'length($0) >= 8 { print }'
}

{
    # secrets.env style files under ~/docker
    for f in {{USER_HOME}}/docker/*/secrets.env {{USER_HOME}}/docker/*/.env; do
        [ -f "$f" ] || continue
        # Extract values for keys that look secret-shaped
        grep -E '^[A-Z_]*(SECRET|TOKEN|KEY|PASSWORD|PW|API)[A-Z_]*=' "$f" 2>/dev/null \
            | sed -E 's/^[^=]+=//' \
            | sed -E 's/^"(.*)"$/\1/' \
            | sed -E "s/^'(.*)'\$/\1/"
    done

    # restic env
    if [ -f {{USER_HOME}}/.restic-env ]; then
        grep -E '^[A-Z_]+_(PASSWORD|KEY|SECRET|TOKEN)=' {{USER_HOME}}/.restic-env 2>/dev/null \
            | sed -E 's/^[^=]+=//' \
            | sed -E 's/^"(.*)"$/\1/'
    fi

    # OpenBao token
    [ -f {{USER_HOME}}/.bao-token ] && cat {{USER_HOME}}/.bao-token 2>/dev/null

    # Plane API key (used by plane-claude/plane-copilot handlers)
    if [ -f {{USER_HOME}}/secret-key-{{PLANE_API_KEY_FILE_ID}}.csv ]; then
        awk -F',' 'NR==2{print $4}' {{USER_HOME}}/secret-key-{{PLANE_API_KEY_FILE_ID}}.csv 2>/dev/null
    fi
} | emit | sort -u

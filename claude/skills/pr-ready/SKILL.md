---
name: pr-ready
description: >-
  Use when the user says "get this PR ready", "fix the CI on branch X",
  "prepare branch X for merge", or asks to deal with failing checks, merge
  conflicts, or unaddressed review comments (including CodeRabbit threads)
  on a PR or branch.
allowed-tools:
  - Bash
  - Read
  - Write
  - Edit
  - Grep
  - Glob
  - WebFetch
---

<objective>
Take a PR number or branch name and leave it in a mergeable state:
- All CI checks passing (or a clear explanation why a remaining failure is
  acceptable and outside scope)
- All review comments addressed — fixed, or replied to with a reasoned
  rebuttal
- Up-to-date with main (no merge conflicts)
- Local build and tests pass before any push
</objective>

---

## Step 0 — Resolve the target

If given a **PR number**:
```bash
gh pr view <N> --json headRefName,baseRefName,url,state
# Extract headRefName as BRANCH, baseRefName as BASE (usually main)
```

If given a **branch name**, set BRANCH = that name, BASE = main.

Check out the branch locally (fetch first so CI state is visible):
```bash
git fetch origin
git checkout <BRANCH>  # or: git checkout -b <BRANCH> origin/<BRANCH>
```

---

## Step 1 — Assess the full picture

Run all three reads **in parallel** so you have the complete picture before
acting:

```bash
# 1a. CI/CD check status
gh pr checks <N>           # if PR exists
# or:
gh run list --branch <BRANCH> --limit 10

# 1b. Review comments
gh pr view <N> --json reviews,comments,reviewRequests

# 1c. Merge conflict check
git merge-tree $(git merge-base HEAD origin/<BASE>) HEAD origin/<BASE>
# A non-empty diff with conflict markers means conflicts exist
```

Also run the local build immediately so you know the baseline:
```bash
# Detect stack and run appropriate build command
# .NET:
dotnet build
# Node:
npm run build
# Both — run tests too:
dotnet test / npm test
```

Categorise everything you find into:
- **CI failures** — broken checks/workflows
- **Security alerts** — Dependabot / CodeQL / secret scanning hits
- **Review comments** — outstanding, unresolved
- **Merge conflicts** — files with conflict markers

---

## Step 2 — Fix merge conflicts first

Merge conflicts must be resolved before code changes make sense.

```bash
git merge origin/<BASE>
# If conflicts:
# - Read each conflicted file
# - Resolve by keeping the correct combination of both sides
# - Never blindly pick one side; understand what both changes do
git add <resolved-files>
git commit -m "merge: sync with <BASE>"
```

After resolving, re-run the local build to make sure the merge didn't break
anything before continuing.

---

## Step 3 — Fix CI/CD failures

For each failing check:

1. **Read the failure log:**
   ```bash
   gh run view <run-id> --log-failed
   # or for a specific job:
   gh run view <run-id> --job <job-id> --log
   ```

2. **Diagnose the root cause** — compile error, test failure, lint error,
   missing secret, infrastructure config — and fix it in code.

3. **Common patterns:**
   - **Build errors** — read the error, find the file, fix the code.
   - **Test failures** — read the test output, fix the logic or the test.
   - **Lint / formatting** — run the formatter locally (`dotnet format`,
     `eslint --fix`, `prettier --write`) and commit the result.
   - **Missing env vars / secrets** — note them; do NOT add secrets to
     code. Tell the user what needs to be configured in GitHub Secrets or
     the deployment environment.
   - **Dependency vulnerabilities** — see Step 4.
   - **Workflow syntax errors** — fix the YAML directly.

4. After each fix, verify locally:
   ```bash
   dotnet build && dotnet test
   # or npm run build && npm test
   ```

5. Commit fixes atomically (one commit per logical fix):
   ```bash
   git commit -m "fix: <short description of what was broken>"
   ```

---

## Step 4 — Address security alerts

```bash
gh api repos/<owner>/<repo>/vulnerability-alerts  # check if enabled
gh api repos/<owner>/<repo>/dependabot/alerts --paginate
```

For each open alert:
- **Dependabot / dependency upgrade** — update the package to the patched
  version:
  ```bash
  # .NET:
  dotnet add package <PackageName> --version <safe-version>
  # npm:
  npm install <package>@<safe-version>
  ```
  Then rebuild and run tests to confirm nothing breaks.
- **CodeQL finding** — read the finding, locate the vulnerable code, apply
  the fix (input validation, parameterised query, etc.).
- **Secret scanning hit** — **STOP. Do not push.** Alert the user
  immediately. The secret must be rotated before the branch can be merged.

Commit security fixes separately with a clear message:
```bash
git commit -m "security: update <package> to address CVE-XXXX-XXXXX"
```

---

## Step 5 — Address review comments

```bash
gh pr view <N> --json reviews,comments
```

For each unresolved comment thread:

### Decide: fix or rebuttal?

**Fix it** when:
- The reviewer identified a real bug, performance issue, or security hole.
- The suggestion follows the project's conventions and doesn't break
  anything.
- The change is small and unambiguous.

**Rebuttal** when:
- The suggestion is a style preference with no objective upside.
- Applying it would break something, or conflicts with a deliberate design
  decision.
- The reviewer misread the code (explain why).
- The change is out of scope for this PR.

### How to rebuttal

Post a reply on the PR comment thread that:
1. Thanks the reviewer (briefly).
2. States clearly that you're not applying the change.
3. Gives the specific technical reason.
4. Keeps it factual — no defensiveness.

```bash
gh pr comment <N> --body "$(cat <<'EOF'
Re: [quote the comment or describe it briefly]

Not applying this change because [specific reason]. [One sentence of
elaboration if needed.] Happy to revisit in a follow-up if you feel
strongly.
EOF
)"
```

When replying to a specific inline comment thread, use:
```bash
gh api repos/<owner>/<repo>/pulls/<N>/comments/<comment-id>/replies \
  -X POST -f body="..."
```

### How to fix

Apply the fix to the code, then resolve the thread:
```bash
# After code change:
git commit -m "fix: address review comment — <short description>"

# Mark the conversation as resolved (if you have write access):
gh api repos/<owner>/<repo>/pulls/<N>/comments/<comment-id>/reactions \
  -X POST -f content="eyes"  # optional acknowledgment
```

---

## CodeRabbit comments — required extra step

CodeRabbit posts inline review comments as a bot. After deciding fix vs.
rebuttal for each CodeRabbit thread, you **must** close the loop on GitHub
so the conversation doesn't stay open:

### Fetch CodeRabbit comment IDs

```bash
# Get all review comments (inline) including CodeRabbit's.
# Read FULL bodies, not truncated — the severity line, the "Source: Coding
# guidelines" footer, and the suggested diff all change how you handle it.
gh api repos/<owner>/<repo>/pulls/<N>/comments \
  --paginate --jq '.[] | "=== ID \(.id) | \(.path):\(.line) ===\n\(.body)\n"'
```

### How to read a CodeRabbit comment

- **Severity + effort labels** (`🟠 Major / 🏗️ Heavy lift`, `🟡 Minor / ⚡ Quick
  win`) are decent priority signals but unreliable effort estimates. A "Heavy
  lift" test-coverage ask is often quick once you find the project's existing
  fixtures/helpers (e.g. an `AppFixture` with auth-client factories). Judge
  effort from the codebase, not the label.
- **`Source: Coding guidelines` footer** means CodeRabbit is enforcing the
  repo's own rules (AGENTS.md / `.coderabbit.yaml` path_instructions), not
  offering an opinion. These are rarely rebuttal-able on taste grounds — the
  only valid rebuttals are "the coverage already exists elsewhere" (grep other
  test files before writing new ones) or "the guideline doesn't apply here."
- **It enforces rules incompletely.** When a comment flags one file, check
  whether the underlying project rule implies sibling changes it didn't flag —
  e.g. it flagged a misleading string in `en/common.json` while the repo rule
  requires every string in both `en` and `el`; the Greek file needed the same
  fix. Fix the rule violation fully, not just the flagged line.
- **The `🤖 Prompt for AI Agents` block is a lead, not a spec.** It's written
  without understanding cross-cutting design. Verify its proposed assertion
  against the actual implementation before coding it. Real example: it said
  "assert no rows are created for the wrong tenant" on a payroll endpoint —
  but that endpoint deliberately triggers an all-org allocation job (same
  idempotent pass as the cron), so the literal test fails. The right move was
  to test what the system actually guarantees (rows always land under their
  own org). When a finding's premise is wrong but the underlying concern is
  real, **reframe the fix and say so in a thread reply** rather than skipping
  or force-fitting.
- **A suggested code fix can be correct even when the prose around it is
  shallow** — the stale-state fix it proposed for a React form was appliable
  nearly verbatim. Evaluate the diff on its merits.

### If you fixed it — resolve the thread

GitHub's REST API doesn't expose thread resolution; use GraphQL. First get
the thread's node ID:

```bash
gh api graphql -f query='
{
  repository(owner: "<owner>", name: "<repo>") {
    pullRequest(number: <N>) {
      reviewThreads(first: 50) {
        nodes {
          id
          isResolved
          comments(first: 1) { nodes { databaseId body } }
        }
      }
    }
  }
}'
```

One-shot variant that prints only unresolved threads as `<node-id> <comment-id>`
pairs, ready to match against the IDs from the REST fetch:

```bash
gh api graphql -f query='{ repository(owner: "<owner>", name: "<repo>") {
  pullRequest(number: <N>) { reviewThreads(first: 50) {
    nodes { id isResolved comments(first: 1) { nodes { databaseId } } } } } } }' \
  --jq '.data.repository.pullRequest.reviewThreads.nodes[]
        | select(.isResolved==false) | "\(.id) \(.comments.nodes[0].databaseId)"'
```

Match the `databaseId` to the comment ID you found above, then resolve
(loop over all addressed threads in one shell `for` — don't do one tool
call per thread):

```bash
for t in <node-id-1> <node-id-2> ...; do
  gh api graphql -f query="mutation { resolveReviewThread(input: {threadId: \"$t\"}) { thread { isResolved } } }" \
    --jq '.data.resolveReviewThread.thread.isResolved'
done
```

Replying to a thread does **not** resolve it — if you replied (e.g. to
explain a reframed fix), still run the resolve mutation afterwards.

### If you're not fixing it — reply to the thread

Reply directly to CodeRabbit's inline comment with a concise explanation:

```bash
gh api repos/<owner>/<repo>/pulls/<N>/comments/<comment-id>/replies \
  -X POST -f body="$(cat <<'EOF'
Not applying: [one-sentence reason]. [Optional: one line of elaboration.]
EOF
)"
```

Keep the reply short — CodeRabbit threads are noise if they balloon. One
clear sentence why you're skipping is enough.

### CodeRabbit judgment table

| Comment type | Action |
|---|---|
| 🔴 Critical / real bug | Fix it, then resolve the thread |
| 🟠 Major + "Source: Coding guidelines" | Verify the gap actually exists (coverage may live in another test file), then fix; rebuttal only with evidence |
| 🟡 Minor / quick win | Fix if genuinely better, rebuttal + reply if debatable |
| 💤 Low value / nitpick | Rebuttal + reply ("low signal, skipping") or fix if trivial |
| Premise wrong but concern real | Reframe the fix to what the system guarantees, reply explaining the reframe, resolve |
| Already fixed in a prior commit | Resolve the thread; no reply needed |
| False positive / misread code | Reply explaining why, resolve |

### Scorecard for the final report

Users paying for CodeRabbit periodically ask whether it earns its keep.
While working the threads, track per finding: **real bug / valid policy
enforcement / useful nitpick / reframed (premise wrong) / false positive**,
plus anything it *missed* that you caught (e.g. the sibling-locale file).
Include this scorecard in the Step 6 report — it costs nothing extra and
answers the "is this bot worth the money" question with evidence.

---

## Step 6 — Push and confirm

1. Push the branch:
   ```bash
   git push origin <BRANCH>
   ```

2. Watch the CI run:
   ```bash
   gh run watch  # streams the latest run
   # or:
   gh pr checks <N> --watch
   ```

3. Once all checks are green, report back to the user:
   - List what was fixed (grouped: CI / security / review comments /
     conflicts)
   - List anything that couldn't be fixed automatically and why (e.g.
     secrets that need manual rotation)
   - Confirm the PR is in a mergeable state or state what's still blocking

---

## Judgment calls

| Situation | Action |
|-----------|--------|
| CI failure is a flaky test with a known pattern | Re-run the check, note it as flaky, don't modify code |
| Reviewer comment conflicts with CLAUDE.md/project conventions | Rebuttal citing the convention |
| Upgrade would require a major-version migration | Note it; don't do it silently. Ask user. |
| CodeQL false positive | Rebuttal with evidence (e.g. input is already validated upstream) |
| Secret found in code | STOP. Rotate first. Never push. |
| PR has 20+ unresolved comments | Summarise your plan and get user confirmation before bulk-fixing |

---

## Pre-push checklist

Before every `git push`:
- [ ] `dotnet build` (or `npm run build`) passes with no errors
- [ ] Tests pass locally
- [ ] No secret / credential in any new or modified file
- [ ] Commit messages are descriptive (no "fix stuff", "wip")
- [ ] Branch is up-to-date with `<BASE>` (merge done in Step 2)

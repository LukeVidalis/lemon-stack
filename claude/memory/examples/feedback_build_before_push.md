---
type: feedback
subject: build-before-push
created_at: 2026-05-25T00:00:00Z
updated_at: 2026-05-25T00:00:00Z
---

# Run build + tests locally before every push

CI runs the project's build inside Docker. Local pre-push catches compile errors and broken tests in seconds, instead of waiting 2-5 minutes for CI and then redeploying.

For each project type:
- **Node/React** — `npm run build` (and `npm test` if a test script exists)
- **.NET** — `dotnet build` and `dotnet test`
- **Python** — whatever the project README documents (ruff, pytest, mypy)

If the toolchain is not installed locally, **say so explicitly** rather than skip silently. The next agent should know whether your "ready to push" really means "local build verified" or "untested, only static review."

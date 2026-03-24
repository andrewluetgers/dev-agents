---
name: onboard-project
description: Assess a project for agent readiness, create .dev-agents/ config and memory, run the legibility checklist, and make a plan for closing gaps.
argument-hint: [path to repo]
---

# Onboard Project

Interactive assessment of a project's readiness for agent-driven development. Walks through the full development loop, identifies legibility gaps, creates configuration, and produces an action plan.

Use the task system to track progress. Create all tasks up front, update as you go.

## Task List

Create these tasks at the start:

1. **Validate project** — confirm it's a git repo, identify stack, find existing docs
2. **Bootstrap .dev-agents/** — create config.json, memory.md, LEGIBILITY.md, WORKFLOW.md
3. **Assess: Can agents build it?** — test the build/install loop
4. **Assess: Can agents run it?** — test the dev server, health checks, service dependencies
5. **Assess: Can agents verify changes?** — test typecheck, tests, lint
6. **Assess: Can agents navigate the code?** — check for CLAUDE.md, architecture docs, types
7. **Assess: Is knowledge in the repo?** — check for ADRs, documented decisions, env setup scripts
8. **Assess: Can agents query the environment?** — databases, search, logs, CI/CD
9. **Write the legibility scorecard** — summarize findings with scores
10. **Create the gap closure plan** — prioritized action items to improve agent readiness
11. **Register project with orchestrator** — add to ~/dev-agents/orchestrator/config.json

## Procedure

### 1. Validate project

The argument `$ARGUMENTS` is the path to the repo. Verify:

```bash
cd $ARGUMENTS
git rev-parse --show-toplevel   # is it a git repo?
ls package.json                  # what's the stack?
ls CLAUDE.md                     # existing agent guidance?
ls -d .dev-agents/ 2>/dev/null   # already onboarded?
```

If `.dev-agents/` already exists, ask: "This project has been onboarded before. Do you want to re-assess, or just update the config?"

Identify the stack by reading package.json, Cargo.toml, go.mod, requirements.txt, etc. Ask the user to confirm.

### 2. Bootstrap .dev-agents/

Create the directory and starter files. Ask the user questions to populate them:

**config.json** — Ask:
- "What environment variables does this project need?" (scan for .env, .env.example)
- "Are there data directories agents will need access to?"
- "What skills should agents have?" (suggest based on stack: ado-boards, gcloud, etc.)
- "What's the default branch? Main branch?"

**memory.md** — Ask:
- "Give me a one-line description of this project"
- "Who are the key people working on it?"
- "Any architectural decisions or constraints I should know about?"
- Scan existing docs (README, CLAUDE.md, docs/) and extract key points

**WORKFLOW.md** — Generate from the stack:
- Detect package manager (pnpm, npm, yarn, bun)
- Detect test runner (vitest, jest, pytest, go test)
- Detect linter (eslint, oxlint, ruff, golangci-lint)
- Build the hooks section (after_create: clone + install, before_run: pull + install)
- Build the gates section from detected tools
- Write the prompt template

**LEGIBILITY.md** — Copy the checklist template, we'll fill it in during assessment.

### 3. Assess: Can agents build it?

Try the full install loop inside the project directory:

```bash
# Detect and run install
pnpm install    # or npm install, yarn, bun install, cargo build, etc.
```

Record:
- Did it work on first try?
- How long did it take?
- Any errors? What's missing?
- Does it need env vars, credentials, or services to install?

Update LEGIBILITY.md with findings.

### 4. Assess: Can agents run it?

Try to start the development server:

```bash
pnpm dev    # or npm run dev, cargo run, go run, etc.
```

Check:
- Does the app start without manual intervention?
- Are service dependencies available? (database, search engine, cache)
- Is there a health check endpoint?
- Can you curl an API endpoint?

```bash
# Example checks
curl -s localhost:3001/api/health
curl -s localhost:5173
```

If the app needs external services (Postgres, Vespa, Redis), note which ones and whether they're scripted or manual setup.

Update LEGIBILITY.md with findings.

### 5. Assess: Can agents verify changes?

Run the deterministic gates:

```bash
pnpm typecheck   # or tsc --noEmit, mypy, etc.
pnpm test        # or vitest, jest, pytest, go test, etc.
pnpm lint        # or eslint, oxlint, ruff, etc.
```

For each gate, record:
- Does it exist?
- Does it pass currently?
- How long does it take?
- Are there flaky tests?
- Do test failures include enough context to diagnose?

Update LEGIBILITY.md with findings.

### 6. Assess: Can agents navigate the code?

Check for:

```bash
ls CLAUDE.md                          # golden principles
ls docs/                              # architecture docs
ls docs/ARCHITECTURE*.md              # architecture overview
find . -name "*.d.ts" | head -5       # type definitions
```

Evaluate:
- Is there a CLAUDE.md or equivalent with code conventions?
- Are architecture docs current (check git blame for staleness)?
- Is the file structure consistent and predictable?
- Are types explicit or is there lots of `any`?
- Are there inline comments explaining non-obvious choices?

If CLAUDE.md doesn't exist, offer to help create one based on what you see in the codebase.

Update LEGIBILITY.md with findings.

### 7. Assess: Is knowledge in the repo?

Check for:
- ADRs (Architecture Decision Records) in `docs/` or `adr/`
- Documented env setup (scripted vs wiki)
- Commit messages quality (do they explain why, not just what?)
- Are gotchas documented anywhere, or only in Slack?

Ask the user:
- "Is there important context about this project that lives outside the repo? Slack threads, Confluence pages, people's heads?"
- "Any gotchas that trip up new developers?"
- "Any past incidents that affect how the code should be treated?"

Capture answers in memory.md.

### 8. Assess: Can agents query the environment?

Check connectivity to services:

```bash
# Database
psql $DATABASE_URL -c "SELECT 1" 2>/dev/null || echo "DB not reachable"

# Search (Vespa, Elasticsearch)
curl -s localhost:8081/state/v1/health 2>/dev/null || echo "Search not reachable"

# Cloud CLI
gcloud auth print-access-token >/dev/null 2>&1 && echo "GCP OK" || echo "GCP not authed"
az account show >/dev/null 2>&1 && echo "Azure OK" || echo "Azure not authed"

# CI/CD
gh pr list --limit 1 >/dev/null 2>&1 && echo "GitHub OK" || echo "GitHub not available"
```

Note which services are available and which need setup.

### 9. Write the legibility scorecard

Summarize findings in LEGIBILITY.md. For each category, assign a status:

```
## Scorecard

| Category | Status | Notes |
|----------|--------|-------|
| Build | ✅ / ⚠️ / ❌ | |
| Run | ✅ / ⚠️ / ❌ | |
| Verify | ✅ / ⚠️ / ❌ | |
| Navigate | ✅ / ⚠️ / ❌ | |
| Knowledge | ✅ / ⚠️ / ❌ | |
| Environment | ✅ / ⚠️ / ❌ | |
```

- ✅ = agents can do this autonomously
- ⚠️ = works but with friction (manual steps, missing docs, slow)
- ❌ = agents can't do this without human help

### 10. Create the gap closure plan

For every ⚠️ and ❌, create a prioritized action item. Group by effort:

**Quick wins** (< 1 hour):
- Add missing scripts to package.json
- Document env vars in .env.example
- Add health check endpoint
- Write error messages that point to docs

**Medium effort** (1-4 hours):
- Write CLAUDE.md with golden principles
- Update stale architecture docs
- Script the dev environment setup
- Add missing test coverage for critical paths

**Larger investment** (1+ days):
- Add ADRs for key architectural decisions
- Move tribal knowledge from Slack to docs
- Add structured logging
- Set up local observability stack

Write this plan to `.dev-agents/LEGIBILITY.md` in the "Gap Closure Plan" section.

Ask the user: "Which of these do you want to tackle first? I can help with any of them right now."

### 11. Register with orchestrator

Add the project to the orchestrator's config:

```bash
# Read current config
cat ~/dev-agents/orchestrator/config.json
```

Add the project entry with the detected local path. Write the updated config.

Tell the user: "Project registered. When the orchestrator is running, it will read `.dev-agents/` from this repo for workflow and memory."

## After Onboarding

Tell the user:

"Onboarding complete. Here's what was created:

```
.dev-agents/
  ├── config.json      ← project config (env, skills, branches)
  ├── memory.md        ← project context (architecture, people, gotchas)
  ├── LEGIBILITY.md    ← agent readiness scorecard + gap closure plan
  └── WORKFLOW.md      ← how agents handle work items for this project
```

Next steps:
1. Review and commit these files
2. Work through the gap closure plan to improve agent readiness
3. Move a work item into the agent sprint to test the full loop

The legibility score is a living document — re-run `/onboard-project` periodically to reassess as the project evolves."

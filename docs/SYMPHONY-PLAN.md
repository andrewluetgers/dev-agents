# Symphony Implementation Plan

Implementing OpenAI's Symphony spec on top of our existing dev-agents orchestration system, adapted for Azure DevOps and Claude Code. Incorporates harness engineering patterns from OpenAI's production methodology.

## What We're Building

A long-running orchestration service that:
1. Polls an ADO agent sprint for work items
2. Spawns isolated agent containers for each item
3. Guides agents through structured execution phases (research → plan → execute → verify)
4. Monitors progress with stall detection and reconciliation
5. Retries failed work with exponential backoff
6. Enforces deterministic quality gates before marking work complete
7. Maintains bidirectional communication with agents (our addition beyond Symphony)
8. Reports results back to ADO and notifies the user
9. Improves the harness when agents struggle (the meta-loop)

## Harness Engineering Principles

These principles govern how the system operates. They're drawn from OpenAI's harness engineering methodology and adapted for our context.

### 1. Documentation is the Table of Contents, Not the Encyclopedia

The agent's system prompt should be a **short map with pointers**, not a dump of everything. The WORKFLOW.md prompt template points agents to deeper sources:
- `CLAUDE.md` for code conventions and golden principles
- `docs/` for architecture and design decisions
- `.dev-agents/memory.md` for project context and gotchas
- The code itself for the current state of things

### 2. Golden Principles are Enforced, Not Suggested

Each repo's CLAUDE.md encodes opinionated, mechanical rules. These are **non-negotiable constraints** for agents, not guidelines:
- No fallbacks — let it fail, fix the root cause
- No N+1 queries — always use JOINs
- No backwards compatibility — clean up old code
- Use the typed SDK (oRPC, Drizzle, Zod v4) — don't guess at shapes
- Generate UUIDs in TypeScript, not in the database

These survive because they're checked by deterministic gates (typecheck, lint, tests).

### 3. Code Design is Context

Well-structured code reduces the need for documentation. When the agent reads well-named functions, clear types, and consistent patterns, it doesn't need lengthy explanations. Invest in code quality to improve agent quality.

### 4. Deterministic Gates Before LLM Evaluation

Not everything needs AI judgment. Use hard, deterministic checks first:
- `pnpm typecheck` — types correct? (machine says yes/no)
- `pnpm test` — tests pass? (machine says yes/no)
- `pnpm lint` — style consistent? (machine says yes/no)
- `git status --porcelain` — workspace clean? (machine says yes/no)

Only after all gates pass does the orchestrator (LLM) evaluate the work.

### 5. Structured Execution Phases

Agents don't just "implement the feature." They work through phases with clear gates between them. **Phases 2 and 3 are interactive touch points** where the orchestrator (representing the user) actively participates.

```
Phase 1: Research (agent solo)
  - Read the relevant code, docs, and tests
  - Understand the existing patterns
  - Output: understanding, no code changes

Phase 2: Plan ★ INTERACTIVE — key touch point
  - Agent proposes a plan to the orchestrator
  - Orchestrator reviews, may relay to user for input
  - Back-and-forth until approach is agreed
  - Plan is NOT fire-and-forget — expect iteration
  - Output: approved plan

Phase 3: Execute ★ INTERACTIVE for hard decisions
  - Implement in small, focused commits
  - Follow golden principles from CLAUDE.md
  - Pause at hard engineering tradeoffs and consult orchestrator
  - "Two reasonable approaches exist" = ask, don't guess
  - Output: working code with tests

Phase 4: Verify (agent solo, deterministic)
  - Run all deterministic gates
  - Fix any failures
  - Output: all gates green

Phase 5: Deliver (agent solo)
  - Push feature branch
  - Create PR referencing the work item
  - Update ADO work item
  - Output: PR ready for review
```

The interactive phases are where value is created. Research, verify, and deliver are mechanical — any agent can do them. Planning well and making the right engineering tradeoffs require collaboration. The orchestrator's job is to facilitate this, either by answering from its own context or by escalating to the user.

### 6. Entropy Management (The Meta-Loop)

When agents struggle, treat it as a signal. The orchestrator should:
- Track failure patterns across agents and issues
- Update `.dev-agents/memory.md` with new gotchas
- Update `CLAUDE.md` if agents keep violating a convention
- Update `WORKFLOW.md` if the prompt template needs better guidance
- Update shared skills if a common operation keeps failing

This is the **meta-loop** — the system improves itself over time.

### 7. Depth-First, Not Breadth-First

Break goals into building blocks. Don't dispatch "implement the whole feature." Dispatch:
1. "Research the auth system and write a plan"
2. (Review plan) "Implement the plan"
3. "Verify and deliver"

Each step validates before the next begins. The orchestrator manages the progression.

## What We Already Have

| Component | Status | Notes |
|-----------|--------|-------|
| Agent Docker image | Built | Bun-based, worker + orchestrator modes |
| MCP channel server | Built | Push events into Claude Code session |
| Agent spawning | Built | Dynamic containers, auto-assigned ports |
| Permission relay | Built | Orchestrator approves/denies agent tool use |
| Bidirectional messaging | Built | message/reply/ask between orchestrator and agents |
| ADO CLI integration | Tested | az CLI with SSO, work items + pipelines working |
| ADO boards skill | Built | Query, update, create, link work items |
| ADO pipelines skill | Built | Approve, monitor pipeline runs |
| Shared skills/templates | Built | Reusable across agents |
| Project memory | Built | .dev-agents/memory.md in each repo |

## What We Need to Add

### Phase 1: ADO Agent Sprint Setup

**Goal**: Dedicated iteration path for agent work, clear separation from human work.

1. Create ADO iteration: `GenAI Digipath\Search App Pilot\Agent Sprint`
2. Update ADO boards skill config:
   - `agentIterationPath`: the agent sprint path
   - Write scope: only items in the agent iteration
   - Read scope: full project (for context)
3. Define work item conventions:
   - Items moved into agent sprint = ready for agent dispatch
   - Items created by agents go into agent sprint automatically
   - Moving items OUT of agent sprint = human reclaimed it, stop agent
4. Tags convention: `agent-assigned`, `agent-completed`, `agent-blocked` for quick filtering

### Phase 2: Workflow Definition (WORKFLOW.md)

**Goal**: Per-project workflow file that defines how agents handle work items.

Adapting Symphony's WORKFLOW.md pattern. Lives in each repo at `.dev-agents/WORKFLOW.md`:

```yaml
---
tracker:
  kind: ado
  org: mclm
  project: "GenAI Digipath"
  agent_iteration: "GenAI Digipath\\Search App Pilot\\Agent Sprint"
  active_states: ["New", "Active"]
  terminal_states: ["Closed", "Removed", "Resolved"]

polling:
  interval_ms: 30000

workspace:
  root: ~/dev-agents

agent:
  max_concurrent_agents: 3
  max_turns: 20
  max_retry_backoff_ms: 300000
  stall_timeout_ms: 300000

gates:
  - pnpm typecheck
  - pnpm test
  - pnpm lint

hooks:
  after_create: |
    git clone $REPO_URL .
    git checkout develop
    pnpm install
  before_run: |
    git pull --ff-only
    pnpm install --frozen-lockfile
---

You are a coding agent working on work item {{issue.identifier}}.

## Context

Read these before starting:
- `CLAUDE.md` — code conventions and golden principles (FOLLOW THESE)
- `.dev-agents/memory.md` — project context, architecture, gotchas
- `docs/ARCHITECTURE-SUMMARY.md` — system design overview

## Your Assignment

**{{issue.title}}**

{{issue.description}}

{% if issue.acceptance_criteria %}
**Acceptance Criteria:**
{{issue.acceptance_criteria}}
{% endif %}

{% if attempt %}
This is attempt {{attempt}}. Check the workspace for previous work.
Read `.dev-agents/memory.md` for notes from prior sessions.
Continue from where the last session left off — don't start over.
{% endif %}

## Execution Phases

Work through these in order. Complete each phase before moving to the next.

### Phase 1: Research
- Read the relevant source code, tests, and docs
- Understand existing patterns before writing new code
- Do NOT make changes yet

### Phase 2: Plan
- Create a brief plan in your workspace
- List files you'll change and your approach
- Push a status update to the orchestrator with your plan summary

### Phase 3: Execute
- Implement in small, focused commits
- Each commit should be a logical unit of work
- Follow CLAUDE.md golden principles — no fallbacks, no N+1, typed SDKs
- Write or update tests alongside your changes
- Reference {{issue.identifier}} in commit messages

### Phase 4: Verify
- Run all quality gates: `pnpm typecheck && pnpm test && pnpm lint`
- Fix any failures — do not skip or silence them
- Ensure `git status` is clean (no untracked files)

### Phase 5: Deliver
- Push to branch: `feature/{{issue.identifier | slugify}}`
- Report completion to the orchestrator with a summary of changes

## If You're Stuck
Push a status update explaining the blocker. The orchestrator will help
or escalate to the user. Do NOT silently spin — ask for help.
```

### Phase 3: Orchestrator Tick Loop

**Goal**: The core scheduling engine, adapted from Symphony's spec.

#### State Machine

```
Unclaimed ──dispatch──► Claimed/Running
Running ──success──► Released (schedule continuation retry)
Running ──failure──► RetryQueued (exponential backoff)
Running ──stall──► RetryQueued (kill + retry)
Running ──reconcile(terminal)──► Released (cleanup workspace)
Running ──reconcile(moved out)──► Released (stop agent, keep workspace)
RetryQueued ──timer──► Running (re-dispatch)
RetryQueued ──reconcile(terminal)──► Released
```

#### Tick Sequence (every polling.interval_ms)

```
1. Reconcile running agents
   a. Stall detection: kill agents with no activity > stall_timeout_ms
   b. ADO state refresh: stop agents whose items moved to terminal/non-active
   c. ADO iteration check: stop agents whose items left the agent sprint

2. Validate config
   a. WORKFLOW.md readable and parseable
   b. ADO credentials valid
   c. Agent image exists

3. Fetch candidate issues
   a. Query ADO: items in agent sprint with active states
   b. Filter: not already running, not already claimed
   c. Sort: priority ASC, created_at ASC

4. Dispatch eligible issues
   a. Check concurrency limits
   b. For each candidate:
      - Create/reuse workspace (~/dev-agents/<issue-identifier>/)
      - Render prompt from WORKFLOW.md template
      - Spawn agent container
      - Run hooks (after_create if new, before_run always)
      - Start Claude Code session with rendered prompt
      - Record user intent: issue title + description + acceptance criteria
      - Track in running map

5. Notify observers (push status update to user if anything changed)

6. Meta-loop check
   - Review any agent failures from this tick
   - If pattern detected, log it and consider harness updates
```

#### Orchestrator State (Per Running Agent)

```typescript
interface RunningAgent {
  issueId: number
  identifier: string
  issue: Issue                    // full normalized issue
  userIntent: string              // why this agent was spawned
  containerId: string
  hostPort: number
  channelPort: number
  homeDir: string
  startedAt: string
  lastActivityAt: string
  turnCount: number
  currentPhase: 'research' | 'plan' | 'execute' | 'verify' | 'deliver'
  status: string
}
```

### Phase 4: ADO Tracker Adapter

**Goal**: Issue tracker client matching Symphony's contract, for ADO instead of Linear.

#### Required Operations

```typescript
interface ADOTracker {
  fetchCandidateIssues(): Promise<Issue[]>
  fetchIssueStatesByIds(ids: number[]): Promise<Issue[]>
  fetchIssuesByStates(states: string[]): Promise<Issue[]>
}
```

#### Issue Normalization

| Symphony field | ADO field |
|---------------|-----------|
| id | System.Id |
| identifier | System.Id (e.g. "4908412") |
| title | System.Title |
| description | System.Description |
| priority | Microsoft.VSTS.Common.Priority |
| state | System.State |
| labels | System.Tags (split by ;) |
| branch_name | derived: `feature/<id>-<slugified-title>` |
| url | `https://dev.azure.com/{org}/{project}/_workitems/edit/{id}` |
| created_at | System.CreatedDate |
| updated_at | System.ChangedDate |
| acceptance_criteria | Microsoft.VSTS.Common.AcceptanceCriteria |
| blocked_by | Relations of type System.LinkTypes.Dependency-Reverse |

#### Implementation

Use `az boards` CLI commands wrapped in the tracker interface. The CLI handles auth, pagination, and error mapping.

### Phase 5: Workspace Manager

**Goal**: Per-issue workspaces with lifecycle hooks.

#### Layout

```
~/dev-agents/
  ├── orchestrator/           ← orchestrator home
  ├── shared/                 ← read-only shared resources
  └── ws-4908412/             ← workspace for issue 4908412
      ├── workspace/          ← repo clone
      │   └── cohort-search/
      ├── .claude/            ← agent's Claude settings
      └── env/                ← mounted env files
```

#### Lifecycle

1. **Create**: `mkdir -p`, run `after_create` hook (clone repo, install deps)
2. **Reuse**: Exists from previous attempt, run `before_run` hook (pull, install)
3. **Cleanup**: Terminal issue, run `before_remove` hook, delete workspace
4. **Persist**: Successful run keeps workspace for continuation/warm restart

### Phase 6: Retry and Backoff

**Goal**: Resilient handling of agent failures.

#### Retry Types

1. **Continuation** (agent finished a turn, issue still active): 1 second delay, next turn
2. **Failure** (agent crashed, timed out, stalled): exponential backoff
   - `delay = min(10000 * 2^(attempt - 1), max_retry_backoff_ms)`
   - Default max: 5 minutes
3. **Reconciliation** (issue state changed externally): no retry, just release

### Phase 7: Stall Detection

**Goal**: Detect and recover from stuck agents.

Track `lastActivityAt` per running agent. Activity = any push event (status, result, prompt, permission_request).

If `now - lastActivityAt > stall_timeout_ms`:
1. Message the agent: "You appear to be stalled. Save your work and report status."
2. Wait 30 seconds for a response
3. If no response, have agent save memories, then kill the container
4. Schedule retry with backoff
5. Log the stall in project memory for the meta-loop

### Phase 8: Proof of Work (Deterministic Gates)

**Goal**: Verify agent output with hard checks before LLM evaluation.

Gates are defined in WORKFLOW.md's `gates` field. Run in order:

```yaml
gates:
  - pnpm typecheck
  - pnpm test
  - pnpm lint
```

Each gate:
1. Dispatch the command to the agent container
2. Check exit code (0 = pass, non-zero = fail)
3. If any gate fails, the agent continues working (new turn, same workspace)
4. All gates pass → orchestrator evaluates the work (LLM review)
5. LLM review passes → mark work item Resolved, push PR

The orchestrator's LLM review checks:
- Does the change actually address the work item's requirements?
- Does it follow the project's golden principles?
- Are there obvious issues the gates wouldn't catch?

### Phase 9: Observability and ADO Integration

**Goal**: Know what's happening without staring at terminals.

#### ADO Status Updates

As agents work, the orchestrator updates ADO:
- **Agent starts**: Move work item New → Active, add comment "Agent assigned"
- **Agent completes a phase**: Add comment with phase summary
- **Agent blocked**: Add comment, tag `agent-blocked`
- **Gates pass**: Add comment with gate results
- **PR created**: Link PR to work item
- **Work complete**: Move Active → Resolved, tag `agent-completed`

#### Orchestrator Health Endpoint

Extend `/health` with:
- Running agents: issue, phase, turn count, last activity
- Retry queue: next attempt times, failure reasons
- Completed since last restart
- Token usage totals
- Meta-loop signals: recent failures, harness update suggestions

#### User Notifications

- Push events through channel for the user's Claude session
- ADO work item state changes trigger Teams notifications (existing infra)

## Implementation Order

| Phase | Effort | Dependencies | Priority |
|-------|--------|-------------|----------|
| 1. ADO Agent Sprint | Small | ADO access (done) | Do first |
| 2. WORKFLOW.md | Medium | Phase 1 | Do first |
| 3. Tick Loop | Large | Phase 2 | Core |
| 4. ADO Tracker | Medium | Phase 1, 3 | Core |
| 5. Workspace Manager | Medium | Phase 3 | Core |
| 6. Retry/Backoff | Small | Phase 3 | Resilience |
| 7. Stall Detection | Small | Phase 3 | Resilience |
| 8. Proof of Work | Medium | Phase 5 | Quality |
| 9. Observability | Medium | Phase 3, 4 | Polish |

**Recommended approach**: Phases 1-2 first (setup), then 3-5 together (core loop), then 6-7 (resilience), then 8-9 (quality + visibility).

## Open Questions

1. **Max concurrent agents**: How many agents can run simultaneously? Each gets 4GB memory. With 3 agents + orchestrator, that's ~16GB.

2. **Branch strategy**: Agents work on `feature/<issue-id>-<slug>` branches. Auto-create PRs.

3. **PR review**: Orchestrator does LLM review after gates pass. Human reviews the PR on GitHub/ADO.

4. **Continuation vs fresh start**: Continue by default (workspace persists, memory file has context). Fresh start only on explicit reset.

5. **ADO pipeline trigger**: Leave manual for now. The orchestrator can approve pipeline runs via the ado-pipelines skill when asked.

6. **Multi-project**: One orchestrator, multiple WORKFLOW.md files (one per repo). The tick loop iterates across all registered projects.

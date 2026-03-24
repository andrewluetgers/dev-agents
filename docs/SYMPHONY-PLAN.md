# Symphony Implementation Plan

Implementing OpenAI's Symphony spec on top of our existing dev-agents orchestration system, adapted for Azure DevOps and Claude Code.

## What We're Building

A long-running orchestration service that:
1. Polls an ADO agent sprint for work items
2. Spawns isolated agent containers for each item
3. Monitors progress with stall detection and reconciliation
4. Retries failed work with exponential backoff
5. Maintains bidirectional communication with agents (our addition beyond Symphony)
6. Reports results back to ADO and notifies the user

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

Adapting Symphony's WORKFLOW.md pattern for our system. Lives in each repo at `.dev-agents/WORKFLOW.md`:

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

hooks:
  after_create: |
    git clone $REPO_URL .
    git checkout $BRANCH
    pnpm install
  before_run: |
    git pull --ff-only
    pnpm install --frozen-lockfile
---

You are a coding agent working on the {{issue.identifier}} work item:

**Title**: {{issue.title}}
**Description**: {{issue.description}}
**Acceptance Criteria**: {{issue.acceptance_criteria}}
**Priority**: {{issue.priority}}

{% if attempt %}
This is retry attempt {{attempt}}. Review what was done previously
in the workspace and continue from where the last session left off.
Check .dev-agents/memory.md for notes from the previous session.
{% endif %}

## Your task

Implement the work described above. Follow the project's CLAUDE.md conventions.

## When you're done

1. Ensure all tests pass: `pnpm test`
2. Ensure types check: `pnpm typecheck`
3. Commit your changes with a descriptive message referencing {{issue.identifier}}
4. Push to a feature branch: `git push -u origin {{issue.identifier | slugify}}`
5. Report completion to the orchestrator

## If you're blocked

Push a status update explaining what you're blocked on. The orchestrator
will either help you or escalate to the user.
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
   b. ADO state refresh: stop agents whose items moved to terminal/non-active state
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
      - Track in running map

5. Notify observers (push status update to user if anything changed)
```

#### Implementation Location

Add to `channel/agent-channel.ts` as a new module or separate file that the channel imports. The tick loop runs alongside the HTTP listener and MCP server in the same Bun process.

### Phase 4: ADO Tracker Adapter

**Goal**: Issue tracker client matching Symphony's contract, for ADO instead of Linear.

#### Required Operations

```typescript
interface ADOTracker {
  // Fetch work items in agent sprint with active states
  fetchCandidateIssues(): Promise<Issue[]>

  // Fetch current state for specific work item IDs (reconciliation)
  fetchIssueStatesByIds(ids: number[]): Promise<Issue[]>

  // Fetch terminal-state items (startup cleanup)
  fetchIssuesByStates(states: string[]): Promise<Issue[]>
}
```

#### Issue Normalization

Map ADO fields to Symphony's Issue entity:

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

Use `az boards` CLI commands (already tested and working) wrapped in the tracker interface. No direct REST API needed — the CLI handles auth, pagination, and error mapping.

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

Workspace key: sanitized issue identifier (e.g. `ws-4908412`).

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

#### Retry State

```typescript
interface RetryEntry {
  issueId: number
  identifier: string
  attempt: number        // 1-based
  dueAtMs: number        // when to retry
  error?: string         // why previous attempt failed
}
```

### Phase 7: Stall Detection

**Goal**: Detect and recover from stuck agents.

Track `lastActivityTimestamp` per running agent. Activity = any push event from the agent (status, result, prompt, permission_request).

If `now - lastActivityTimestamp > stall_timeout_ms`:
1. Message the agent: "You appear to be stalled. Save your work and report status."
2. Wait 30 seconds for a response
3. If no response, have agent save memories, then kill the container
4. Schedule retry with backoff

### Phase 8: Proof of Work

**Goal**: Verify agent output before marking work complete.

Before marking a work item as Resolved, the orchestrator should verify:

1. **Tests pass**: dispatch `pnpm test` and check exit code
2. **Types check**: dispatch `pnpm typecheck`
3. **Branch pushed**: check `git log --oneline origin/<branch>..HEAD` is empty
4. **PR created**: check for open PR referencing the issue
5. **No untracked files**: dispatch `git status --porcelain`

If any check fails, the agent continues working (counts as a new turn).

### Phase 9: Observability

**Goal**: Know what's happening without staring at terminals.

#### Status Surface

The orchestrator channel's `/health` endpoint already returns agent state. Extend it with:
- Running agents with current issue, turn count, last activity
- Retry queue with next attempt times
- Completed issues since last restart
- Token usage totals

#### ADO Integration

- Add comments to work items as agents make progress
- Update work item state transitions (New → Active when agent starts, Active → Resolved when verified)
- Link PRs to work items

#### User Notifications

- Push events through the channel for the user's Claude session
- For mobile: ADO work item state changes trigger Teams notifications (existing infra)

## Implementation Order

| Phase | Effort | Dependencies | Priority |
|-------|--------|-------------|----------|
| 1. ADO Agent Sprint | Small | ADO access (done) | Do first |
| 2. WORKFLOW.md | Medium | Phase 1 | Do first |
| 3. Tick Loop | Large | Phase 2 | Core — do next |
| 4. ADO Tracker | Medium | Phase 1, 3 | Core — do next |
| 5. Workspace Manager | Medium | Phase 3 | Core — do next |
| 6. Retry/Backoff | Small | Phase 3 | Add to tick loop |
| 7. Stall Detection | Small | Phase 3 | Add to tick loop |
| 8. Proof of Work | Medium | Phase 5 | After core works |
| 9. Observability | Medium | Phase 3, 4 | Polish |

**Recommended approach**: Phases 1-2 first (setup), then 3-5 together (core loop), then 6-7 (resilience), then 8-9 (quality + visibility).

## Open Questions

1. **Max concurrent agents**: How many agents can run simultaneously on your machine? Each gets 4GB memory. With 3 agents + orchestrator, that's ~16GB.

2. **Branch strategy**: Should agents work on feature branches named after the issue ID? Should they create PRs automatically?

3. **PR review**: Should the orchestrator review PRs from agents before they're marked complete? Or is the proof-of-work check sufficient?

4. **Continuation vs fresh start**: When retrying, should agents continue in the same workspace (with memory) or start fresh? Symphony continues by default, fresh only on explicit reset.

5. **ADO pipeline trigger**: Should completing a work item automatically trigger the deployment pipeline? Or leave that manual?

6. **Multi-project**: The tick loop currently assumes one project. When we add more projects, do they share the same orchestrator with separate WORKFLOW.md files, or separate orchestrator instances?

# Interface Design

Design document for the dev-agents web dashboard. Covers layout, inspirations, current features, and planned work.

## Inspirations

### cmux (https://github.com/greymd/cmux)

Terminal multiplexer concept. The sidebar/agent panel layout draws from cmux's approach to showing multiple terminal sessions side-by-side. The sidebar lists sessions (agents), and the main panel shows the selected session's output. This is the structural backbone of the dashboard.

### OpenAI Symphony (https://github.com/openai/symphony)

Multi-agent orchestration framework. Symphony's approach to task tracking influenced the kanban board view — agents working on issues map naturally to cards moving across lanes (backlog → planning → in progress → review → done). The WORKFLOW.md template system and structured execution phases come directly from Symphony's spec.

### Ghostty (https://ghostty.org)

Terminal emulator. The orchestrator terminal view uses ghostty-web, the WASM build of Ghostty, to embed a real terminal in the browser. This gives the user a full Claude Code CLI session in the dashboard — they can type commands, run the orchestrator, and see output with proper ANSI rendering. Using Ghostty instead of xterm.js gives native-quality terminal rendering.

### Claude Code

The CLI tool agents run. Claude Code's stream-json protocol is the foundation for agent observability — every tool call, text generation, and result is a structured JSON event that the dashboard can parse and display. The `/btw` message injection pattern (sending a user message while Claude is working) inspired the message input bar on the agent detail view.

### Harness Engineering

Making codebases legible to AI agents. The STATUS.md convention (agents write structured progress updates) came from the idea that agent state should be inspectable at any time. The legibility scorecard and WORKFLOW.md patterns help agents navigate unfamiliar codebases.

## Layout

```
┌──────────────────────────────────────────────────────────────┐
│  dev-agents                                             [+]  │
├──────────┬───────────────────────────────────────────────────┤
│          │                                                   │
│  Sidebar │  Main Panel                                       │
│  (264px) │                                                   │
│          │  ┌─────────────────────────────────────────────┐  │
│ ┌──────┐ │  │ Header: agent name + session status badge   │  │
│ │ Orch │ │  ├─────────────────────────────────────────────┤  │
│ │      │ │  │ Tabs: Status | Log | Changes | Loops        │  │
│ └──────┘ │  ├─────────────────────────────────────────────┤  │
│ ┌──────┐ │  │                                             │  │
│ │ag-1  │ │  │  Tab content (scrollable)                   │  │
│ │● run │ │  │                                             │  │
│ └──────┘ │  │  - Status: rendered STATUS.md               │  │
│ ┌──────┐ │  │  - Log: parsed stream-json events           │  │
│ │ag-2  │ │  │  - Changes: git diff --stat + diff          │  │
│ │● done│ │  │  - Loops: recurring commands table          │  │
│ └──────┘ │  │                                             │  │
│          │  ├─────────────────────────────────────────────┤  │
│          │  │ Message input bar                           │  │
│ 2 agents │  │ [Type a message to send to agent...] [Send] │  │
│          │  └─────────────────────────────────────────────┘  │
└──────────┴───────────────────────────────────────────────────┘
```

The layout is a fixed sidebar + flexible main panel. The sidebar is always visible. The main panel changes based on selection.

## Views

### Sidebar (`apps/web/src/components/Sidebar.tsx`)

Fixed 264px left panel. Contains:

- **Header**: "dev-agents" branding + spawn button (`+`)
- **Orchestrator entry**: Always first. Shows unread badge when events arrive.
- **Agent list**: Each agent shows:
  - Status indicator dot (color-coded: green=running, yellow=starting, blue=thinking/tool_use, gray=done/idle, red=error)
  - Agent name (truncated)
  - Project name (if assigned)
  - Current status text
  - Unread event badge (accent-colored pill)
- **Footer**: Agent count

Unread tracking uses the `useGlobalUnread` hook, which listens to the WebSocket event stream and increments counters per agent. Selecting an agent clears its unread count.

### Agent Detail (`apps/web/src/components/AgentDetail.tsx`)

Main panel when an agent is selected. Four tabs:

**Status tab**: Renders the agent's `/home/agent/STATUS.md` as formatted markdown. Agents are instructed to maintain this file as a structured progress report. Polled every 5 seconds. If no STATUS.md exists, shows a placeholder message.

**Log tab** (`LogView`): Displays the Claude Code session log (`/home/agent/claude-session.log`). Each line is a stream-json event — the log view parses and formats these with syntax highlighting. Polled every 3 seconds. Shows unread badge on the tab when new events arrive while viewing another tab.

**Changes tab**: Shows `git diff --stat` and `git diff HEAD` from the agent's workspace. Color-coded: green for additions, red for deletions, blue for chunk headers. Only fetched when the tab is active (10-second interval).

**Loops tab** (`LoopsView`): Manages recurring commands for the agent. Each loop has:
- Label, command, type (exec or message), interval
- Enable/disable toggle
- Last run time and result
- Delete button

**Message input**: Always visible at the bottom of the agent detail view. Text input with send button. Sends the message to the agent's channel server (`:9222/message`), which injects it into the Claude Code session. This is the equivalent of Claude Code's `/btw` feature — you can send context or corrections while the agent is working.

### Orchestrator View (`apps/web/src/components/OrchestratorView.tsx`)

Main panel when "Orchestrator" is selected in the sidebar. Two tabs:

**Terminal tab** (`TerminalView`): Embedded terminal using ghostty-web (WASM). Connects to the host server's `/api/terminal` WebSocket, which spawns a `bash -l` shell. The user can run any command here, including starting Claude Code as the orchestrator. Terminal auto-sizes to the container via `FitAddon`.

**Events tab** (`EventStreamView`): Live feed of all agent events received via WebSocket. Each event shows the agent name, event type, content, and timestamp. Useful for seeing the full event stream without selecting individual agents.

### Board View (`apps/web/src/components/BoardView.tsx`)

Kanban-style board with five lanes:

| Lane | Maps from agent status |
|------|----------------------|
| Backlog | (manual cards only, currently) |
| Planning | `starting`, `discovered` |
| In Progress | `running`, `thinking`, `tool_use` |
| Review | `error` |
| Done | `done` |

Each card shows the task title, project, and assigned agent. Cards are currently auto-generated from running agents (agent status maps to lane). The backlog lane has an "Add task" button (placeholder).

### Empty State (`EmptyState`)

Shown when no agent is selected. Displays agent count and a prompt to select an agent or spawn a new one.

### Spawn Dialog (`SpawnDialog`)

Modal dialog for creating a new agent. Fields:
- Agent name (text input)
- Project (selection from registered projects or manual path)
- Initial task (text area, optional)

Calls the `agent.spawn` oRPC procedure, which runs `docker run` on the host.

## Features

### Live Stream

Each agent's Claude Code session produces stream-json events. The agent server (`image/server.ts`) broadcasts these as SSE on `:9111/stream`. The host server proxies this at `/api/agents/:id/stream`. The dashboard's log view consumes this stream for real-time updates.

Event types in the stream:
- `system/init` — session started
- `assistant` with `tool_use` blocks — Claude calling tools (Read, Edit, Bash, etc.)
- `assistant` with `text` blocks — Claude generating text
- `result/success` or `result/error` — session completed

### Message Injection

The message input bar on the agent detail view sends messages via `POST :channelPort/message`. The agent server writes this to Claude's stdin as a stream-json user message:

```json
{"type": "user", "message": {"role": "user", "content": "[From dashboard]: your message"}}
```

Claude treats this as a new user turn and responds. This is how you redirect agents, provide missing context, or ask questions mid-task.

### Unread Badges

The dashboard tracks unread events per agent via WebSocket. When events arrive for an agent you're not viewing, the sidebar shows a numbered badge. Selecting the agent clears the count. The orchestrator entry also has its own unread counter.

Implementation: `useGlobalUnread` hook subscribes to `/api/ws`, maintains a `Map<agentId, count>`, and resets counts when the user views an agent.

### Permission Approval

When an agent needs tool approval, the permission request flows through:
1. Agent's MCP server intercepts the permission notification
2. Pushes to orchestrator via HTTP
3. Orchestrator's Claude session sees the request and calls `approve` or `deny`
4. Verdict is relayed back to the agent

The dashboard shows permission events in the event stream. The oRPC `agent.permission` procedure allows the dashboard to directly approve/deny permissions as well.

### Loops

Recurring commands that run on an interval for a specific agent. Two types:
- **exec**: Runs a shell command in the container (e.g., `pnpm test`)
- **message**: Sends a message to the agent's Claude session (e.g., "report your status")

Managed through the Loops tab on the agent detail view. The host server syncs loop intervals every 2 seconds.

## Theming

The dashboard uses CSS custom properties for theming (`var(--background)`, `var(--foreground)`, `var(--accent)`, etc.). Dark theme by default. Colors:
- Background: near-black (`#0a0a0a` to `#141414`)
- Accent: blue (`#3b82f6`)
- Success: green
- Warning: yellow
- Error: red
- Muted: gray tones

Terminal background matches the dashboard theme. Status indicator dots use the same color vocabulary as the rest of the UI.

## Planned Features

### Task Tracker Adapters

Connect to external issue trackers to pull work items and push status:
- **Azure DevOps** — query agent sprint, update work items, link PRs
- **GitHub Issues** — pull issues, update labels, close on completion
- **Linear** — pull issues by project/cycle, push status updates

The Symphony plan (`docs/SYMPHONY-PLAN.md`) details the ADO adapter design. The board view would show real issue tracker cards instead of (or alongside) auto-generated agent cards.

### xterm.js Terminal for Agents

Add an embedded terminal per agent (not just the orchestrator). Connect to the agent container's shell via WebSocket, allowing direct interaction with the container filesystem. Would use xterm.js or ghostty-web with a per-container PTY WebSocket.

### Screenshot Gallery

Agents with Playwright MCP save screenshots to `/home/agent/screenshots/`. A gallery view would show these thumbnails with timestamps, allowing visual verification of UI changes without opening the container.

### Drag-and-Drop Kanban

Make the board view interactive:
- Drag cards between lanes
- Create/edit cards manually
- Assign agents to cards
- Sync lane changes back to the issue tracker

### Agent Spawn from Board

Click "Add task" in the backlog, describe the task, and the system spawns an agent for it. The card moves through lanes as the agent progresses.

### Multi-Project Dashboard

Group agents by project. Show project-level health (how many agents running, overall progress). Filter the sidebar and board by project.

### Resource Monitoring

Show CPU, memory, and disk usage per container. Alert when agents are consuming excessive resources or appear stalled.

### Conversation View

Instead of raw stream-json log, render the agent's conversation as a chat-style view — assistant messages, tool calls with collapsible details, user injections highlighted. Similar to Claude Code's terminal rendering but in the browser.

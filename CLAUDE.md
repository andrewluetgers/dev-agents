# Dev Agents — Claude Code Instructions

## Technology Decisions

These choices were made deliberately. Do NOT replace or swap them without explicit approval.

| Layer | Choice | Why |
|-------|--------|-----|
| Terminal (web) | **ghostty-web** | WASM-based terminal, Ghostty's parser compiled to WebAssembly. Drop-in xterm.js replacement with better rendering. |
| RPC | **oRPC** | End-to-end type-safe RPC with Zod validation. Procedures are composable, routers are nested objects. |
| Data fetching | **React Query via oRPC** | `createTanstackQueryUtils` gives type-safe query keys and cache management. Don't use raw fetch. |
| Validation | **Zod** | Schema validation for all RPC inputs. Shared between server and client. |
| Language | **TypeScript** | Strict mode everywhere. No `any` unless absolutely necessary. |
| UI framework | **React 19** | Latest React with server component support if needed later. |
| CSS | **Tailwind v4** | Utility-first CSS. Use CSS variables for theming (see `index.css`). |
| UI components | **shadcn/ui** (when added) | New York style, Radix primitives. Add via the ui package. |
| Build | **Vite** | Fast HMR for dashboard. Tailwind plugin via `@tailwindcss/vite`. |
| Monorepo | **Turborepo + pnpm** | Task runner for build/dev/lint/typecheck across packages. |
| Host server | **Hono + Node.js** | Lightweight, Web Standard API compatible. Runs via tsx. |
| Agent runtime | **Bun** | Inside Docker containers only. Fast startup for agent servers. |
| Markdown | **react-markdown + remark-gfm + rehype-highlight + mermaid** | Full GFM tables, syntax highlighting, diagram rendering. |
| PTY | **node-pty (prebuilt)** | Real pseudo-terminal for the orchestrator shell. `@homebridge/node-pty-prebuilt-multiarch`. |

## Architecture Principles

- **No agentic code on the host** — the host server (apps/server) is a dumb proxy. It MUST NOT execute agentic code, trigger Claude, run LLM-generated commands, or perform any AI-driven actions directly. All agentic work happens inside Docker containers. The server only: serves the dashboard, proxies HTTP/WebSocket, manages Docker containers, and stores configuration. If you find yourself writing code that runs Claude or executes AI-generated commands on the host — stop, that belongs in a container.
- **Orchestrator runs in a Docker container** — isolated from the host filesystem, only sees `~/dev-agents/`
- **Agents get their own clones** — never bind-mount the host's working tree
- **No Docker socket for project agents** — only the orchestrator container gets Docker socket access. Project agents cannot manage containers or escape their sandbox.
- **Stream-json + MCP** — dual protocol for observability and permission relay
- **Container is the sandbox** — agents use `--dangerously-skip-permissions` because the container is the boundary
- **Auth from Keychain** — SSO keys extracted fresh from macOS Keychain at spawn time
- **Push, not poll** — agents push events to orchestrator, orchestrator pushes to dashboard via WebSocket

## Project Structure

```
apps/server      — Host API server (Node.js + Hono)
apps/web         — Dashboard SPA (React + Vite)
packages/rpc     — oRPC router + procedures
packages/shared  — Shared TypeScript types
image/           — Docker image (agent server + Dockerfile)
scripts/         — Orchestrator startup scripts
```

## Development

### Running the servers

```bash
pnpm dev                                # Start server + dashboard (via turbo)
pnpm --filter @dev-agents/server dev    # Server only (:8788)
pnpm --filter @dev-agents/web dev       # Dashboard only (:5174)
docker build -t dev-agent:latest --build-arg AGENT_UID=$(id -u) ./image  # Rebuild agent image
```

The host server (:8788) starts the orchestrator Docker container automatically. The dashboard (:5174) proxies API calls to the server.

### Working on dev-agents itself

**Do NOT develop this project through the orchestrator.** The orchestrator runs inside a Docker container that depends on the host server. Restarting the server kills the orchestrator's connection. This is a recursive dependency — you can't fix the system from inside the system.

Work on this project directly in Claude Code on the host:
```bash
cd ~/dev/dev-agents
claude
```

The orchestrator is for managing OTHER projects' agents, not for developing itself.

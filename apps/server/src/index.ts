import { Hono } from "hono";
import { cors } from "hono/cors";
import { serveStatic } from "hono/bun";
import type { AgentInfo, AgentEvent } from "@dev-agents/shared";
import { agentsRouter } from "./routes/agents.js";
import { projectsRouter } from "./routes/projects.js";

const PORT = parseInt(process.env.PORT || "8788", 10);

const app = new Hono();

app.use("*", cors());

// --- Agent registry (in-memory, populated by push events + discovery) ---

export const agents = new Map<string, AgentInfo>();

// --- API routes ---

app.route("/api/agents", agentsRouter);
app.route("/api/projects", projectsRouter);

// --- Push event receiver (agents POST here) ---

app.post("/api/events", async (c) => {
  const body = await c.req.json<AgentEvent>();
  const { type, agent, content, port, channelPort } = body;

  // Update or register agent
  if (agent && agent !== "unknown") {
    const existing = agents.get(agent);
    if (existing) {
      existing.lastSeen = new Date().toISOString();
      if (type === "status") existing.status = content;
    } else {
      // Auto-discover ports
      let hostPort = port || 0;
      let chanPort = channelPort || 0;
      if (!hostPort) {
        try {
          const proc = Bun.spawnSync(["docker", "port", `dev-${agent}`, "9111"]);
          const match = proc.stdout.toString().match(/:(\d+)/);
          if (match) hostPort = parseInt(match[1], 10);
        } catch {}
      }
      if (!chanPort) {
        try {
          const proc = Bun.spawnSync(["docker", "port", `dev-${agent}`, "9222"]);
          const match = proc.stdout.toString().match(/:(\d+)/);
          if (match) chanPort = parseInt(match[1], 10);
        } catch {}
      }
      agents.set(agent, {
        id: agent,
        containerId: "external",
        hostPort,
        channelPort: chanPort,
        homeDir: `${process.env.HOME}/dev-agents/${agent}`,
        project: null,
        status: content || "registered",
        lastSeen: new Date().toISOString(),
      });
    }
  }

  // Broadcast to connected WebSocket clients
  broadcastEvent(body);

  return c.json({ status: "delivered" });
});

// --- WebSocket for live events ---

const wsClients = new Set<{ send: (data: string) => void }>();

function broadcastEvent(event: AgentEvent) {
  const data = JSON.stringify(event);
  for (const ws of wsClients) {
    try {
      ws.send(data);
    } catch {
      wsClients.delete(ws);
    }
  }
}

// Bun WebSocket upgrade
app.get("/api/ws", (c) => {
  const upgraded = Bun.upgrade(c.req.raw, {
    data: {},
  });
  if (!upgraded) {
    return c.text("WebSocket upgrade failed", 400);
  }
  return new Response(null, { status: 101 });
});

// --- Serve dashboard SPA in production ---

app.use("/*", serveStatic({ root: "../web/dist" }));
app.get("/*", serveStatic({ path: "../web/dist/index.html" }));

// --- Start ---

const server = Bun.serve({
  port: PORT,
  fetch: app.fetch,
  websocket: {
    open(ws) {
      wsClients.add(ws);
    },
    message() {},
    close(ws) {
      wsClients.delete(ws);
    },
  },
});

console.log(`Dev Agents server running on :${PORT}`);

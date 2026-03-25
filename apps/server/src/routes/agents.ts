import { Hono } from "hono";
import { agents } from "../index.js";

export const agentsRouter = new Hono();

// List all agents
agentsRouter.get("/", (c) => {
  return c.json([...agents.values()]);
});

// Agent detail
agentsRouter.get("/:id", (c) => {
  const info = agents.get(c.req.param("id"));
  if (!info) return c.json({ error: "Agent not found" }, 404);
  return c.json(info);
});

// Agent health (proxied from container)
agentsRouter.get("/:id/health", async (c) => {
  const info = agents.get(c.req.param("id"));
  if (!info) return c.json({ error: "Agent not found" }, 404);
  try {
    const resp = await fetch(`http://localhost:${info.hostPort}/health`);
    return c.json(await resp.json());
  } catch (err: any) {
    return c.json({ error: err.message }, 502);
  }
});

// Agent status (reads STATUS.md)
agentsRouter.get("/:id/status", async (c) => {
  const info = agents.get(c.req.param("id"));
  if (!info) return c.json({ error: "Agent not found" }, 404);
  try {
    const resp = await fetch(`http://localhost:${info.hostPort}/exec`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ command: "cat /home/agent/STATUS.md 2>/dev/null || echo 'No STATUS.md yet'" }),
    });
    const result = await resp.json();
    return c.json({ status: result.stdout || "No status" });
  } catch (err: any) {
    return c.json({ error: err.message }, 502);
  }
});

// Agent session log
agentsRouter.get("/:id/log", async (c) => {
  const info = agents.get(c.req.param("id"));
  if (!info) return c.json({ error: "Agent not found" }, 404);
  const lines = parseInt(c.req.query("lines") || "50", 10);
  try {
    const resp = await fetch(`http://localhost:${info.hostPort}/exec`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ command: `tail -${lines} /home/agent/claude-session.log 2>/dev/null` }),
    });
    const result = await resp.json();
    return c.json({ log: result.stdout || "" });
  } catch (err: any) {
    return c.json({ error: err.message }, 502);
  }
});

// Live stream (proxy SSE from agent container)
agentsRouter.get("/:id/stream", async (c) => {
  const info = agents.get(c.req.param("id"));
  if (!info) return c.json({ error: "Agent not found" }, 404);
  try {
    const resp = await fetch(`http://localhost:${info.hostPort}/stream`);
    return new Response(resp.body, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
      },
    });
  } catch (err: any) {
    return c.json({ error: err.message }, 502);
  }
});

// Send message to agent
agentsRouter.post("/:id/message", async (c) => {
  const info = agents.get(c.req.param("id"));
  if (!info) return c.json({ error: "Agent not found" }, 404);
  const body = await c.req.json();
  try {
    const resp = await fetch(`http://localhost:${info.channelPort}/message`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: body.content, from: "dashboard" }),
    });
    return c.json(await resp.json());
  } catch (err: any) {
    return c.json({ error: err.message }, 502);
  }
});

// Start Claude session
agentsRouter.post("/:id/start", async (c) => {
  const info = agents.get(c.req.param("id"));
  if (!info) return c.json({ error: "Agent not found" }, 404);
  const body = await c.req.json();
  try {
    const resp = await fetch(`http://localhost:${info.hostPort}/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: body.prompt }),
    });
    return c.json(await resp.json());
  } catch (err: any) {
    return c.json({ error: err.message }, 502);
  }
});

// Run command in agent
agentsRouter.post("/:id/exec", async (c) => {
  const info = agents.get(c.req.param("id"));
  if (!info) return c.json({ error: "Agent not found" }, 404);
  const body = await c.req.json();
  try {
    const resp = await fetch(`http://localhost:${info.hostPort}/exec`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return c.json(await resp.json());
  } catch (err: any) {
    return c.json({ error: err.message }, 502);
  }
});

// Permission verdict
agentsRouter.post("/:id/permission", async (c) => {
  const info = agents.get(c.req.param("id"));
  if (!info) return c.json({ error: "Agent not found" }, 404);
  const body = await c.req.json();
  const port = info.channelPort || info.hostPort;
  try {
    const resp = await fetch(`http://localhost:${port}/permission`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return c.json(await resp.json());
  } catch (err: any) {
    return c.json({ error: err.message }, 502);
  }
});

// Stop agent
agentsRouter.delete("/:id", async (c) => {
  const id = c.req.param("id");
  try {
    const proc = Bun.spawnSync(["docker", "rm", "-f", `dev-${id}`]);
    agents.delete(id);
    return c.json({ status: "stopped", agent: id });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

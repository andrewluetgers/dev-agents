import { os } from "@orpc/server";
import { z } from "zod";
import type { Context } from "../context.js";

const proc = os.$context<Context>();

export const list = proc.handler(async ({ context }) => {
  return [...context.agents.values()];
});

export const get = proc
  .input(z.object({ id: z.string() }))
  .handler(async ({ input, context }) => {
    const agent = context.agents.get(input.id);
    if (!agent) throw new Error("Agent not found");
    return agent;
  });

export const health = proc
  .input(z.object({ id: z.string() }))
  .handler(async ({ input, context }) => {
    const agent = context.agents.get(input.id);
    if (!agent) throw new Error("Agent not found");
    const resp = await fetch(`http://localhost:${agent.hostPort}/health`);
    return resp.json();
  });

export const status = proc
  .input(z.object({ id: z.string() }))
  .handler(async ({ input, context }) => {
    const agent = context.agents.get(input.id);
    if (!agent) throw new Error("Agent not found");
    const resp = await fetch(`http://localhost:${agent.hostPort}/exec`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ command: "cat /home/agent/STATUS.md 2>/dev/null || echo 'No STATUS.md yet'" }),
    });
    const result = await resp.json() as { stdout: string };
    return { markdown: result.stdout || "No status" };
  });

export const log = proc
  .input(z.object({ id: z.string(), lines: z.number().min(1).max(500).default(50) }))
  .handler(async ({ input, context }) => {
    const agent = context.agents.get(input.id);
    if (!agent) throw new Error("Agent not found");
    const resp = await fetch(`http://localhost:${agent.hostPort}/exec`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ command: `tail -${input.lines} /home/agent/claude-session.log 2>/dev/null` }),
    });
    const result = await resp.json() as { stdout: string };
    return { log: result.stdout || "" };
  });

export const message = proc
  .input(z.object({ id: z.string(), content: z.string() }))
  .handler(async ({ input, context }) => {
    const agent = context.agents.get(input.id);
    if (!agent) throw new Error("Agent not found");
    const resp = await fetch(`http://localhost:${agent.channelPort}/message`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: input.content, from: "dashboard" }),
    });
    return resp.json();
  });

export const exec = proc
  .input(z.object({ id: z.string(), command: z.string(), timeout: z.number().optional() }))
  .handler(async ({ input, context }) => {
    const agent = context.agents.get(input.id);
    if (!agent) throw new Error("Agent not found");
    const resp = await fetch(`http://localhost:${agent.hostPort}/exec`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ command: input.command, timeout: input.timeout }),
    });
    return resp.json();
  });

export const start = proc
  .input(z.object({ id: z.string(), prompt: z.string().optional() }))
  .handler(async ({ input, context }) => {
    const agent = context.agents.get(input.id);
    if (!agent) throw new Error("Agent not found");
    const resp = await fetch(`http://localhost:${agent.hostPort}/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: input.prompt }),
    });
    return resp.json();
  });

export const spawn = proc
  .input(z.object({
    name: z.string(),
    project: z.string().optional(),
    task: z.string().optional(),
  }))
  .handler(async ({ input, context }) => {
    // Spawn via Docker — this runs on the host server
    const args = [
      "docker", "run", "-d",
      "--name", `dev-${input.name}`,
      "-p", "0:9111", "-p", "0:9222",
      "--add-host", "host.docker.internal:host-gateway",
      "--group-add", "0",
      "-v", "/var/run/docker.sock:/var/run/docker.sock",
      "-v", `${process.env.HOME}/dev-agents/${input.name}:/home/agent`,
      "--memory", "8g",
      "-e", `AGENT_ID=${input.name}`,
      "-e", `CHANNEL_URL=http://host.docker.internal:8788/api/events`,
      "-e", "NODE_ENV=development",
      "-e", "CI=true",
    ];

    if (process.env.ANTHROPIC_API_KEY) {
      args.push("-e", `ANTHROPIC_API_KEY=${process.env.ANTHROPIC_API_KEY}`);
    }

    args.push("dev-agent:latest");

    const proc2 = Bun.spawnSync(args);
    if (proc2.exitCode !== 0) {
      throw new Error(`Docker spawn failed: ${proc2.stderr.toString()}`);
    }

    const containerId = proc2.stdout.toString().trim().slice(0, 12);

    // Wait and get ports
    await new Promise(r => setTimeout(r, 2000));
    const portProc = Bun.spawnSync(["docker", "port", `dev-${input.name}`, "9111"]);
    const hostPort = parseInt(portProc.stdout.toString().match(/:(\d+)/)?.[1] || "0", 10);
    const chanProc = Bun.spawnSync(["docker", "port", `dev-${input.name}`, "9222"]);
    const channelPort = parseInt(chanProc.stdout.toString().match(/:(\d+)/)?.[1] || "0", 10);

    const agent = {
      id: input.name,
      containerId,
      hostPort,
      channelPort,
      homeDir: `${process.env.HOME}/dev-agents/${input.name}`,
      project: input.project || null,
      status: "starting",
      lastSeen: new Date().toISOString(),
      task: input.task,
    };
    context.agents.set(input.name, agent);

    // Start Claude with task after server is ready
    if (input.task && hostPort) {
      setTimeout(async () => {
        try {
          await fetch(`http://localhost:${hostPort}/start`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ prompt: input.task }),
          });
        } catch {}
      }, 3000);
    }

    return agent;
  });

export const stop = proc
  .input(z.object({ id: z.string() }))
  .handler(async ({ input, context }) => {
    Bun.spawnSync(["docker", "rm", "-f", `dev-${input.id}`]);
    context.agents.delete(input.id);
    return { status: "stopped", agent: input.id };
  });

export const permission = proc
  .input(z.object({
    id: z.string(),
    request_id: z.string(),
    verdict: z.enum(["allow", "deny"]),
  }))
  .handler(async ({ input, context }) => {
    const agent = context.agents.get(input.id);
    if (!agent) throw new Error("Agent not found");
    const port = agent.channelPort || agent.hostPort;
    const resp = await fetch(`http://localhost:${port}/permission`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ request_id: input.request_id, verdict: input.verdict }),
    });
    return resp.json();
  });

export const agentRouter = {
  list,
  get,
  health,
  status,
  log,
  message,
  exec,
  start,
  spawn,
  stop,
  permission,
};

// Agent container command server
// Zero dependencies — uses only Node.js built-ins
//
// POST /exec     { "command": "pnpm test" }           → runs command, returns output
// POST /exec     { "command": "...", "cwd": "..." }   → runs in specific directory
// GET  /health                                        → { "status": "ok" }
//
// Push system (container → host Claude Code via webhook channel):
// POST /notify   { "type": "result", "content": "..." }  → pushes event to channel
// POST /respond  { "response": "..." }                    → deliver reply to waiting prompt
//
// The agent identifies itself via AGENT_ID env var and pushes events to
// CHANNEL_URL (the host's webhook channel) instead of waiting to be polled.

import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";

const PORT = parseInt(process.env.AGENT_PORT || "9111", 10);
const WORKSPACE = process.env.WORKSPACE || "/home/agent/workspace";
const AGENT_ID = process.env.AGENT_ID || "agent-1";
const CHANNEL_URL = process.env.CHANNEL_URL || "http://host.docker.internal:8788";

// Pending reply: resolve function for the current prompt waiting for a response
let pendingReply = null;

// --- Push to channel ---

async function pushToChannel(type, content) {
  try {
    await fetch(CHANNEL_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type, agent: AGENT_ID, content, port: PORT }),
    });
  } catch (err) {
    console.error(`Failed to push to channel: ${err.message}`);
  }
}

// --- Command execution ---

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString()));
    req.on("error", reject);
  });
}

function execCommand(command, cwd, timeout) {
  return new Promise((resolve) => {
    const proc = spawn("bash", ["-lc", command], {
      cwd: cwd || WORKSPACE,
      env: { ...process.env, TERM: "dumb" },
      timeout: timeout || 120_000,
    });

    const stdout = [];
    const stderr = [];

    proc.stdout.on("data", (d) => stdout.push(d));
    proc.stderr.on("data", (d) => stderr.push(d));

    proc.on("close", (code) => {
      resolve({
        exitCode: code,
        stdout: Buffer.concat(stdout).toString(),
        stderr: Buffer.concat(stderr).toString(),
      });
    });

    proc.on("error", (err) => {
      resolve({
        exitCode: 1,
        stdout: "",
        stderr: err.message,
      });
    });
  });
}

// --- HTTP server ---

const server = createServer(async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    return res.end();
  }

  // Health check
  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(
      JSON.stringify({
        status: "ok",
        agent: AGENT_ID,
        workspace: WORKSPACE,
        channel: CHANNEL_URL,
      })
    );
  }

  // Execute a command (called by the manager via the dispatch tool)
  if (req.method === "POST" && req.url === "/exec") {
    try {
      const body = JSON.parse(await readBody(req));
      if (!body.command) {
        res.writeHead(400, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ error: "command is required" }));
      }

      const result = await execCommand(body.command, body.cwd, body.timeout);
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify(result));
    } catch (err) {
      res.writeHead(400, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ error: err.message }));
    }
  }

  // Push a notification to the channel (called from inside the container)
  if (req.method === "POST" && req.url === "/notify") {
    try {
      const body = JSON.parse(await readBody(req));
      await pushToChannel(body.type || "message", body.content || "");
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ status: "pushed" }));
    } catch (err) {
      res.writeHead(400, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ error: err.message }));
    }
  }

  // Receive a reply from the manager (called by the channel's reply tool)
  if (req.method === "POST" && req.url === "/respond") {
    try {
      const body = JSON.parse(await readBody(req));
      if (pendingReply) {
        pendingReply(body.response);
        pendingReply = null;
        res.writeHead(200, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ status: "delivered" }));
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ status: "no_pending_prompt" }));
    } catch (err) {
      res.writeHead(400, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ error: err.message }));
    }
  }

  // Ask the manager a question (called from inside the container)
  // Pushes a prompt event to the channel, then waits for /respond
  if (req.method === "POST" && req.url === "/ask") {
    try {
      const body = JSON.parse(await readBody(req));
      if (!body.prompt) {
        res.writeHead(400, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ error: "prompt is required" }));
      }

      // Push prompt to channel
      await pushToChannel("prompt", body.prompt);

      // Wait for the manager to reply via /respond
      const response = await new Promise((resolve) => {
        pendingReply = resolve;
        // Timeout after 5 minutes
        setTimeout(() => {
          if (pendingReply === resolve) {
            pendingReply = null;
            resolve("(timeout: no response from manager)");
          }
        }, 300_000);
      });

      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ response }));
    } catch (err) {
      res.writeHead(400, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ error: err.message }));
    }
  }

  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "not found" }));
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Agent ${AGENT_ID} listening on :${PORT}`);
  console.log(`Workspace: ${WORKSPACE}`);
  console.log(`Channel: ${CHANNEL_URL}`);

  // Announce ourselves to the channel
  pushToChannel("status", `Agent ${AGENT_ID} ready`);
});

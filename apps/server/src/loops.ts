import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { Loop, AgentInfo } from "@dev-agents/shared";

const LOOPS_FILE = join(
  process.env.HOME || "/tmp",
  "dev-agents",
  "orchestrator",
  "loops.json"
);

const loops = new Map<string, Loop>();
const intervals = new Map<string, ReturnType<typeof setInterval>>();

// --- Persistence ---

function save() {
  try {
    const data = [...loops.values()];
    writeFileSync(LOOPS_FILE, JSON.stringify(data, null, 2));
  } catch {}
}

function load() {
  try {
    if (!existsSync(LOOPS_FILE)) return;
    const data = JSON.parse(readFileSync(LOOPS_FILE, "utf-8")) as Loop[];
    for (const loop of data) {
      // Restore but paused — user decides what to resume
      loop.enabled = false;
      loops.set(loop.id, loop);
    }
    if (data.length > 0) {
      console.log(`Restored ${data.length} loop(s) from disk (all paused — use dashboard to resume)`);
    }
  } catch {}
}

// Load on startup
load();

// --- Exports ---

export function getLoops(): Map<string, Loop> {
  return loops;
}

export function startLoop(loop: Loop, agents: Map<string, AgentInfo>) {
  stopLoop(loop.id);

  if (!loop.enabled) return;

  const tick = async () => {
    const current = loops.get(loop.id);
    if (!current || !current.enabled) {
      stopLoop(loop.id);
      return;
    }

    const agent = agents.get(current.agentId);
    if (!agent) {
      current.lastResult = "Agent not found";
      current.lastExitCode = 1;
      current.lastRun = new Date().toISOString();
      save();
      return;
    }

    try {
      if (current.type === "exec") {
        const resp = await fetch(`http://localhost:${agent.hostPort}/exec`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ command: current.command }),
        });
        const result = (await resp.json()) as {
          stdout?: string;
          stderr?: string;
          exitCode?: number;
        };
        current.lastResult = (result.stdout || result.stderr || "").slice(0, 2000);
        current.lastExitCode = result.exitCode ?? 0;
      } else {
        const resp = await fetch(
          `http://localhost:${agent.channelPort}/message`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ content: current.command, from: "loop" }),
          }
        );
        const result = (await resp.json()) as { status?: string };
        current.lastResult = JSON.stringify(result).slice(0, 2000);
        current.lastExitCode = 0;
      }
    } catch (err: any) {
      current.lastResult = err.message || "Unknown error";
      current.lastExitCode = 1;
    }

    current.lastRun = new Date().toISOString();
    save();
  };

  tick();
  const intervalId = setInterval(tick, loop.intervalMs);
  intervals.set(loop.id, intervalId);
}

export function stopLoop(id: string) {
  const intervalId = intervals.get(id);
  if (intervalId) {
    clearInterval(intervalId);
    intervals.delete(id);
  }
}

export function syncLoops(agents: Map<string, AgentInfo>) {
  for (const id of intervals.keys()) {
    if (!loops.has(id)) {
      stopLoop(id);
    }
  }

  for (const loop of loops.values()) {
    if (loop.enabled) {
      if (!intervals.has(loop.id)) {
        startLoop(loop, agents);
      }
    } else {
      stopLoop(loop.id);
    }
  }
}

// Save whenever a loop is created/updated/deleted (called from RPC)
export function saveLoops() {
  save();
}

import type { Loop, AgentInfo } from "@dev-agents/shared";

const loops = new Map<string, Loop>();
const intervals = new Map<string, ReturnType<typeof setInterval>>();

export function getLoops(): Map<string, Loop> {
  return loops;
}

export function startLoop(loop: Loop, agents: Map<string, AgentInfo>) {
  // Clear existing interval if any
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
        current.lastResult = (result.stdout || result.stderr || "").slice(
          0,
          2000
        );
        current.lastExitCode = result.exitCode ?? 0;
      } else {
        const resp = await fetch(
          `http://localhost:${agent.channelPort}/message`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              content: current.command,
              from: "loop",
            }),
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
  };

  // Run first tick immediately
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
  // Stop intervals for deleted loops
  for (const id of intervals.keys()) {
    if (!loops.has(id)) {
      stopLoop(id);
    }
  }

  // Start intervals for all enabled loops, stop disabled ones
  for (const loop of loops.values()) {
    if (loop.enabled) {
      // Only start if not already running
      if (!intervals.has(loop.id)) {
        startLoop(loop, agents);
      }
    } else {
      stopLoop(loop.id);
    }
  }
}

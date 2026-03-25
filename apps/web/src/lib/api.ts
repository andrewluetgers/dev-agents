import type { AgentInfo } from "@dev-agents/shared";

const BASE = "/api";

export async function fetchAgents(): Promise<AgentInfo[]> {
  const res = await fetch(`${BASE}/agents`);
  return res.json();
}

export async function fetchAgentHealth(id: string) {
  const res = await fetch(`${BASE}/agents/${id}/health`);
  return res.json();
}

export async function fetchAgentStatus(id: string): Promise<{ status: string }> {
  const res = await fetch(`${BASE}/agents/${id}/status`);
  return res.json();
}

export async function fetchAgentLog(id: string, lines = 50): Promise<{ log: string }> {
  const res = await fetch(`${BASE}/agents/${id}/log?lines=${lines}`);
  return res.json();
}

export async function sendMessage(id: string, content: string) {
  const res = await fetch(`${BASE}/agents/${id}/message`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content }),
  });
  return res.json();
}

export async function execCommand(id: string, command: string) {
  const res = await fetch(`${BASE}/agents/${id}/exec`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ command }),
  });
  return res.json();
}

export async function spawnAgent(name: string, project: string, task?: string) {
  const res = await fetch(`${BASE}/agents`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, project, task }),
  });
  return res.json();
}

export async function stopAgent(id: string) {
  const res = await fetch(`${BASE}/agents/${id}`, { method: "DELETE" });
  return res.json();
}

export async function fetchProjects() {
  const res = await fetch(`${BASE}/projects`);
  return res.json();
}

export function createAgentStream(id: string): EventSource {
  return new EventSource(`${BASE}/agents/${id}/stream`);
}

export function createWebSocket(): WebSocket {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return new WebSocket(`${protocol}//${window.location.host}/api/ws`);
}

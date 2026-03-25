// Re-export RPC client for convenience
export { rpc, orpc } from "./rpc-client.js";

// SSE stream (not part of RPC — raw EventSource)
export function createAgentStream(id: string): EventSource {
  return new EventSource(`/api/agents/${id}/stream`);
}

// WebSocket for live events
export function createWebSocket(): WebSocket {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return new WebSocket(`${protocol}//${window.location.host}/api/ws`);
}

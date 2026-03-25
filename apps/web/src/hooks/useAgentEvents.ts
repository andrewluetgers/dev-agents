import { useEffect, useRef, useState, useCallback } from "react";
import { createWebSocket } from "@/lib/api";
import type { AgentEvent } from "@dev-agents/shared";

interface AgentEventState {
  events: AgentEvent[];
  unreadCount: number;
  markRead: () => void;
}

// Global event store — persists across component mounts
const globalEvents = new Map<string, AgentEvent[]>();
const globalUnread = new Map<string, number>();
const listeners = new Set<() => void>();

function notify() {
  for (const fn of listeners) fn();
}

// Connect WebSocket once
let ws: WebSocket | null = null;
let wsConnected = false;

function ensureWs() {
  if (ws && wsConnected) return;
  try {
    ws = createWebSocket();
    ws.onopen = () => { wsConnected = true; };
    ws.onmessage = (e) => {
      try {
        const event = JSON.parse(e.data) as AgentEvent;
        if (!event.agent) return;
        const existing = globalEvents.get(event.agent) || [];
        existing.push(event);
        if (existing.length > 200) existing.splice(0, existing.length - 200);
        globalEvents.set(event.agent, existing);
        globalUnread.set(event.agent, (globalUnread.get(event.agent) || 0) + 1);
        notify();
      } catch {}
    };
    ws.onclose = () => {
      wsConnected = false;
      setTimeout(ensureWs, 3000);
    };
    ws.onerror = () => {
      wsConnected = false;
    };
  } catch {}
}

export function useAgentEvents(agentId: string): AgentEventState {
  const [, forceUpdate] = useState(0);

  useEffect(() => {
    ensureWs();
    const listener = () => forceUpdate((n) => n + 1);
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  }, []);

  const markRead = useCallback(() => {
    globalUnread.set(agentId, 0);
    notify();
  }, [agentId]);

  return {
    events: globalEvents.get(agentId) || [],
    unreadCount: globalUnread.get(agentId) || 0,
    markRead,
  };
}

export function useGlobalUnread(): Map<string, number> {
  const [, forceUpdate] = useState(0);
  useEffect(() => {
    const listener = () => forceUpdate((n) => n + 1);
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  }, []);
  return globalUnread;
}

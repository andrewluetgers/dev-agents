import { useEffect, useRef, useState } from "react";
import { createWebSocket } from "@/lib/api";
import type { AgentEvent } from "@dev-agents/shared";
import { cn } from "@/lib/utils";
import { MarkdownRenderer } from "./MarkdownRenderer";
import { Bot, AlertTriangle, CheckCircle, XCircle, MessageSquare, Shield, Info } from "lucide-react";

export function OrchestratorView() {
  const [events, setEvents] = useState<(AgentEvent & { timestamp: string })[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let ws: WebSocket;
    let reconnectTimer: ReturnType<typeof setTimeout>;

    function connect() {
      try {
        ws = createWebSocket();
        ws.onmessage = (e) => {
          try {
            const event = JSON.parse(e.data) as AgentEvent;
            setEvents((prev) => [
              ...prev.slice(-300),
              { ...event, timestamp: new Date().toISOString() },
            ]);
          } catch {}
        };
        ws.onclose = () => {
          reconnectTimer = setTimeout(connect, 3000);
        };
      } catch {
        reconnectTimer = setTimeout(connect, 3000);
      }
    }

    connect();
    return () => {
      ws?.close();
      clearTimeout(reconnectTimer);
    };
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [events]);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="p-3 border-b border-[var(--border)]">
        <h2 className="font-semibold">Orchestrator</h2>
        <div className="text-xs text-[var(--muted-foreground)] mt-0.5">
          Live event stream from all agents
        </div>
      </div>

      {/* Event stream */}
      <div className="flex-1 overflow-y-auto p-4 space-y-1">
        {events.length === 0 && (
          <div className="text-[var(--muted-foreground)] text-xs text-center py-8">
            Waiting for agent events...
          </div>
        )}
        {events.map((event, i) => (
          <EventLine key={i} event={event} />
        ))}
        <div ref={scrollRef} />
      </div>
    </div>
  );
}

function EventLine({ event }: { event: AgentEvent & { timestamp: string } }) {
  const time = new Date(event.timestamp).toLocaleTimeString();
  const iconMap: Record<string, typeof Bot> = {
    status: Info,
    result: CheckCircle,
    error: XCircle,
    prompt: MessageSquare,
    request: Bot,
    permission_request: Shield,
  };
  const colorMap: Record<string, string> = {
    status: "border-[var(--muted-foreground)]",
    result: "border-[var(--success)]",
    error: "border-[var(--error)]",
    prompt: "border-[var(--warning)]",
    request: "border-[var(--accent)]",
    permission_request: "border-[var(--warning)]",
  };

  const Icon = iconMap[event.type] || Info;
  const borderColor = colorMap[event.type] || "border-[var(--muted-foreground)]";

  return (
    <div className={cn("pl-2 border-l-2 py-1 text-xs", borderColor)}>
      <div className="flex items-start gap-1.5">
        <Icon size={11} className="mt-0.5 shrink-0 opacity-70" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-[var(--accent)]">{event.agent}</span>
            <span className="text-[var(--muted-foreground)]">{event.type}</span>
            <span className="text-[var(--muted-foreground)] ml-auto opacity-50">{time}</span>
          </div>
          {event.content && (
            <div className="mt-0.5 text-[var(--foreground)]">
              {event.content}
            </div>
          )}
          {event.permission && (
            <div className="mt-1 p-2 bg-[var(--muted)] border border-[var(--border)] rounded text-xs">
              <div><strong>Tool:</strong> {event.permission.tool_name}</div>
              <div><strong>Description:</strong> {event.permission.description}</div>
              {event.permission.input_preview && (
                <div className="mt-1 text-[var(--muted-foreground)] truncate">
                  {event.permission.input_preview}
                </div>
              )}
              <div className="mt-2 flex gap-2">
                <button className="px-3 py-1 bg-[var(--success)] text-white rounded text-xs hover:opacity-90">
                  Approve
                </button>
                <button className="px-3 py-1 bg-[var(--error)] text-white rounded text-xs hover:opacity-90">
                  Deny
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

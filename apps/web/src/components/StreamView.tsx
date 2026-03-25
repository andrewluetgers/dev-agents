import { useEffect, useRef, useState } from "react";
import { createAgentStream } from "@/lib/api";

interface StreamEvent {
  type: string;
  timestamp?: string;
  message?: {
    content?: Array<{
      type: string;
      text?: string;
      name?: string;
      input?: Record<string, unknown>;
    }>;
  };
  [key: string]: unknown;
}

export function StreamView({ agentId }: { agentId: string }) {
  const [events, setEvents] = useState<StreamEvent[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const source = createAgentStream(agentId);

    source.onmessage = (e) => {
      try {
        const event = JSON.parse(e.data) as StreamEvent;
        setEvents((prev) => [...prev.slice(-200), event]); // Keep last 200
      } catch {}
    };

    source.onerror = () => {
      // Will auto-reconnect
    };

    return () => source.close();
  }, [agentId]);

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [events]);

  return (
    <div className="space-y-1 text-xs font-mono">
      {events.length === 0 && (
        <div className="text-[var(--muted-foreground)]">
          Waiting for stream data...
        </div>
      )}
      {events.map((event, i) => (
        <StreamLine key={i} event={event} />
      ))}
      <div ref={scrollRef} />
    </div>
  );
}

function StreamLine({ event }: { event: StreamEvent }) {
  if (event.type === "assistant" && event.message?.content) {
    return (
      <>
        {event.message.content.map((block, i) => {
          if (block.type === "text" && block.text) {
            return (
              <div key={i} className="text-[var(--foreground)] pl-2 border-l-2 border-[var(--accent)]">
                {block.text.slice(0, 500)}
              </div>
            );
          }
          if (block.type === "tool_use") {
            return (
              <div key={i} className="text-[var(--warning)] pl-2 border-l-2 border-[var(--warning)]">
                <span className="opacity-60">tool</span> {block.name}
                {block.input && (
                  <span className="text-[var(--muted-foreground)]">
                    {" "}
                    {JSON.stringify(block.input).slice(0, 120)}
                  </span>
                )}
              </div>
            );
          }
          return null;
        })}
      </>
    );
  }

  if (event.type === "result") {
    const result = event as StreamEvent & { subtype?: string; result?: string };
    return (
      <div className={`pl-2 border-l-2 ${result.subtype === "success" ? "border-[var(--success)] text-[var(--success)]" : "border-[var(--error)] text-[var(--error)]"}`}>
        {result.subtype}: {(result.result || "").slice(0, 200)}
      </div>
    );
  }

  if (event.type === "server") {
    return (
      <div className="text-[var(--muted-foreground)] opacity-50">
        [{(event as StreamEvent & { event?: string }).event}]
      </div>
    );
  }

  return null;
}

import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { rpc } from "@/lib/api";
import { cn } from "@/lib/utils";
import { MessageInput } from "./MessageInput";
import { StreamView } from "./StreamView";
import { LogView } from "./LogView";
import { FileText, Radio, ScrollText } from "lucide-react";

type Tab = "status" | "stream" | "log";

export function AgentDetail({ agentId }: { agentId: string }) {
  const [tab, setTab] = useState<Tab>("status");

  const { data: health } = useQuery({
    queryKey: ["agent-health", agentId],
    queryFn: () => rpc.agent.health({ id: agentId }),
    refetchInterval: 3000,
  });

  const { data: statusData } = useQuery({
    queryKey: ["agent-status", agentId],
    queryFn: () => rpc.agent.status({ id: agentId }),
    refetchInterval: 5000,
    enabled: tab === "status",
  });

  const { data: logData } = useQuery({
    queryKey: ["agent-log", agentId],
    queryFn: () => rpc.agent.log({ id: agentId, lines: 100 }),
    refetchInterval: 3000,
    enabled: tab === "log",
  });

  const session = health?.session;

  const tabs: { id: Tab; label: string; icon: typeof FileText }[] = [
    { id: "status", label: "Status", icon: FileText },
    { id: "stream", label: "Stream", icon: Radio },
    { id: "log", label: "Log", icon: ScrollText },
  ];

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="p-3 border-b border-[var(--border)] flex items-center justify-between">
        <div>
          <h2 className="font-semibold">{agentId}</h2>
          {session && (
            <div className="text-xs text-[var(--muted-foreground)] mt-0.5">
              {session.status}
              {session.currentTool && ` — ${session.currentTool}`}
              {session.turns > 0 && ` — ${session.turns} turns`}
            </div>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-[var(--border)]">
        {tabs.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={cn(
              "flex items-center gap-1.5 px-4 py-2 text-xs transition-colors",
              tab === id
                ? "border-b-2 border-[var(--accent)] text-[var(--foreground)]"
                : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
            )}
          >
            <Icon size={12} />
            {label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4">
        {tab === "status" && (
          <pre className="whitespace-pre-wrap text-sm leading-relaxed">
            {statusData?.markdown || "Loading..."}
          </pre>
        )}
        {tab === "stream" && <StreamView agentId={agentId} />}
        {tab === "log" && <LogView log={logData?.log || ""} />}
      </div>

      <MessageInput agentId={agentId} />
    </div>
  );
}

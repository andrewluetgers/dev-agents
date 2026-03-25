import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { rpc } from "@/lib/api";
import { cn } from "@/lib/utils";
import { MarkdownRenderer } from "./MarkdownRenderer";
import { MessageInput } from "./MessageInput";
import { LogView } from "./LogView";
import { useAgentEvents } from "@/hooks/useAgentEvents";
import { FileText, ScrollText, GitBranch, RefreshCw, BookOpen, Terminal } from "lucide-react";
import { LoopsView } from "./LoopsView";
import { ContextView } from "./ContextView";
import { TerminalView } from "./TerminalView";

type Tab = "terminal" | "status" | "log" | "changes" | "context" | "loops";

export function AgentDetail({ agentId }: { agentId: string }) {
  const [tab, setTab] = useState<Tab>("log");
  const { unreadCount, markRead } = useAgentEvents(agentId);

  // Track unread per tab
  const [logLastSeen, setLogLastSeen] = useState(0);
  const [statusLastSeen, setStatusLastSeen] = useState(0);

  const { data: health } = useQuery({
    queryKey: ["agent-health", agentId],
    queryFn: () => rpc.agent.health({ id: agentId }),
    refetchInterval: 3000,
  });

  const { data: statusData } = useQuery({
    queryKey: ["agent-status", agentId],
    queryFn: () => rpc.agent.status({ id: agentId }),
    refetchInterval: 5000,
  });

  const { data: logData, dataUpdatedAt: logUpdatedAt } = useQuery({
    queryKey: ["agent-log", agentId],
    queryFn: () => rpc.agent.log({ id: agentId, lines: 200 }),
    refetchInterval: 3000,
  });

  const { data: changesData } = useQuery({
    queryKey: ["agent-changes", agentId],
    queryFn: () => rpc.agent.exec({ id: agentId, command: "cd /home/agent/workspace && git diff --stat HEAD 2>/dev/null && echo '---DIFF---' && git diff HEAD 2>/dev/null | head -200" }),
    refetchInterval: 10000,
    enabled: tab === "changes",
  });

  // Mark tab as read when viewing
  useEffect(() => {
    if (tab === "log") setLogLastSeen(logUpdatedAt || 0);
  }, [tab, logUpdatedAt]);

  useEffect(() => {
    if (tab === "status") setStatusLastSeen(Date.now());
  }, [tab, statusData]);

  const session = health?.session;
  const logLines = (logData?.log || "").split("\n").filter(Boolean).length;
  const logHasNew = tab !== "log" && logUpdatedAt && logUpdatedAt > logLastSeen;
  const statusChanged = tab !== "status" && statusData?.markdown && statusData.markdown !== "No status";

  const tabs: { id: Tab; label: string; icon: typeof FileText; badge?: number | boolean }[] = [
    { id: "terminal", label: "Terminal", icon: Terminal },
    { id: "status", label: "Status", icon: FileText, badge: statusChanged ? true : false },
    { id: "log", label: "Log", icon: ScrollText, badge: logHasNew ? unreadCount : 0 },
    { id: "changes", label: "Changes", icon: GitBranch },
    { id: "context", label: "Docs", icon: BookOpen },
    { id: "loops", label: "Loops", icon: RefreshCw },
  ];

  // Parse changes output
  const changesStat = changesData?.stdout?.split("---DIFF---")[0] || "";
  const changesDiff = changesData?.stdout?.split("---DIFF---")[1] || "";

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="p-3 border-b border-[var(--border)]">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">{agentId}</h2>
          {session && (
            <div className="flex items-center gap-2">
              <span className={cn(
                "text-xs px-2 py-0.5 rounded",
                session.status === "running" || session.status === "tool_use" || session.status === "thinking"
                  ? "bg-[var(--accent)]/20 text-[var(--accent)]"
                  : session.status === "done"
                  ? "bg-[var(--success)]/20 text-[var(--success)]"
                  : session.status === "error"
                  ? "bg-[var(--error)]/20 text-[var(--error)]"
                  : "bg-[var(--muted)] text-[var(--muted-foreground)]"
              )}>
                {session.status}
              </span>
            </div>
          )}
        </div>
        {session && (
          <div className="text-xs text-[var(--muted-foreground)] mt-1">
            {session.currentTool && <span>Running: <strong>{session.currentTool}</strong></span>}
            {session.turns > 0 && <span className="ml-2">{session.turns} turns</span>}
          </div>
        )}
      </div>

      {/* Tabs with badges */}
      <div className="flex border-b border-[var(--border)]">
        {tabs.map(({ id, label, icon: Icon, badge }) => (
          <button
            key={id}
            onClick={() => {
              setTab(id);
              if (id === "log") markRead();
            }}
            className={cn(
              "flex items-center gap-1.5 px-4 py-2 text-xs transition-colors relative border-b-2",
              tab === id
                ? "border-[var(--accent)] text-[var(--foreground)]"
                : "border-transparent text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
            )}
          >
            <Icon size={12} />
            {label}
            {((typeof badge === "number" && badge > 0) || badge === true) && (
              <span className="ml-1.5 bg-[var(--accent)] text-white text-[10px] px-1.5 py-0 rounded-full min-w-[16px] text-center">
                {typeof badge === "number" ? (badge > 99 ? "99+" : badge) : ""}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Content — terminal and context get no padding (own layout) */}
      <div className={cn("flex-1 overflow-hidden relative", tab !== "context" && tab !== "terminal" && "overflow-y-auto p-4")}>
        {tab === "terminal" && (
          <TerminalView
            endpoint={`/api/agents/${agentId}/terminal`}
            label={agentId}
          />
        )}
        {tab === "status" && (
          <MarkdownRenderer>
            {statusData?.markdown || "*No STATUS.md yet — agent hasn't started writing status updates.*"}
          </MarkdownRenderer>
        )}
        {tab === "log" && <LogView log={logData?.log || ""} />}
        {tab === "changes" && (
          <div className="space-y-4">
            {changesStat ? (
              <>
                <pre className="text-xs text-[var(--muted-foreground)] whitespace-pre-wrap">{changesStat.trim()}</pre>
                {changesDiff && (
                  <pre className="text-xs whitespace-pre-wrap font-mono leading-relaxed">
                    {changesDiff.split("\n").map((line, i) => (
                      <div
                        key={i}
                        className={cn(
                          line.startsWith("+") && !line.startsWith("+++") ? "text-[var(--success)]" :
                          line.startsWith("-") && !line.startsWith("---") ? "text-[var(--error)]" :
                          line.startsWith("@@") ? "text-[var(--accent)]" :
                          "text-[var(--muted-foreground)]"
                        )}
                      >
                        {line}
                      </div>
                    ))}
                  </pre>
                )}
              </>
            ) : (
              <div className="text-[var(--muted-foreground)] text-xs">No changes yet</div>
            )}
          </div>
        )}
        {tab === "context" && <ContextView agentId={agentId} />}
        {tab === "loops" && <LoopsView agentId={agentId} />}
      </div>

      {/* Message input — always visible */}
      <MessageInput agentId={agentId} />
    </div>
  );
}

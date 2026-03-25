import type { AgentInfo } from "@dev-agents/shared";
import { cn } from "@/lib/utils";
import { useGlobalUnread } from "@/hooks/useAgentEvents";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { rpc } from "@/lib/api";
import { Bot, Plus, Circle, Monitor } from "lucide-react";
import { ContextMenu, type MenuItem } from "./ContextMenu";

interface SidebarProps {
  agents: AgentInfo[];
  selectedAgent: string | null;
  onSelectAgent: (id: string | null) => void;
  onSpawn?: () => void;
}

const statusColor: Record<string, string> = {
  running: "text-[var(--success)]",
  starting: "text-[var(--warning)]",
  thinking: "text-[var(--accent)]",
  tool_use: "text-[var(--accent)]",
  done: "text-[var(--muted-foreground)]",
  error: "text-[var(--error)]",
  idle: "text-[var(--muted-foreground)]",
  discovered: "text-[var(--warning)]",
};

// Special ID for the orchestrator view
export const ORCHESTRATOR_ID = "__orchestrator__";

export function Sidebar({ agents, selectedAgent, onSelectAgent, onSpawn }: SidebarProps) {
  const unread = useGlobalUnread();
  const queryClient = useQueryClient();

  const restartSession = useMutation({
    mutationFn: () => fetch("/api/orchestrator/restart-session", { method: "POST" }).then(r => r.json()),
  });

  const restartContainer = useMutation({
    mutationFn: () => fetch("/api/orchestrator/restart-container", { method: "POST" }).then(r => r.json()),
  });

  const stopAgent = useMutation({
    mutationFn: (id: string) => rpc.agent.stop({ id }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["agents"] }),
  });

  const orchestratorMenu: MenuItem[] = [
    { label: "Restart Claude session", onClick: () => restartSession.mutate() },
    { label: "Restart container", onClick: () => restartContainer.mutate() },
    { label: "View config", onClick: () => onSelectAgent(ORCHESTRATOR_ID) },
  ];

  function agentMenu(id: string): MenuItem[] {
    return [
      { label: "Open terminal", onClick: () => onSelectAgent(id) },
      { label: "View status", onClick: () => onSelectAgent(id) },
      { label: "Stop agent", onClick: () => stopAgent.mutate(id), danger: true },
    ];
  }
  const orchestratorUnread = unread.get(ORCHESTRATOR_ID) || 0;

  return (
    <aside className="w-64 border-r border-[var(--border)] flex flex-col h-full">
      {/* Header */}
      <div className="p-3 border-b border-[var(--border)] flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Bot size={16} className="text-[var(--accent)]" />
          <span className="font-semibold text-sm">dev-agents</span>
        </div>
        <button
          onClick={onSpawn}
          className="p-1 rounded hover:bg-[var(--muted)] transition-colors"
          title="Spawn new agent"
        >
          <Plus size={14} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* Orchestrator — always first */}
        <div
          onClick={() => onSelectAgent(ORCHESTRATOR_ID)}
          className={cn(
            "w-full text-left p-3 border-b border-[var(--border)] hover:bg-[var(--muted)] transition-colors cursor-pointer",
            selectedAgent === ORCHESTRATOR_ID && "bg-[var(--muted)]"
          )}
        >
          <div className="flex items-center gap-2">
            <Monitor size={12} className="text-[var(--accent)] shrink-0" />
            <span className="font-medium text-sm flex-1">Orchestrator</span>
            {orchestratorUnread > 0 && (
              <span className="bg-[var(--accent)] text-white text-[10px] px-1.5 rounded-full min-w-[16px] text-center">
                {orchestratorUnread}
              </span>
            )}
            <ContextMenu items={orchestratorMenu} />
          </div>
          <div className="text-xs text-[var(--muted-foreground)] mt-0.5 ml-5">
            Claude Code session
          </div>
        </div>

        {/* Agents */}
        {agents.length === 0 ? (
          <div className="p-3 text-[var(--muted-foreground)] text-xs">
            No agents running
          </div>
        ) : (
          agents.map((agent) => (
            <div
              key={agent.id}
              onClick={() => onSelectAgent(agent.id)}
              className={cn(
                "w-full text-left p-3 border-b border-[var(--border)] hover:bg-[var(--muted)] transition-colors cursor-pointer",
                selectedAgent === agent.id && "bg-[var(--muted)]"
              )}
            >
              <div className="flex items-center gap-2 ml-2">
                <Circle
                  size={8}
                  fill="currentColor"
                  className={statusColor[agent.status] || "text-[var(--muted-foreground)]"}
                />
                <span className="font-medium text-sm truncate flex-1">{agent.id}</span>
                {(unread.get(agent.id) || 0) > 0 && (
                  <span className="bg-[var(--accent)] text-white text-[10px] px-1.5 rounded-full min-w-[16px] text-center">
                    {unread.get(agent.id)}
                  </span>
                )}
                <ContextMenu items={agentMenu(agent.id)} />
              </div>
              {agent.project && (
                <div className="text-xs text-[var(--muted-foreground)] mt-1 ml-6">
                  {agent.project}
                </div>
              )}
              <div className="text-xs text-[var(--muted-foreground)] mt-0.5 ml-6">
                {agent.status}
              </div>
            </div>
          ))
        )}
      </div>

      {/* Footer */}
      <div className="p-2 border-t border-[var(--border)] text-xs text-[var(--muted-foreground)]">
        {agents.length} agent{agents.length !== 1 ? "s" : ""}
      </div>
    </aside>
  );
}

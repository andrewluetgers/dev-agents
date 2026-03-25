import type { AgentInfo } from "@dev-agents/shared";
import { cn } from "@/lib/utils";
import { Bot, Plus, Circle } from "lucide-react";

interface SidebarProps {
  agents: AgentInfo[];
  selectedAgent: string | null;
  onSelectAgent: (id: string | null) => void;
}

const statusColor: Record<string, string> = {
  running: "text-[var(--success)]",
  starting: "text-[var(--warning)]",
  done: "text-[var(--muted-foreground)]",
  error: "text-[var(--error)]",
  idle: "text-[var(--muted-foreground)]",
  discovered: "text-[var(--warning)]",
};

export function Sidebar({ agents, selectedAgent, onSelectAgent }: SidebarProps) {
  return (
    <aside className="w-64 border-r border-[var(--border)] flex flex-col h-full">
      {/* Header */}
      <div className="p-3 border-b border-[var(--border)] flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Bot size={16} className="text-[var(--accent)]" />
          <span className="font-semibold text-sm">dev-agents</span>
        </div>
        <button
          className="p-1 rounded hover:bg-[var(--muted)] transition-colors"
          title="Spawn new agent"
        >
          <Plus size={14} />
        </button>
      </div>

      {/* Agent list */}
      <div className="flex-1 overflow-y-auto">
        {agents.length === 0 ? (
          <div className="p-3 text-[var(--muted-foreground)] text-xs">
            No agents running
          </div>
        ) : (
          agents.map((agent) => (
            <button
              key={agent.id}
              onClick={() => onSelectAgent(agent.id)}
              className={cn(
                "w-full text-left p-3 border-b border-[var(--border)] hover:bg-[var(--muted)] transition-colors",
                selectedAgent === agent.id && "bg-[var(--muted)]"
              )}
            >
              <div className="flex items-center gap-2">
                <Circle
                  size={8}
                  fill="currentColor"
                  className={statusColor[agent.status] || "text-[var(--muted-foreground)]"}
                />
                <span className="font-medium text-sm truncate">{agent.id}</span>
              </div>
              {agent.project && (
                <div className="text-xs text-[var(--muted-foreground)] mt-1 ml-4">
                  {agent.project}
                </div>
              )}
              <div className="text-xs text-[var(--muted-foreground)] mt-0.5 ml-4">
                {agent.status}
              </div>
            </button>
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

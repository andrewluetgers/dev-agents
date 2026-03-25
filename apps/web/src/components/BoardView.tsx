import { useQuery } from "@tanstack/react-query";
import { rpc } from "@/lib/api";
import type { AgentInfo, TaskLane } from "@dev-agents/shared";
import { cn } from "@/lib/utils";
import { Plus, GripVertical, Bot } from "lucide-react";

const lanes: { id: TaskLane; label: string; color: string }[] = [
  { id: "backlog", label: "Backlog", color: "border-[var(--muted-foreground)]" },
  { id: "planning", label: "Planning", color: "border-[var(--warning)]" },
  { id: "in_progress", label: "In Progress", color: "border-[var(--accent)]" },
  { id: "review", label: "Review", color: "border-purple-500" },
  { id: "done", label: "Done", color: "border-[var(--success)]" },
];

interface BoardCard {
  id: string;
  title: string;
  project: string;
  agentId?: string;
  lane: TaskLane;
}

export function BoardView() {
  const { data: agents = [] } = useQuery({
    queryKey: ["agents"],
    queryFn: () => rpc.agent.list(),
  });

  const cards: BoardCard[] = agents.map((agent) => ({
    id: agent.id,
    title: agent.task || agent.id,
    project: agent.project || "unknown",
    agentId: agent.id,
    lane: agentStatusToLane(agent),
  }));

  return (
    <div className="flex h-full overflow-x-auto p-4 gap-4">
      {lanes.map((lane) => (
        <Lane
          key={lane.id}
          lane={lane}
          cards={cards.filter((c) => c.lane === lane.id)}
          agents={agents}
        />
      ))}
    </div>
  );
}

function Lane({
  lane,
  cards,
  agents,
}: {
  lane: (typeof lanes)[number];
  cards: BoardCard[];
  agents: AgentInfo[];
}) {
  return (
    <div className="flex flex-col w-64 shrink-0">
      <div className={cn("flex items-center gap-2 mb-3 pb-2 border-b-2", lane.color)}>
        <h3 className="text-xs font-semibold uppercase tracking-wider">{lane.label}</h3>
        <span className="text-xs text-[var(--muted-foreground)]">{cards.length}</span>
      </div>
      <div className="flex-1 space-y-2 overflow-y-auto">
        {cards.map((card) => (
          <Card key={card.id} card={card} agent={agents.find((a) => a.id === card.agentId)} />
        ))}
        {cards.length === 0 && (
          <div className="text-xs text-[var(--muted-foreground)] text-center py-4 opacity-50">No tasks</div>
        )}
      </div>
      {lane.id === "backlog" && (
        <button className="mt-2 flex items-center gap-1 text-xs text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors py-2">
          <Plus size={12} /> Add task
        </button>
      )}
    </div>
  );
}

function Card({ card, agent }: { card: BoardCard; agent?: AgentInfo }) {
  return (
    <div className="bg-[var(--muted)] border border-[var(--border)] rounded-lg p-3 hover:border-[var(--accent)] transition-colors cursor-pointer">
      <div className="flex items-start gap-2">
        <GripVertical size={12} className="text-[var(--muted-foreground)] mt-0.5 shrink-0 opacity-50" />
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium truncate">{card.title}</div>
          <div className="text-xs text-[var(--muted-foreground)] mt-1">{card.project}</div>
          {agent && (
            <div className="flex items-center gap-1 mt-2 text-xs text-[var(--accent)]">
              <Bot size={10} /> {agent.id}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function agentStatusToLane(agent: AgentInfo): TaskLane {
  switch (agent.status) {
    case "starting":
    case "discovered":
      return "planning";
    case "running":
    case "thinking":
    case "tool_use":
      return "in_progress";
    case "done":
      return "done";
    case "error":
      return "review";
    default:
      return "in_progress";
  }
}

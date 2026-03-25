import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchAgents } from "@/lib/api";
import { Sidebar } from "./Sidebar";
import { AgentDetail } from "./AgentDetail";
import { EmptyState } from "./EmptyState";

export function Layout() {
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);

  const { data: agents = [] } = useQuery({
    queryKey: ["agents"],
    queryFn: fetchAgents,
  });

  return (
    <div className="flex h-screen">
      {/* Sidebar */}
      <Sidebar
        agents={agents}
        selectedAgent={selectedAgent}
        onSelectAgent={setSelectedAgent}
      />

      {/* Main panel */}
      <main className="flex-1 overflow-hidden">
        {selectedAgent ? (
          <AgentDetail agentId={selectedAgent} />
        ) : (
          <EmptyState agentCount={agents.length} />
        )}
      </main>
    </div>
  );
}

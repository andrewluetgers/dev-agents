import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { rpc } from "@/lib/api";
import { Sidebar, ORCHESTRATOR_ID } from "./Sidebar";
import { AgentDetail } from "./AgentDetail";
import { OrchestratorView } from "./OrchestratorView";
import { EmptyState } from "./EmptyState";
import { SpawnDialog } from "./SpawnDialog";

export function Layout() {
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);
  const [spawnOpen, setSpawnOpen] = useState(false);

  const { data: agents = [] } = useQuery({
    queryKey: ["agents"],
    queryFn: () => rpc.agent.list(),
  });

  return (
    <div className="flex h-full">
      <Sidebar
        agents={agents}
        selectedAgent={selectedAgent}
        onSelectAgent={setSelectedAgent}
        onSpawn={() => setSpawnOpen(true)}
      />
      <SpawnDialog open={spawnOpen} onClose={() => setSpawnOpen(false)} />
      <main className="flex-1 overflow-hidden" key={selectedAgent || "empty"}>
        {selectedAgent === ORCHESTRATOR_ID ? (
          <OrchestratorView />
        ) : selectedAgent ? (
          <AgentDetail agentId={selectedAgent} />
        ) : (
          <EmptyState agentCount={agents.length} />
        )}
      </main>
    </div>
  );
}

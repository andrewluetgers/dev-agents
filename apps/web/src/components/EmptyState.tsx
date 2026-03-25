import { Bot } from "lucide-react";

export function EmptyState({ agentCount }: { agentCount: number }) {
  return (
    <div className="flex items-center justify-center h-full">
      <div className="text-center">
        <Bot size={48} className="mx-auto mb-4 text-[var(--muted-foreground)]" />
        {agentCount === 0 ? (
          <>
            <h2 className="text-lg font-semibold mb-2">No agents running</h2>
            <p className="text-[var(--muted-foreground)] text-sm">
              Use <code className="bg-[var(--muted)] px-1 rounded">/dev-agent new</code> in Claude Code to spawn one
            </p>
          </>
        ) : (
          <>
            <h2 className="text-lg font-semibold mb-2">Select an agent</h2>
            <p className="text-[var(--muted-foreground)] text-sm">
              Choose an agent from the sidebar to view its status
            </p>
          </>
        )}
      </div>
    </div>
  );
}

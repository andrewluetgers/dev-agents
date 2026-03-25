import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { Layout } from "./components/Layout";
import { BoardView } from "./components/BoardView";
import { cn } from "@/lib/utils";
import { Monitor, LayoutGrid } from "lucide-react";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchInterval: 5000,
    },
  },
});

type View = "agents" | "board";

function AppContent() {
  const [view, setView] = useState<View>("agents");

  return (
    <div className="flex flex-col h-screen">
      {/* Top nav */}
      <nav className="flex items-center border-b border-[var(--border)] px-2 shrink-0">
        <button
          onClick={() => setView("agents")}
          className={cn(
            "flex items-center gap-1.5 px-3 py-2 text-xs transition-colors border-b-2",
            view === "agents"
              ? "border-[var(--accent)] text-[var(--foreground)]"
              : "border-transparent text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
          )}
        >
          <Monitor size={12} />
          Agents
        </button>
        <button
          onClick={() => setView("board")}
          className={cn(
            "flex items-center gap-1.5 px-3 py-2 text-xs transition-colors border-b-2",
            view === "board"
              ? "border-[var(--accent)] text-[var(--foreground)]"
              : "border-transparent text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
          )}
        >
          <LayoutGrid size={12} />
          Board
        </button>
      </nav>

      {/* View content */}
      <div className="flex-1 overflow-hidden">
        {view === "agents" ? <Layout /> : <BoardView />}
      </div>
    </div>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AppContent />
    </QueryClientProvider>
  );
}

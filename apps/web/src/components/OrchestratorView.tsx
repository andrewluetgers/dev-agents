import { useState } from "react";
import { cn } from "@/lib/utils";
import { TerminalView } from "./TerminalView";
import { EventStreamView } from "./EventStreamView";
import { Terminal, Radio } from "lucide-react";

type Tab = "terminal" | "events";

export function OrchestratorView() {
  const [tab, setTab] = useState<Tab>("terminal");

  const tabs: { id: Tab; label: string; icon: typeof Terminal }[] = [
    { id: "terminal", label: "Terminal", icon: Terminal },
    { id: "events", label: "Events", icon: Radio },
  ];

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="p-3 border-b border-[var(--border)]">
        <h2 className="font-semibold">Orchestrator</h2>
        <div className="text-xs text-[var(--muted-foreground)] mt-0.5">
          Claude Code CLI session
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-[var(--border)]">
        {tabs.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={cn(
              "flex items-center gap-1.5 px-4 py-2 text-xs transition-colors border-b-2",
              tab === id
                ? "border-[var(--accent)] text-[var(--foreground)]"
                : "border-transparent text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
            )}
          >
            <Icon size={12} />
            {label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden relative">
        {tab === "terminal" && <TerminalView />}
        {tab === "events" && <EventStreamView />}
      </div>
    </div>
  );
}

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { rpc } from "@/lib/api";
import { Plus, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface LoopsViewProps {
  agentId: string;
}

export function LoopsView({ agentId }: LoopsViewProps) {
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [label, setLabel] = useState("");
  const [command, setCommand] = useState("");
  const [type, setType] = useState<"exec" | "message">("exec");
  const [intervalSec, setIntervalSec] = useState(30);

  const { data: loops = [] } = useQuery({
    queryKey: ["loops", agentId],
    queryFn: () => rpc.loop.list({ agentId }),
    refetchInterval: 3000,
  });

  const createLoop = useMutation({
    mutationFn: () =>
      rpc.loop.create({
        agentId,
        command,
        type,
        intervalMs: intervalSec * 1000,
        label,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["loops", agentId] });
      setShowForm(false);
      setLabel("");
      setCommand("");
      setType("exec");
      setIntervalSec(30);
    },
  });

  const toggleLoop = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      rpc.loop.update({ id, enabled }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["loops", agentId] });
    },
  });

  const deleteLoop = useMutation({
    mutationFn: (id: string) => rpc.loop.delete({ id }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["loops", agentId] });
    },
  });

  function formatInterval(ms: number) {
    const sec = ms / 1000;
    if (sec < 60) return `${sec}s`;
    if (sec < 3600) return `${Math.round(sec / 60)}m`;
    return `${Math.round(sec / 3600)}h`;
  }

  function timeAgo(iso: string) {
    const diff = Date.now() - new Date(iso).getTime();
    const sec = Math.floor(diff / 1000);
    if (sec < 60) return `${sec}s ago`;
    if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
    return `${Math.floor(sec / 3600)}h ago`;
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs text-[var(--muted-foreground)]">
          {loops.length} loop{loops.length !== 1 ? "s" : ""}
        </span>
        <button
          onClick={() => setShowForm(!showForm)}
          className="flex items-center gap-1 text-xs px-2 py-1 rounded bg-[var(--accent)] text-white hover:opacity-90 transition-opacity"
        >
          <Plus size={12} />
          New Loop
        </button>
      </div>

      {/* New Loop Form */}
      {showForm && (
        <div className="border border-[var(--border)] rounded p-3 space-y-3">
          <div>
            <label className="text-xs text-[var(--muted-foreground)] block mb-1">Label</label>
            <input
              type="text"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="e.g. Check test status"
              className="w-full bg-[var(--muted)] border border-[var(--border)] rounded px-3 py-2 text-sm outline-none focus:border-[var(--accent)]"
            />
          </div>
          <div>
            <label className="text-xs text-[var(--muted-foreground)] block mb-1">Command</label>
            <input
              type="text"
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              placeholder="e.g. npm test 2>&1 | tail -5"
              className="w-full bg-[var(--muted)] border border-[var(--border)] rounded px-3 py-2 text-sm font-mono outline-none focus:border-[var(--accent)]"
            />
          </div>
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="text-xs text-[var(--muted-foreground)] block mb-1">Type</label>
              <select
                value={type}
                onChange={(e) => setType(e.target.value as "exec" | "message")}
                className="w-full bg-[var(--muted)] border border-[var(--border)] rounded px-3 py-2 text-sm outline-none focus:border-[var(--accent)]"
              >
                <option value="exec">Exec (shell command)</option>
                <option value="message">Message (send to agent)</option>
              </select>
            </div>
            <div className="flex-1">
              <label className="text-xs text-[var(--muted-foreground)] block mb-1">Interval (seconds)</label>
              <input
                type="number"
                value={intervalSec}
                onChange={(e) => setIntervalSec(Math.max(1, parseInt(e.target.value) || 1))}
                min={1}
                className="w-full bg-[var(--muted)] border border-[var(--border)] rounded px-3 py-2 text-sm outline-none focus:border-[var(--accent)]"
              />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <button
              onClick={() => setShowForm(false)}
              className="px-3 py-1.5 text-xs text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={() => createLoop.mutate()}
              disabled={!label || !command || createLoop.isPending}
              className="px-3 py-1.5 text-xs bg-[var(--accent)] text-white rounded disabled:opacity-50 hover:opacity-90 transition-opacity"
            >
              {createLoop.isPending ? "Creating..." : "Create"}
            </button>
          </div>
          {createLoop.isError && (
            <div className="text-xs text-[var(--error)]">{String(createLoop.error)}</div>
          )}
        </div>
      )}

      {/* Loop List */}
      {loops.length === 0 && !showForm && (
        <div className="text-xs text-[var(--muted-foreground)] text-center py-8">
          No loops yet. Create one to run recurring commands.
        </div>
      )}

      {loops.map((loop: any) => (
        <div
          key={loop.id}
          className="border border-[var(--border)] rounded p-3 space-y-2"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <button
                onClick={() =>
                  toggleLoop.mutate({ id: loop.id, enabled: !loop.enabled })
                }
                className={cn(
                  "w-8 h-4 rounded-full relative transition-colors cursor-pointer",
                  loop.enabled ? "bg-[var(--accent)]" : "bg-[var(--muted)]"
                )}
              >
                <span
                  className={cn(
                    "absolute top-0.5 w-3 h-3 rounded-full bg-white transition-all",
                    loop.enabled ? "left-4" : "left-0.5"
                  )}
                />
              </button>
              <span className="text-sm font-medium">{loop.label}</span>
              <span className="text-xs text-[var(--muted-foreground)]">
                every {formatInterval(loop.intervalMs)}
              </span>
              <span
                className={cn(
                  "text-[10px] px-1.5 py-0 rounded",
                  loop.type === "exec"
                    ? "bg-[var(--muted)] text-[var(--muted-foreground)]"
                    : "bg-[var(--accent)]/20 text-[var(--accent)]"
                )}
              >
                {loop.type}
              </span>
            </div>
            <button
              onClick={() => deleteLoop.mutate(loop.id)}
              className="p-1 text-[var(--muted-foreground)] hover:text-[var(--error)] transition-colors"
            >
              <Trash2 size={12} />
            </button>
          </div>

          <div className="text-xs font-mono text-[var(--muted-foreground)] truncate">
            {loop.command}
          </div>

          {loop.lastRun && (
            <div className="text-xs space-y-1">
              <div className="flex items-center gap-2 text-[var(--muted-foreground)]">
                <span>Last run: {timeAgo(loop.lastRun)}</span>
                {loop.lastExitCode !== undefined && (
                  <span
                    className={cn(
                      loop.lastExitCode === 0
                        ? "text-[var(--success)]"
                        : "text-[var(--error)]"
                    )}
                  >
                    exit {loop.lastExitCode}
                  </span>
                )}
              </div>
              {loop.lastResult && (
                <pre className="text-xs bg-[var(--muted)] rounded p-2 whitespace-pre-wrap max-h-24 overflow-y-auto font-mono">
                  {loop.lastResult.slice(0, 500)}
                </pre>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { rpc } from "@/lib/api";
import { X } from "lucide-react";

interface SpawnDialogProps {
  open: boolean;
  onClose: () => void;
}

export function SpawnDialog({ open, onClose }: SpawnDialogProps) {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [project, setProject] = useState("");
  const [task, setTask] = useState("");

  const { data: projects = [] } = useQuery({
    queryKey: ["projects"],
    queryFn: () => rpc.project.list(),
    enabled: open,
  });

  const spawn = useMutation({
    mutationFn: () =>
      rpc.agent.spawn({
        name: name || `agent-${Date.now().toString(36)}`,
        project: project || undefined,
        task: task || undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["agents"] });
      setName("");
      setProject("");
      setTask("");
      onClose();
    },
  });

  if (!open) return null;

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="bg-[var(--background)] border border-[var(--border)] rounded-lg w-[480px] max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-[var(--border)]">
          <h2 className="font-semibold">Spawn New Agent</h2>
          <button onClick={onClose} className="p-1 hover:bg-[var(--muted)] rounded">
            <X size={14} />
          </button>
        </div>

        {/* Form */}
        <div className="p-4 space-y-4">
          {/* Project */}
          <div>
            <label className="text-xs text-[var(--muted-foreground)] block mb-1">Project</label>
            <select
              value={project}
              onChange={(e) => setProject(e.target.value)}
              className="w-full bg-[var(--muted)] border border-[var(--border)] rounded px-3 py-2 text-sm outline-none focus:border-[var(--accent)]"
            >
              <option value="">Select a project...</option>
              {projects.map((p: { name: string }) => (
                <option key={p.name} value={p.name}>{p.name}</option>
              ))}
              <option value="__custom">Custom path or URL...</option>
            </select>
          </div>

          {project === "__custom" && (
            <div>
              <label className="text-xs text-[var(--muted-foreground)] block mb-1">Path or Git URL</label>
              <input
                type="text"
                placeholder="~/dev/my-project or https://github.com/org/repo"
                className="w-full bg-[var(--muted)] border border-[var(--border)] rounded px-3 py-2 text-sm outline-none focus:border-[var(--accent)]"
                onChange={(e) => setProject(e.target.value)}
              />
            </div>
          )}

          {/* Agent name */}
          <div>
            <label className="text-xs text-[var(--muted-foreground)] block mb-1">Agent Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Auto-generated if empty"
              className="w-full bg-[var(--muted)] border border-[var(--border)] rounded px-3 py-2 text-sm outline-none focus:border-[var(--accent)]"
            />
          </div>

          {/* Task */}
          <div>
            <label className="text-xs text-[var(--muted-foreground)] block mb-1">Task</label>
            <textarea
              value={task}
              onChange={(e) => setTask(e.target.value)}
              placeholder="What should this agent work on? (optional — can assign later)"
              rows={4}
              className="w-full bg-[var(--muted)] border border-[var(--border)] rounded px-3 py-2 text-sm outline-none focus:border-[var(--accent)] resize-none"
            />
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 p-4 border-t border-[var(--border)]">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => spawn.mutate()}
            disabled={spawn.isPending}
            className="px-4 py-2 bg-[var(--accent)] text-white rounded text-sm disabled:opacity-50 hover:opacity-90 transition-opacity"
          >
            {spawn.isPending ? "Spawning..." : "Spawn Agent"}
          </button>
        </div>

        {spawn.isError && (
          <div className="px-4 pb-4 text-xs text-[var(--error)]">
            {String(spawn.error)}
          </div>
        )}
      </div>
    </div>
  );
}

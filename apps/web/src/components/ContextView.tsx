import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { rpc } from "@/lib/api";
import { cn } from "@/lib/utils";
import { MarkdownRenderer } from "./MarkdownRenderer";
import { FileText, Settings, FolderOpen } from "lucide-react";

// Key files always shown at top (if they exist)
const pinnedFiles = [
  "CLAUDE.md",
  ".dev-agents/config.json",
  ".dev-agents/WORKFLOW.md",
  ".dev-agents/memory.md",
  ".dev-agents/LEGIBILITY.md",
  "/home/agent/STATUS.md",
];

export function ContextView({ agentId }: { agentId: string }) {
  const [selected, setSelected] = useState("CLAUDE.md");

  // Discover all markdown and config files
  const { data: fileList } = useQuery({
    queryKey: ["agent-docs-list", agentId],
    queryFn: async () => {
      const result = await rpc.agent.exec({
        id: agentId,
        command: `(
          # Pinned files
          for f in ${pinnedFiles.join(" ")}; do
            [ -f "/home/agent/workspace/$f" ] && echo "pinned:$f"
            [ -f "$f" ] && echo "pinned:$f"
          done
          # All markdown files in workspace (not node_modules)
          find /home/agent/workspace -name "*.md" -not -path "*/node_modules/*" -not -path "*/.git/*" | sort | while read f; do
            echo "doc:\${f#/home/agent/workspace/}"
          done
          # Config files
          find /home/agent/workspace -name "*.json" -path "*/.dev-agents/*" | sort | while read f; do
            echo "config:\${f#/home/agent/workspace/}"
          done
        ) 2>/dev/null`,
      });

      const lines = (result.stdout || "").split("\n").filter(Boolean);
      const pinned: string[] = [];
      const docs: string[] = [];
      const seen = new Set<string>();

      for (const line of lines) {
        const [type, path] = line.split(":", 2);
        if (!path || seen.has(path)) continue;
        seen.add(path);
        if (type === "pinned") pinned.push(path);
        else docs.push(path);
      }

      // Remove pinned items from docs to avoid duplicates
      const docsFiltered = docs.filter((d) => !pinned.includes(d));

      return { pinned, docs: docsFiltered };
    },
  });

  // Fetch selected file content
  const isAbsolute = selected.startsWith("/");
  const filePath = isAbsolute ? selected : `/home/agent/workspace/${selected}`;

  const { data: fileData, isLoading } = useQuery({
    queryKey: ["agent-doc-content", agentId, selected],
    queryFn: () =>
      rpc.agent.exec({
        id: agentId,
        command: `cat "${filePath}" 2>/dev/null || echo "File not found: ${selected}"`,
      }),
    enabled: !!selected,
  });

  const content = fileData?.stdout || "";
  const isJson = selected.endsWith(".json");
  const isMd = selected.endsWith(".md");
  const fileName = selected.split("/").pop() || selected;

  const allPinned = fileList?.pinned || [];
  const allDocs = fileList?.docs || [];

  return (
    <div className="flex h-full">
      {/* File sidebar */}
      <div className="w-48 border-r border-[var(--border)] shrink-0 overflow-y-auto">
        {/* Pinned */}
        {allPinned.length > 0 && (
          <>
            <div className="px-3 py-1.5 text-[10px] uppercase tracking-wider text-[var(--muted-foreground)] font-semibold">
              Key Files
            </div>
            {allPinned.map((path) => (
              <FileButton
                key={path}
                path={path}
                selected={selected === path}
                onClick={() => setSelected(path)}
                pinned
              />
            ))}
          </>
        )}

        {/* All docs */}
        {allDocs.length > 0 && (
          <>
            <div className="px-3 py-1.5 text-[10px] uppercase tracking-wider text-[var(--muted-foreground)] font-semibold mt-2">
              Docs
            </div>
            {allDocs.map((path) => (
              <FileButton
                key={path}
                path={path}
                selected={selected === path}
                onClick={() => setSelected(path)}
              />
            ))}
          </>
        )}
      </div>

      {/* File content */}
      <div className="flex-1 overflow-y-auto p-4">
        <div className="text-xs text-[var(--muted-foreground)] mb-2 flex items-center gap-1.5">
          <FolderOpen size={11} />
          {selected}
        </div>
        {isLoading ? (
          <div className="text-[var(--muted-foreground)] text-xs">Loading...</div>
        ) : isJson ? (
          <pre className="text-[13px] font-mono whitespace-pre-wrap text-[var(--muted-foreground)]">
            {(() => {
              try { return JSON.stringify(JSON.parse(content), null, 2); }
              catch { return content; }
            })()}
          </pre>
        ) : isMd ? (
          <MarkdownRenderer>{content}</MarkdownRenderer>
        ) : (
          <pre className="text-[13px] font-mono whitespace-pre-wrap">{content}</pre>
        )}
      </div>
    </div>
  );
}

function FileButton({
  path,
  selected,
  onClick,
  pinned,
}: {
  path: string;
  selected: boolean;
  onClick: () => void;
  pinned?: boolean;
}) {
  const name = path.split("/").pop() || path;
  const dir = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
  const isJson = path.endsWith(".json");

  return (
    <button
      onClick={onClick}
      className={cn(
        "w-full text-left px-3 py-1.5 text-xs flex items-center gap-1.5 transition-colors",
        selected
          ? "bg-[var(--muted)] text-[var(--foreground)]"
          : "text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)]/50"
      )}
    >
      {isJson ? <Settings size={11} className="shrink-0" /> : <FileText size={11} className="shrink-0" />}
      <div className="truncate">
        <div className="truncate">{name}</div>
        {dir && !pinned && (
          <div className="text-[10px] opacity-50 truncate">{dir}</div>
        )}
      </div>
    </button>
  );
}

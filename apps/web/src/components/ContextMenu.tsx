import { useState, useRef, useEffect } from "react";
import { MoreVertical } from "lucide-react";
import { cn } from "@/lib/utils";

export interface MenuItem {
  label: string;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
}

interface ContextMenuProps {
  items: MenuItem[];
}

export function ContextMenu({ items }: ContextMenuProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={(e) => { e.stopPropagation(); setOpen(!open); }}
        className="p-1 rounded hover:bg-[var(--muted)] transition-colors"
      >
        <MoreVertical size={14} className="text-[var(--muted-foreground)]" />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 z-50 bg-[var(--background)] border border-[var(--border)] rounded-lg shadow-lg py-1 min-w-[180px]">
          {items.map((item, i) => (
            <button
              key={i}
              onClick={() => { item.onClick(); setOpen(false); }}
              disabled={item.disabled}
              className={cn(
                "w-full text-left px-3 py-1.5 text-xs transition-colors",
                item.disabled
                  ? "text-[var(--muted-foreground)] opacity-50 cursor-not-allowed"
                  : item.danger
                  ? "text-[var(--error)] hover:bg-[var(--error)]/10"
                  : "text-[var(--foreground)] hover:bg-[var(--muted)]"
              )}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

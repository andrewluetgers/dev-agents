import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { rpc } from "@/lib/api";
import { Send } from "lucide-react";

export function MessageInput({ agentId }: { agentId: string }) {
  const [message, setMessage] = useState("");

  const mutation = useMutation({
    mutationFn: (content: string) => rpc.agent.message({ id: agentId, content }),
  });

  const handleSend = () => {
    if (!message.trim() || mutation.isPending) return;
    mutation.mutate(message.trim(), {
      onSuccess: () => setMessage(""),
    });
  };

  return (
    <div className="border-t border-[var(--border)] p-2 flex gap-2">
      <input
        type="text"
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && handleSend()}
        placeholder={`Message ${agentId}...`}
        className="flex-1 bg-[var(--muted)] border border-[var(--border)] rounded px-3 py-1.5 text-sm outline-none focus:border-[var(--accent)] transition-colors"
      />
      <button
        onClick={handleSend}
        disabled={mutation.isPending || !message.trim()}
        className="px-3 py-1.5 bg-[var(--accent)] text-white rounded text-sm disabled:opacity-50 hover:opacity-90 transition-opacity flex items-center gap-1"
      >
        <Send size={12} />
      </button>
    </div>
  );
}

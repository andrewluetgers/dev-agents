import { useState } from "react";
import { sendMessage } from "@/lib/api";
import { Send } from "lucide-react";

export function MessageInput({ agentId }: { agentId: string }) {
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);

  const handleSend = async () => {
    if (!message.trim() || sending) return;
    setSending(true);
    try {
      await sendMessage(agentId, message.trim());
      setMessage("");
    } catch (err) {
      console.error("Failed to send:", err);
    }
    setSending(false);
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
        disabled={sending || !message.trim()}
        className="px-3 py-1.5 bg-[var(--accent)] text-white rounded text-sm disabled:opacity-50 hover:opacity-90 transition-opacity flex items-center gap-1"
      >
        <Send size={12} />
      </button>
    </div>
  );
}

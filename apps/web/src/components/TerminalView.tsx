import { useEffect, useRef } from "react";

interface TerminalViewProps {
  /** WebSocket endpoint path, e.g. "/api/terminal" or "/api/agents/my-agent/terminal" */
  endpoint?: string;
  /** Label shown on connect */
  label?: string;
}

export function TerminalView({ endpoint = "/api/terminal", label = "orchestrator" }: TerminalViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const cleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const ghostty = await import("ghostty-web");
      await ghostty.init();

      if (cancelled || !containerRef.current) return;

      const term = new ghostty.Terminal({
        fontSize: 14,
        fontFamily: "'JetBrains Mono', 'Fira Code', 'SF Mono', monospace",
      });

      term.open(containerRef.current);

      const fitAddon = new ghostty.FitAddon();
      term.loadAddon(fitAddon);
      fitAddon.fit();
      fitAddon.observeResize();

      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const ws = new WebSocket(`${protocol}//${window.location.host}${endpoint}`);

      ws.onopen = () => {
        term.write(`\x1b[1;34m● Connected to ${label}\x1b[0m\r\n\r\n`);
        const dims = fitAddon.proposeDimensions();
        if (dims) {
          ws.send(JSON.stringify({ type: "resize", cols: dims.cols, rows: dims.rows }));
        }
      };

      ws.onmessage = (e) => {
        term.write(e.data);
      };

      ws.onclose = () => {
        term.write("\r\n\x1b[1;31m● Disconnected\x1b[0m\r\n");
      };

      term.onData((data: string) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(data);
        }
      });

      term.onResize(({ cols, rows }: { cols: number; rows: number }) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "resize", cols, rows }));
        }
      });

      cleanupRef.current = () => {
        ws.close();
        term.dispose();
      };
    })();

    return () => {
      cancelled = true;
      cleanupRef.current?.();
    };
  }, [endpoint, label]);

  return (
    <div
      ref={containerRef}
      className="absolute inset-0"
      style={{ background: "#0a0a0a" }}
    />
  );
}

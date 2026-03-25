import { useEffect, useRef } from "react";

export function TerminalView() {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<any>(null);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const { init, Terminal } = await import("ghostty-web");
      await init();

      if (cancelled || !containerRef.current) return;

      const term = new Terminal({
        fontSize: 13,
        fontFamily: "'SF Mono', 'Fira Code', 'Consolas', monospace",
      });
      termRef.current = term;
      term.open(containerRef.current);

      // Connect to the host server's terminal WebSocket
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const ws = new WebSocket(`${protocol}//${window.location.host}/api/terminal`);
      wsRef.current = ws;

      ws.onopen = () => {
        term.write("\x1b[1;34m● Connected to orchestrator\x1b[0m\r\n\r\n");
      };

      ws.onmessage = (e) => {
        term.write(e.data);
      };

      ws.onclose = () => {
        term.write("\r\n\x1b[1;31m● Disconnected\x1b[0m\r\n");
      };

      // Send user input to the server
      term.onData((data: string) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(data);
        }
      });

      // Handle resize
      const resizeObserver = new ResizeObserver(() => {
        // ghostty-web handles resize internally
      });
      if (containerRef.current) {
        resizeObserver.observe(containerRef.current);
      }

      return () => {
        resizeObserver.disconnect();
      };
    })();

    return () => {
      cancelled = true;
      wsRef.current?.close();
      termRef.current?.dispose?.();
    };
  }, []);

  return (
    <div
      ref={containerRef}
      className="absolute inset-0 bg-[#0a0a0a]"
    />
  );
}

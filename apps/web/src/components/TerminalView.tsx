import { useEffect, useRef } from "react";

export function TerminalView() {
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

      // FitAddon — auto-size terminal to container
      const fitAddon = new ghostty.FitAddon();
      term.loadAddon(fitAddon);
      fitAddon.fit();
      fitAddon.observeResize();

      // Connect to the host server's terminal WebSocket
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const ws = new WebSocket(`${protocol}//${window.location.host}/api/terminal`);

      ws.onopen = () => {
        term.write("\x1b[1;34m● Connected to orchestrator\x1b[0m\r\n\r\n");
        // Send initial size to server
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

      // Send user input to the server
      term.onData((data: string) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(data);
        }
      });

      // Send resize events to server
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
  }, []);

  return (
    <div
      ref={containerRef}
      className="absolute inset-0"
      style={{ background: "#0a0a0a" }}
    />
  );
}

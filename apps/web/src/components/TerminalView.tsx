import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import "@xterm/xterm/css/xterm.css";

export function TerminalView() {
  const containerRef = useRef<HTMLDivElement>(null);
  const cleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const term = new Terminal({
      fontSize: 13,
      fontFamily: "'SF Mono', 'Fira Code', 'Consolas', monospace",
      theme: {
        background: "#0a0a0a",
        foreground: "#fafafa",
        cursor: "#fafafa",
        selectionBackground: "#3b82f644",
      },
      cursorBlink: true,
      allowProposedApi: true,
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.loadAddon(new WebLinksAddon());

    term.open(containerRef.current);
    fitAddon.fit();

    // WebSocket connection with auto-reconnect
    let ws: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    function connect() {
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      ws = new WebSocket(`${protocol}//${window.location.host}/api/terminal`);

      ws.onopen = () => {
        term.write("\x1b[1;34m● Connected\x1b[0m\r\n");
        const dims = fitAddon.proposeDimensions();
        if (dims && ws) {
          ws.send(JSON.stringify({ type: "resize", cols: dims.cols, rows: dims.rows }));
        }
      };

      ws.onmessage = (e) => {
        term.write(e.data);
      };

      ws.onclose = () => {
        term.write("\r\n\x1b[2m● Reconnecting...\x1b[0m\r\n");
        reconnectTimer = setTimeout(connect, 2000);
      };

      ws.onerror = () => {};
    }

    connect();

    // User input → WebSocket
    term.onData((data) => {
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(data);
      }
    });

    // Resize → WebSocket + fit
    const resizeObserver = new ResizeObserver(() => {
      fitAddon.fit();
      const dims = fitAddon.proposeDimensions();
      if (dims && ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "resize", cols: dims.cols, rows: dims.rows }));
      }
    });
    resizeObserver.observe(containerRef.current);

    cleanupRef.current = () => {
      resizeObserver.disconnect();
      if (reconnectTimer) clearTimeout(reconnectTimer);
      ws?.close();
      term.dispose();
    };

    return () => {
      cleanupRef.current?.();
    };
  }, []);

  return (
    <div
      ref={containerRef}
      className="absolute inset-0"
      style={{ background: "#0a0a0a", padding: "4px" }}
    />
  );
}

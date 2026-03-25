#!/usr/bin/env node
//
// PTY Bridge — runs under Node.js (not Bun) because node-pty
// needs native addons that Bun doesn't fully support.
//
// Protocol: communicates with parent process via stdin/stdout JSON lines.
//   Parent → Bridge:  {"type":"input","data":"ls\r"}
//   Parent → Bridge:  {"type":"resize","cols":120,"rows":40}
//   Bridge → Parent:  {"type":"output","data":"..."}
//   Bridge → Parent:  {"type":"exit","code":0}
//

import pty from "node-pty";

const shell = process.env.SHELL || "/bin/zsh";
const cols = parseInt(process.env.COLS || "120", 10);
const rows = parseInt(process.env.ROWS || "40", 10);

const term = pty.spawn(shell, ["-l"], {
  name: "xterm-256color",
  cols,
  rows,
  cwd: process.env.HOME || "/tmp",
  env: process.env,
});

// PTY output → stdout as JSON
term.onData((data) => {
  process.stdout.write(JSON.stringify({ type: "output", data }) + "\n");
});

term.onExit(({ exitCode }) => {
  process.stdout.write(JSON.stringify({ type: "exit", code: exitCode }) + "\n");
  process.exit(0);
});

// stdin JSON → PTY input
let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  const lines = buffer.split("\n");
  buffer = lines.pop() || "";
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const msg = JSON.parse(line);
      if (msg.type === "input") {
        term.write(msg.data);
      } else if (msg.type === "resize") {
        term.resize(msg.cols, msg.rows);
      }
    } catch {}
  }
});

process.stdin.on("end", () => {
  term.kill();
  process.exit(0);
});

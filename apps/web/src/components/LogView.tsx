import { cn } from "@/lib/utils";
import { MarkdownRenderer } from "./MarkdownRenderer";
import { Bot, Terminal, CheckCircle, XCircle, MessageSquare, Wrench, Brain, Info, FileCode, Search, FolderSearch } from "lucide-react";

// Heuristic: does this text look like markdown?
function looksLikeMarkdown(text: string): boolean {
  if (text.length < 20) return false;
  const mdSignals = [
    /^#{1,6}\s/m,           // headings
    /^\s*[-*]\s/m,          // unordered lists
    /^\s*\d+\.\s/m,         // ordered lists
    /\|.*\|.*\|/m,          // tables
    /\*\*[^*]+\*\*/,        // bold
    /```/,                  // code fences
    /^\s*>\s/m,             // blockquotes
    /\[.*\]\(http/,         // links
  ];
  const matches = mdSignals.filter(r => r.test(text)).length;
  return matches >= 2;
}

function MdOrText({ text }: { text: string }) {
  if (looksLikeMarkdown(text)) {
    return <MarkdownRenderer className="prose prose-invert prose-xs max-w-none">{text}</MarkdownRenderer>;
  }
  return <span className="whitespace-pre-wrap"><Linkify>{text}</Linkify></span>;
}

const URL_REGEX = /(https?:\/\/[^\s<>"')\]]+)/g;

function Linkify({ children }: { children: string }) {
  const parts = children.split(URL_REGEX);
  if (parts.length === 1) return <>{children}</>;
  return (
    <>
      {parts.map((part, i) =>
        URL_REGEX.test(part) ? (
          <a
            key={i}
            href={part}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[var(--accent)] underline underline-offset-2 hover:opacity-80"
          >
            {part}
          </a>
        ) : (
          <span key={i}>{part}</span>
        )
      )}
    </>
  );
}

interface LogViewProps {
  log: string;
}

interface ParsedEvent {
  type: string;
  subtype?: string;
  text?: string;
  toolName?: string;
  toolInput?: string;
  toolInputRaw?: Record<string, unknown>;
  result?: string;
  event?: string;
  content?: string;
  cost?: string;
  turns?: number;
  timestamp?: string;
}

function shortenPath(path: string): string {
  // /home/agent/workspace/apps/web/src/foo.tsx → apps/web/src/foo.tsx
  return path.replace(/^\/home\/agent\/workspace\//, "");
}

function formatToolInput(name: string, input: Record<string, unknown>): string {
  switch (name) {
    case "Read":
      return shortenPath(String(input.file_path || ""))
        + (input.offset ? ` :${input.offset}` : "")
        + (input.limit ? `–${Number(input.offset || 0) + Number(input.limit)}` : "");

    case "Edit":
      return shortenPath(String(input.file_path || ""));

    case "Write":
      return shortenPath(String(input.file_path || ""));

    case "Glob":
      return `${input.pattern || ""}`
        + (input.path ? ` in ${shortenPath(String(input.path))}` : "");

    case "Grep":
      return `/${input.pattern || ""}/`
        + (input.path ? ` in ${shortenPath(String(input.path))}` : "")
        + (input.glob ? ` (${input.glob})` : "");

    case "Bash":
      return String(input.command || "").slice(0, 150);

    case "Agent":
      return String(input.description || input.prompt || "").slice(0, 100);

    case "ToolSearch":
      return String(input.query || "");

    default:
      // MCP tools like mcp__playwright__browser_navigate
      if (name.startsWith("mcp__playwright__")) {
        const action = name.replace("mcp__playwright__", "");
        if (input.url) return `${action} → ${input.url}`;
        if (input.selector) return `${action} "${input.selector}"`;
        if (input.text) return `${action} "${String(input.text).slice(0, 80)}"`;
        return action;
      }
      if (name.startsWith("mcp__channel__")) {
        return name.replace("mcp__channel__", "") + " " + String(input.question || input.message || input.status || "");
      }
      return JSON.stringify(input).slice(0, 150);
  }
}

function parseLine(line: string): ParsedEvent | null {
  try {
    const d = JSON.parse(line);

    if (d.type === "assistant" && d.message?.content) {
      for (const block of d.message.content) {
        if (block.type === "text" && block.text) {
          return { type: "text", text: block.text };
        }
        if (block.type === "tool_use") {
          return {
            type: "tool_use",
            toolName: block.name,
            toolInputRaw: block.input || {},
            toolInput: formatToolInput(block.name, block.input || {}),
          };
        }
        if (block.type === "thinking" && block.thinking) {
          return { type: "thinking", text: block.thinking };
        }
      }
      return null;
    }

    if (d.type === "user" && d.tool_use_result) {
      const stdout = d.tool_use_result.stdout || "";
      const stderr = d.tool_use_result.stderr || "";
      const output = stdout || stderr;
      return {
        type: "tool_result",
        text: output.slice(0, 500),
      };
    }

    if (d.type === "result") {
      return {
        type: "result",
        subtype: d.subtype,
        result: d.result?.slice(0, 300),
        cost: d.total_cost_usd ? `$${d.total_cost_usd.toFixed(4)}` : undefined,
        turns: d.num_turns,
      };
    }

    if (d.type === "system" && d.subtype === "init") {
      const mcpStatus = (d.mcp_servers || [])
        .map((s: { name: string; status: string }) => `${s.name}:${s.status}`)
        .join(", ");
      return {
        type: "system",
        event: "init",
        text: `Session started — ${d.model} | MCP: ${mcpStatus}`,
      };
    }

    if (d.type === "server") {
      return {
        type: "server",
        event: d.event,
        content: d.content || d.text || d.error || "",
        timestamp: d.timestamp,
      };
    }

    return null;
  } catch {
    return null;
  }
}

export function LogView({ log }: LogViewProps) {
  const lines = log.split("\n").filter(Boolean);
  const events = lines.map(parseLine).filter(Boolean) as ParsedEvent[];

  if (events.length === 0) {
    return <div className="text-[var(--muted-foreground)] text-xs">No log data</div>;
  }

  return (
    <div className="space-y-1 text-xs font-mono">
      {events.map((event, i) => (
        <LogLine key={i} event={event} />
      ))}
    </div>
  );
}

function LogLine({ event }: { event: ParsedEvent }) {
  switch (event.type) {
    case "text":
      return (
        <div className="pl-2 border-l-2 border-[var(--accent)] py-0.5">
          <div className="flex items-start gap-1.5">
            <Bot size={11} className="text-[var(--accent)] mt-0.5 shrink-0" />
            <MdOrText text={event.text!} />
          </div>
        </div>
      );

    case "thinking":
      return (
        <div className="pl-2 border-l-2 border-[var(--muted-foreground)] py-0.5 opacity-60">
          <div className="flex items-start gap-1.5">
            <Brain size={11} className="mt-0.5 shrink-0" />
            <span className="whitespace-pre-wrap italic"><Linkify>{event.text!}</Linkify></span>
          </div>
        </div>
      );

    case "tool_use": {
      const isFile = ["Read", "Edit", "Write"].includes(event.toolName || "");
      const isSearch = ["Grep", "Glob"].includes(event.toolName || "");
      const isBash = event.toolName === "Bash";
      const ToolIcon = isFile ? FileCode : isSearch ? FolderSearch : isBash ? Terminal : Wrench;

      return (
        <div className="pl-2 border-l-2 border-[var(--warning)] py-0.5">
          <div className="flex items-start gap-1.5">
            <ToolIcon size={11} className="text-[var(--warning)] mt-0.5 shrink-0" />
            <span>
              <span className="text-[var(--warning)] font-semibold">{event.toolName}</span>
              <span className="text-[var(--muted-foreground)] ml-2">
                <Linkify>{event.toolInput || ""}</Linkify>
              </span>
            </span>
          </div>
        </div>
      );
    }

    case "tool_result":
      return (
        <div className="pl-6 text-[var(--muted-foreground)] py-0.5">
          <pre className="whitespace-pre-wrap opacity-70"><Linkify>{event.text!}</Linkify></pre>
        </div>
      );

    case "result":
      return (
        <div className={cn(
          "pl-2 border-l-2 py-1 mt-1",
          event.subtype === "success" ? "border-[var(--success)]" : "border-[var(--error)]"
        )}>
          <div className="flex items-start gap-1.5">
            {event.subtype === "success" ? (
              <CheckCircle size={11} className="text-[var(--success)] mt-0.5 shrink-0" />
            ) : (
              <XCircle size={11} className="text-[var(--error)] mt-0.5 shrink-0" />
            )}
            <div>
              <span className={event.subtype === "success" ? "text-[var(--success)]" : "text-[var(--error)]"}>
                <MdOrText text={event.result!} />
              </span>
              {(event.cost || event.turns) && (
                <span className="text-[var(--muted-foreground)] ml-2">
                  {event.turns && `${event.turns} turns`}
                  {event.cost && ` · ${event.cost}`}
                </span>
              )}
            </div>
          </div>
        </div>
      );

    case "system":
      return (
        <div className="pl-2 border-l-2 border-[var(--muted-foreground)] py-0.5 opacity-50">
          <div className="flex items-start gap-1.5">
            <Info size={11} className="mt-0.5 shrink-0" />
            <span>{event.text}</span>
          </div>
        </div>
      );

    case "server":
      return (
        <div className="pl-2 text-[var(--muted-foreground)] py-0.5 opacity-40">
          <div className="flex items-start gap-1.5">
            <Terminal size={11} className="mt-0.5 shrink-0" />
            <span>[{event.event}] <Linkify>{event.content!}</Linkify></span>
          </div>
        </div>
      );

    default:
      return null;
  }
}

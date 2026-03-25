import { useEffect, useRef } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import "highlight.js/styles/github-dark.css";

interface MarkdownRendererProps {
  children: string;
  className?: string;
}

export function MarkdownRenderer({ children, className }: MarkdownRendererProps) {
  return (
    <div className={className || "prose prose-invert prose-sm max-w-none prose-styles"}>
      <Markdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        components={{
          // Mermaid code blocks
          code({ className: codeClass, children: codeChildren, ...props }) {
            const match = /language-(\w+)/.exec(codeClass || "");
            const lang = match?.[1];

            if (lang === "mermaid") {
              return <MermaidBlock code={String(codeChildren).trim()} />;
            }

            // Inline code (no language)
            if (!lang && !codeClass) {
              return (
                <code className="text-[var(--accent)] bg-[var(--muted)] px-1 rounded text-xs" {...props}>
                  {codeChildren}
                </code>
              );
            }

            // Block code — rehype-highlight handles syntax coloring
            return (
              <code className={codeClass} {...props}>
                {codeChildren}
              </code>
            );
          },
          // Links open in new tab
          a({ href, children: linkChildren, ...props }) {
            return (
              <a
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[var(--accent)] underline underline-offset-2 hover:opacity-80"
                {...props}
              >
                {linkChildren}
              </a>
            );
          },
          // Tables
          table({ children: tableChildren, ...props }) {
            return (
              <div className="overflow-x-auto my-2">
                <table className="text-xs border-collapse w-full" {...props}>
                  {tableChildren}
                </table>
              </div>
            );
          },
          th({ children: thChildren, ...props }) {
            return (
              <th className="text-left px-2 py-1.5 border-b border-[var(--border)] font-semibold text-[var(--foreground)]" {...props}>
                {thChildren}
              </th>
            );
          },
          td({ children: tdChildren, ...props }) {
            return (
              <td className="px-2 py-1.5 border-b border-[var(--border)] text-[var(--muted-foreground)]" {...props}>
                {tdChildren}
              </td>
            );
          },
          // Task lists
          input({ checked, ...props }) {
            return (
              <input
                type="checkbox"
                checked={checked}
                readOnly
                className="mr-1.5 accent-[var(--accent)]"
                {...props}
              />
            );
          },
        }}
      >
        {children}
      </Markdown>
    </div>
  );
}

// Mermaid diagram renderer
function MermaidBlock({ code }: { code: string }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const mermaid = (await import("mermaid")).default;
        mermaid.initialize({
          startOnLoad: false,
          theme: "dark",
          themeVariables: {
            primaryColor: "#3b82f6",
            primaryTextColor: "#fafafa",
            primaryBorderColor: "#2a2a2a",
            lineColor: "#a0a0a0",
            secondaryColor: "#1a1a1a",
            tertiaryColor: "#0a0a0a",
          },
        });
        if (ref.current && !cancelled) {
          const id = `mermaid-${Math.random().toString(36).slice(2)}`;
          const { svg } = await mermaid.render(id, code);
          if (!cancelled && ref.current) {
            ref.current.innerHTML = svg;
          }
        }
      } catch (err) {
        if (ref.current && !cancelled) {
          ref.current.textContent = `Mermaid error: ${err}`;
        }
      }
    })();
    return () => { cancelled = true; };
  }, [code]);

  return (
    <div
      ref={ref}
      className="my-2 p-2 bg-[var(--muted)] border border-[var(--border)] rounded overflow-x-auto"
    />
  );
}

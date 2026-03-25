import { useEffect, useRef } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import "highlight.js/styles/github-dark.css";

interface MarkdownRendererProps {
  children: string;
  className?: string;
}

// All text renders at 13px (matching body), headings scale up slightly
export function MarkdownRenderer({ children, className }: MarkdownRendererProps) {
  return (
    <div className={className || ""}>
      <Markdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        components={{
          h1: ({ children }) => <h1 className="text-base font-bold mt-3 mb-1 text-[var(--foreground)]">{children}</h1>,
          h2: ({ children }) => <h2 className="text-[14px] font-bold mt-3 mb-1 text-[var(--foreground)]">{children}</h2>,
          h3: ({ children }) => <h3 className="text-[13px] font-semibold mt-2 mb-1 text-[var(--foreground)]">{children}</h3>,
          h4: ({ children }) => <h4 className="text-[13px] font-semibold mt-2 mb-0.5 text-[var(--foreground)]">{children}</h4>,
          p: ({ children }) => <p className="text-[13px] leading-relaxed my-1">{children}</p>,
          li: ({ children }) => <li className="text-[13px] leading-relaxed my-0">{children}</li>,
          ul: ({ children }) => <ul className="list-disc pl-4 my-1">{children}</ul>,
          ol: ({ children }) => <ol className="list-decimal pl-4 my-1">{children}</ol>,
          blockquote: ({ children }) => (
            <blockquote className="border-l-2 border-[var(--border)] pl-3 my-1 text-[var(--muted-foreground)] text-[13px]">
              {children}
            </blockquote>
          ),
          strong: ({ children }) => <strong className="font-semibold text-[var(--foreground)]">{children}</strong>,
          em: ({ children }) => <em className="italic">{children}</em>,
          hr: () => <hr className="border-[var(--border)] my-2" />,
          pre: ({ children }) => (
            <pre className="bg-[var(--muted)] border border-[var(--border)] rounded p-2 my-1 overflow-x-auto text-[12px] leading-snug">
              {children}
            </pre>
          ),
          code({ className: codeClass, children: codeChildren, ...props }) {
            const match = /language-(\w+)/.exec(codeClass || "");
            const lang = match?.[1];

            if (lang === "mermaid") {
              return <MermaidBlock code={String(codeChildren).trim()} />;
            }

            if (!lang && !codeClass) {
              return (
                <code className="text-[var(--accent)] bg-[var(--muted)] px-1 rounded text-[12px]" {...props}>
                  {codeChildren}
                </code>
              );
            }

            return (
              <code className={codeClass} {...props}>
                {codeChildren}
              </code>
            );
          },
          a({ href, children }) {
            return (
              <a
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[var(--accent)] underline underline-offset-2 hover:opacity-80 text-[13px]"
              >
                {children}
              </a>
            );
          },
          table({ children }) {
            return (
              <div className="overflow-x-auto my-1">
                <table className="text-[13px] border-collapse w-full">{children}</table>
              </div>
            );
          },
          th({ children }) {
            return (
              <th className="text-left px-2 py-1 border-b border-[var(--border)] font-semibold text-[var(--foreground)] text-[13px]">
                {children}
              </th>
            );
          },
          td({ children }) {
            return (
              <td className="px-2 py-1 border-b border-[var(--border)] text-[var(--muted-foreground)] text-[13px]">
                {children}
              </td>
            );
          },
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

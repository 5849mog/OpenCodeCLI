"use client";

import { memo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import type { Components } from "react-markdown";
import Prism from "prismjs";
import "prismjs/components/prism-clike";
import "prismjs/components/prism-javascript";
import "prismjs/components/prism-typescript";
import "prismjs/components/prism-jsx";
import "prismjs/components/prism-tsx";
import "prismjs/components/prism-css";
import "prismjs/components/prism-json";
import "prismjs/components/prism-markup";
import "prismjs/components/prism-markdown";
import "prismjs/components/prism-bash";
import "prismjs/components/prism-python";
import "prismjs/components/prism-yaml";
import "prismjs/components/prism-go";
import "prismjs/components/prism-rust";
import "prismjs/components/prism-sql";
import { Copy, Check } from "lucide-react";
import { MermaidBlock, GraphvizBlock, ChartBlock } from "./charts";

export function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        // Fallback for non-secure contexts (e.g. plain http)
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* ignore */
    }
  };
  return (
    <button
      onClick={copy}
      className="flex h-7 w-7 shrink-0 items-center justify-center rounded transition-colors text-[#A6A6A6] hover:bg-[#F0F0F0] hover:text-[#383838] dark:text-zinc-500 dark:hover:bg-[#2A2A2A] dark:hover:text-zinc-300"
      title={copied ? "Copied" : "Copy message"}
    >
      {copied ? <Check size={14} className="text-emerald-500 dark:text-[#34d399]" /> : <Copy size={14} />}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Markdown renderer — react-markdown + remark-gfm with Prism highlighting
// ---------------------------------------------------------------------------

const PRISM_LANG_MAP: Record<string, string> = {
  javascript: "javascript",
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  typescript: "typescript",
  ts: "typescript",
  jsx: "jsx",
  tsx: "tsx",
  css: "css",
  scss: "css",
  less: "css",
  json: "json",
  jsonc: "json",
  html: "markup",
  xml: "markup",
  svg: "markup",
  markdown: "markdown",
  md: "markdown",
  bash: "bash",
  sh: "bash",
  shell: "bash",
  zsh: "bash",
  python: "python",
  py: "python",
  yaml: "yaml",
  yml: "yaml",
  go: "go",
  rust: "rust",
  rs: "rust",
  sql: "sql",
  toml: "yaml",
  diff: "bash",
  text: "markup",
  plaintext: "markup",
};

function highlightCode(code: string, lang: string): string {
  const grammarName = PRISM_LANG_MAP[lang?.toLowerCase()] || "clike";
  const grammar = Prism.languages[grammarName];
  if (!grammar) {
    try {
      return Prism.highlight(code, Prism.languages.clike, "clike");
    } catch {
      return escapeHtml(code);
    }
  }
  try {
    return Prism.highlight(code, grammar, grammarName);
  } catch {
    return escapeHtml(code);
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

const markdownComponents: Components = {
  h1: ({ children }) => (
    <h1 className="mt-3 mb-2 text-xl font-extrabold tracking-tight text-[#171717] dark:text-white">{children}</h1>
  ),
  h2: ({ children }) => (
    <h2 className="mt-3 mb-2 text-lg font-bold tracking-tight text-[#171717] dark:text-white">{children}</h2>
  ),
  h3: ({ children }) => (
    <h3 className="mt-2 mb-1 text-base font-semibold text-[#262626] dark:text-zinc-100">{children}</h3>
  ),
  h4: ({ children }) => (
    <h4 className="mt-2 mb-1 text-sm font-semibold text-[#383838] dark:text-zinc-200">{children}</h4>
  ),
  p: ({ children }) => (
    <p className="my-1.5 leading-relaxed text-[#262626] dark:text-zinc-300">{children}</p>
  ),
  ul: ({ children, ...props }) => {
    return (
      <ul className="my-1.5 ml-4 list-disc space-y-0.5 text-[#262626] dark:text-zinc-300" {...props}>
        {children}
      </ul>
    );
  },
  ol: ({ children, ...props }) => (
    <ol className="my-1.5 ml-4 list-decimal space-y-0.5 text-[#262626] dark:text-zinc-300" {...props}>
      {children}
    </ol>
  ),
  li: ({ children, ...props }) => {
    // GFM task list items: <li><input type="checkbox" ...> text
    return <li className="pl-1" {...props}>{children}</li>;
  },
  a: ({ href, children }) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-[#C08A5F] underline decoration-sky-700 hover:decoration-sky-400 dark:text-[#7dd3fc] dark:decoration-[#0369a1] dark:hover:decoration-[#38bdf8]"
    >
      {children}
    </a>
  ),
  strong: ({ children }) => (
    <strong className="font-bold text-[#171717] dark:text-white">{children}</strong>
  ),
  em: ({ children }) => <em className="italic text-[#383838] dark:text-zinc-200">{children}</em>,
  del: ({ children }) => (
    <del className="text-[#8C8C8C] line-through dark:text-zinc-500">{children}</del>
  ),
  blockquote: ({ children }) => (
    <blockquote className="my-2 border-l-2 border-[#DEDEDE] pl-3 text-[#6B6B6B] italic dark:border-[#4D4D4D] dark:text-zinc-400">
      {children}
    </blockquote>
  ),
  hr: () => <hr className="my-3 border-[#DEDEDE] dark:border-[#333333]" />,
  table: ({ children }) => (
    <div className="my-2 overflow-x-auto">
      <table className="min-w-full border-collapse text-xs">
        {children}
      </table>
    </div>
  ),
  thead: ({ children }) => (
    <thead className="border-b border-[#DEDEDE] dark:border-[#333333]">{children}</thead>
  ),
  th: ({ children }) => (
    <th className="px-2 py-1 text-left font-semibold text-[#262626] dark:text-zinc-100">{children}</th>
  ),
  td: ({ children }) => (
    <td className="px-2 py-1 border-t border-[#DEDEDE] text-[#383838] dark:border-[#333333] dark:text-zinc-300">{children}</td>
  ),
  // Inline code — the "微白框" look: soft light box with readable text,
  // never the harsh emerald. In dark mode: brighter box, near-white text.
  code: ({ className, children, ...props }) => {
    const langMatch = className ? className.match(/language-(\w+)/) : null;
    const isInline = !langMatch && !String(children).includes("\n");
    if (isInline) {
      return (
        <code
          className="rounded-md border border-[#DEDEDE] bg-[#F5F5F5] px-1.5 py-0.5 text-[length:var(--font-size-code)] font-medium text-[#383838] dark:border-[#4D4D4D] dark:bg-[#262626] dark:text-zinc-100"
          {...props}
        >
          {children}
        </code>
      );
    }
    // Fenced code block — render with Prism
    const lang = langMatch?.[1] ?? "text";
    const codeText = String(children).replace(/\n$/, "");
    const highlighted = highlightCode(codeText, lang);
    return (
      <code
        className={`language-${lang} font-mono`}
        dangerouslySetInnerHTML={{ __html: highlighted }}
      />
    );
  },
  // Wrap fenced code blocks in a styled <pre>
  pre: ({ children }) => {
    // Extract language + raw code for the header label
    let lang = "text";
    let codeText = "";
    // children is typically a single <code> element
    const child = Array.isArray(children) ? children[0] : children;
    if (child && typeof child === "object" && "props" in child) {
      const childProps = (child as { props: { className?: string; children?: unknown } }).props;
      const match = /language-(\w+)/.exec(childProps.className || "");
      if (match) lang = match[1];
      codeText = String(childProps.children ?? "").replace(/\n$/, "");
    }
    // Mermaid flowchart — render with mermaid.js
    if (lang === "mermaid") {
      return <MermaidBlock code={codeText} />;
    }
    // Graphviz / DOT — official Graphviz WASM (complex DAGs, dependency graphs)
    if (lang === "dot" || lang === "graphviz") {
      return <GraphvizBlock code={codeText} />;
    }
    // Chart.js — data charts from JSON config
    if (lang === "chart") {
      return <ChartBlock code={codeText} />;
    }
    return (
      <div className="my-2 overflow-hidden rounded-md border border-[#DEDEDE] bg-[#FFFFFF] dark:border-[#333333] dark:bg-[#0f0e0b]">
        <div className="flex items-center justify-between border-b border-[#DEDEDE] px-3 py-1 text-[length:var(--font-size-ui-sm)] uppercase tracking-wider text-[#8C8C8C] dark:border-[#333333] dark:text-zinc-500">
          <span>{lang}</span>
          <button
            onClick={() => {
              if (codeText) navigator.clipboard?.writeText(codeText);
            }}
            className="text-[#A6A6A6] hover:text-[#383838] dark:text-zinc-500 dark:hover:text-zinc-200"
            title="Copy"
          >
            copy
          </button>
        </div>
        <pre className="overflow-x-auto px-4 py-3 text-[length:var(--font-size-code)] leading-relaxed [&::-webkit-scrollbar]:h-2 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-[#D4D4D4] dark:[&::-webkit-scrollbar-thumb]:bg-[#333333]">
          {children}
        </pre>
      </div>
    );
  },
};

export const MarkdownRenderer = memo(function MarkdownRenderer({
  text,
}: {
  text: string;
}) {
  return (
    <div className="prose-invert max-w-none break-words text-[length:var(--font-size-base)]">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex]}
        components={markdownComponents}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
});

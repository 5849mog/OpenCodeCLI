"use client";

import { useEffect, useRef, useState } from "react";

// mermaid 体积巨大（~1.5MB）——动态加载，只在首次渲染 mermaid 围栏块时拉取。
// initialize 移入加载器：首次 import 成功后立即配置（时序仍早于任何 render 调用）。
let mermaidPromise: Promise<typeof import("mermaid")["default"]> | null = null;
function getMermaid() {
  if (!mermaidPromise) {
    mermaidPromise = import("mermaid").then((m) => {
      m.default.initialize({
        startOnLoad: false,
        theme: "dark",
        // 显式声明 securityLevel（mermaid 默认即 strict）——图表源码中的 HTML
        // 标签会被编码，防止 label 注入；防止未来误改为 loose/antiscript。
        securityLevel: "strict",
        themeVariables: {
          // 与整体 #E58F67 主色呼应的强调色；其余用 dark 主题默认值。
          primaryColor: "#2A2A2A",
          primaryTextColor: "#e4e4e7",
          lineColor: "#a1a1aa",
        },
      });
      return m.default;
    });
  }
  return mermaidPromise;
}

let mermaidId = 0;
export function MermaidBlock({ code }: { code: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const attemptedCode = useRef<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const isComplete = code.trim().length > 10 && code.includes('\n');
  useEffect(() => {
    if (!ref.current || !isComplete) return;
    // 每个 code 版本只尝试一次；流式期间代码增长 → 新版本自动重试，
    // 修复此前"半截代码渲染失败后被一次性锁死在错误态"的问题。
    if (attemptedCode.current === code) return;
    attemptedCode.current = code;
    const id = ++mermaidId;
    (async () => {
      try {
        const mermaid = await getMermaid();
        const { svg } = await mermaid.render('mermaid-' + id, code);
        setError(null);
        if (ref.current) ref.current.innerHTML = svg;
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    })();
  }, [code, isComplete]);
  if (error) {
    return <pre className="my-2 rounded border border-red-300/40 bg-red-50/50 px-3 py-2 text-xs text-red-600 dark:border-red-500/30 dark:bg-red-950/20 dark:text-red-400">[mermaid 渲染失败] {error}</pre>;
  }
  if (!isComplete) {
    return <pre className="text-xs text-[#8C8C8C] italic">[diagram]</pre>;
  }
  return <div ref={ref} className="my-2 flex justify-center" />;
}

// Graphviz.load() 返回的实例类型签名复杂（Format 枚举等），动态 import +
// 已 Node 冒烟验证 dot() 用法，此处用 any 保持轻量。
let graphvizPromise: Promise<any> | null = null;
async function getGraphviz() {
  if (!graphvizPromise) {
    graphvizPromise = import("@hpcc-js/wasm-graphviz").then(({ Graphviz }) => Graphviz.load());
  }
  return graphvizPromise;
}

/** Graphviz / DOT — fenced code block with language "dot".
 *  Renders DOT source (digraph G { a -> b }) as an SVG via the official
 *  Graphviz WASM. Handles complex DAGs / dependency graphs / architecture
 *  diagrams where mermaid's flowchart layout falls short. */
export function GraphvizBlock({ code }: { code: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const attemptedCode = useRef<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const isComplete = code.trim().length > 5;
  useEffect(() => {
    if (!ref.current || !isComplete) return;
    if (attemptedCode.current === code) return;
    attemptedCode.current = code;
    (async () => {
      try {
        const graphviz = await getGraphviz();
        let svg = graphviz.dot(code);
        // 深色模式适配：Graphviz 默认 fill/stroke 为纯黑，在深色背景看不清。
        // 只替换显式纯黑（用户自定义颜色不受影响）；保留用户指定的其他颜色。
        svg = svg
          .replace(/fill="black"/g, 'fill="#e4e4e7"')
          .replace(/stroke="black"/g, 'stroke="#a1a1aa"')
          .replace(/fontcolor="black"/g, 'fontcolor="#e4e4e7"');
        // XSS 面：DOT 源码完全由 AI 控制，输出 SVG 直接 innerHTML——剥掉
        // 可点击链接（href/xlink:href，来自 DOT 的 URL= 属性）与
        // <script>/<foreignObject> 标签，防注入可执行内容。
        svg = svg
          .replace(/\s(href|xlink:href)="[^"]*"/g, "")
          .replace(/<script[\s\S]*?<\/script>/gi, "")
          .replace(/<foreignObject[\s\S]*?<\/foreignObject>/gi, "");
        setError(null);
        if (ref.current) ref.current.innerHTML = svg;
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    })();
  }, [code, isComplete]);
  if (error) {
    return <pre className="my-2 rounded border border-red-300/40 bg-red-50/50 px-3 py-2 text-xs text-red-600 dark:border-red-500/30 dark:bg-red-950/20 dark:text-red-400">[dot 渲染失败] {error}</pre>;
  }
  if (!isComplete) {
    return <pre className="text-xs text-[#8C8C8C] italic">[graph]</pre>;
  }
  return <div ref={ref} className="my-2 flex justify-center" />;
}

/** Chart.js — fenced code block with language "chart".
 *  Body is a JSON config: { type, data, options }. Renders a responsive
 *  line/bar/pie/scatter chart from data (e.g. parsed by parse_csv/query_json). */
export function ChartBlock({ code }: { code: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const attemptedCode = useRef<string | null>(null);
  const chartRef = useRef<{ destroy: () => void } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const isComplete = code.trim().length > 5;
  // 卸载时销毁实例——Chart.js 持有 canvas/ResizeObserver，不 destroy 会泄漏
  useEffect(() => () => {
    chartRef.current?.destroy();
    chartRef.current = null;
  }, []);
  useEffect(() => {
    if (!canvasRef.current || !isComplete) return;
    if (attemptedCode.current === code) return;
    attemptedCode.current = code;
    (async () => {
      try {
        const config = JSON.parse(code);
        if (!config || typeof config !== "object" || !config.type || !config.data) {
          throw new Error('chart 配置需为 {type, data, options?}，如 {"type":"bar","data":{"labels":["a","b"],"datasets":[{...}]}}');
        }
        const { Chart } = await import("chart.js/auto");
        const canvas = canvasRef.current;
        if (!canvas) return;
        // 同一块 canvas 重复创建会报 "Canvas is already in use"——先销毁旧实例
        chartRef.current?.destroy();
        chartRef.current = new Chart(canvas, {
          ...config,
          options: {
            responsive: true,
            maintainAspectRatio: false,
            // 深色模式默认配色：浅色文字 + 半透明网格，用户 options 可覆盖
            color: "#e4e4e7",
            scales: {
              x: { ticks: { color: "#e4e4e7" }, grid: { color: "rgba(255,255,255,0.08)" } },
              y: { ticks: { color: "#e4e4e7" }, grid: { color: "rgba(255,255,255,0.08)" } },
            },
            ...(config.options ?? {}),
          },
        }) as unknown as { destroy: () => void };
        setError(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    })();
  }, [code, isComplete]);
  if (error) {
    return <pre className="my-2 rounded border border-red-300/40 bg-red-50/50 px-3 py-2 text-xs text-red-600 dark:border-red-500/30 dark:bg-red-950/20 dark:text-red-400">[chart 渲染失败] {error}</pre>;
  }
  if (!isComplete) {
    return <pre className="text-xs text-[#8C8C8C] italic">[chart]</pre>;
  }
  return (
    <div className="my-2 flex h-64 items-center justify-center rounded border border-[#DEDEDE] bg-[#FFFFFF] p-3 dark:border-[#333333] dark:bg-[#0f0e0b]">
      <canvas ref={canvasRef} className="max-h-full max-w-full" />
    </div>
  );
}

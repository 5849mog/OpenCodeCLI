/**
 * tsc.ts — 浏览器端完整 TypeScript 类型检查（check_types 工具直连）。
 *
 * 在 Web Worker 里跑官方 TypeScript 编译器（typescript.js，9.1MB，惰性加载），
 * 对 VFS 中上传的 TS/TSX 项目做**跨文件类型检查**（Program 级 PreEmit 诊断），
 * 可与 check_syntax（esbuild 语法检查）互补。
 *
 * 关键设计：
 *  - Worker 用独立静态文件 public/wasm/tsc-worker.js（`new Worker('/wasm/tsc-worker.js')`
 *    字符串路径，next 把 public/ 原样复制到 out/，不经打包）。初版用 Blob URL 内联
 *    内 + importScripts 加载**绝对**的 typescript.js URL，浏览器因 Blob 源是 opaque、
 *    CSP 无权限拉取绝对脚本而报 "The string did not match the expected pattern"——
 *    改为独立 worker 文件内用**相对** importScripts("./typescript.js")（worker 与
 *    typescript.js 同目录，天然同源）。
 *  - typescript.js 由构建脚本（tools/tsc/prepare.sh）从 node_modules 复制到 public/wasm。
 *  - 宿主只把「root + 该范围所有 .ts/.tsx/.json 文件的内容」一次性 postMessage
 *    给 Worker；Worker 内建内存 CompilerHost，全程只读、不回写 VFS。
 *  - 超时用 timer + worker.terminate() 强杀，防 tsc 真卡死标签页；可被 AbortSignal 取消。
 *
 * 性能预期（诚实告知）：tsc 在浏览器仍较慢，几百文件需数秒~数十秒，Worker 保证
 * 主线程不冻结；首版惰性加载 9MB，只在真正调用 check_types 时发生。
 */

import { vfs } from "../vfs";

export interface TscCheckOptions {
  /** 目录或单个 .ts/.tsx 文件路径（相对 VFS 根）。 */
  root: string;
  /** 可选：显式指定 tsconfig 路径；缺省找 root 下（或 VFS 根）的 tsconfig.json。 */
  tsconfig?: string | null;
  /** 超时毫秒；默认 120_000。 */
  timeoutMs?: number;
}

export interface TscDiagnostic {
  /** `${path}:${line}:${col}`；无位置时为 "" */
  loc: string;
  code: string;
  isError: boolean;
  message: string;
}

export interface TscCheckResult {
  ok: boolean;
  /** 统一中文错误输出（工具结果用）。 */
  output: string;
  /** 汇总数据。 */
  files: number;
  errorCount: number;
  diagnostics: TscDiagnostic[];
  durationMs: number;
  error?: string;
}

/** GitHub Pages basePath 兼容（复用 js-wasm 的 wasmUrl 逻辑）。 */
function wasmUrl(file: string): string {
  if (typeof window === "undefined") return `/${file}`;
  if (window.location.hostname.endsWith("github.io")) {
    const seg = window.location.pathname.split("/").filter(Boolean)[0] ?? "";
    return `/${seg ? seg + "/" : ""}${file}`;
  }
  return `/${file}`;
}

/** 只读收集 root 范围内的文件内容（.ts/.tsx/.js/.jsx/.json + tsconfig.json）。 */
function collectFiles(root: string): Record<string, string> {
  const map: Record<string, string> = {};
  const normRoot = root.trim().replace(/^\/+|\/+$/g, "");
  // listAllFilesSync 已限定到 normRoot 范围（若 normRoot 是文件，返回它自己）。
  const nodes = vfs.listAllFilesSync(normRoot);
  const withRoot = (p: string) => `/${p}`;
  for (const node of nodes) {
    if (node.type !== "file") continue;
    const rp = node.path; // node.path 是相对 VFS 根的路径
    if (/\.[jt]sx?$/.test(rp) || /\.json$/.test(rp) || /\.d\.ts$/.test(rp)) {
      const c = vfs.readFileSync(rp);
      if (c !== null) map[withRoot(rp)] = c;
    }
  }
  return map;
}

/** 启动 Worker（独立静态文件 public/wasm/tsc-worker.js）。每次新建并在调用后
 *  terminate，避免跨消息状态泄漏；worker 内相对 importScripts("./typescript.js")。 */
function spawnWorker(workerUrl: string): Worker {
  return new Worker(workerUrl, { type: "classic" });
}

/** Worker 生命周期管理：每次调用新建 + 用完即 terminate。 */
async function withWorker<T>(
  workerUrl: string,
  task: (w: Worker) => Promise<T>,
): Promise<T> {
  const w = spawnWorker(workerUrl);
  try {
    return await task(w);
  } finally {
    w.terminate();
  }
}

/** 对指定根做跨文件类型检查。 */
export async function checkTypes(
  options: TscCheckOptions,
  signal?: AbortSignal,
): Promise<TscCheckResult> {
  // worker 静态文件（public/wasm/tsc-worker.js，next 原样复制到 out/），相对 importScripts("./typescript.js")
  const workerUrl = wasmUrl("wasm/tsc-worker.js");
  const root = options.root.trim();
  if (!root) {
    return { ok: false, output: "check_types: 缺少 path/root", files: 0, errorCount: 0, diagnostics: [], durationMs: 0 };
  }

  // 校验 root 存在
  const st = vfs.statSync(root);
  if (!st) {
    return { ok: false, output: `check_types: 路径不存在 — ${root}`, files: 0, errorCount: 0, diagnostics: [], durationMs: 0 };
  }

  const files = collectFiles(root);
  if (Object.keys(files).length === 0) {
    return { ok: false, output: `check_types: "${root}" 下没有可检查的 .ts/.tsx 文件`, files: 0, errorCount: 0, diagnostics: [], durationMs: 0 };
  }

  const timeoutMs = options.timeoutMs ?? 120_000;
  let worker: Worker | null = null;

  try {
    return await withWorker(workerUrl, (w) => {
      worker = w;
      return new Promise<TscCheckResult>((resolve) => {
        let settled = false;
        const timer = setTimeout(() => {
          if (settled) return;
          settled = true;
          if (worker) worker.terminate();
          resolve({
            ok: false,
            output: `check_types: 超时（${Math.round(timeoutMs / 1000)}s）。tsc 对大项目较慢——可收缩 root 范围，或用 check_syntax 抽检。`,
            files: Object.keys(files).length,
            errorCount: 0, diagnostics: [], durationMs: timeoutMs,
          });
        }, timeoutMs);

        w.onmessage = (e) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          const msg = e.data;
          if (!msg.ok) {
            resolve({ ok: false, output: msg.error || "类型检查失败", files: Object.keys(files).length, errorCount: 0, diagnostics: [], durationMs: 0, error: msg.error });
            return;
          }
          const r = msg.result || {};
          const diags: TscDiagnostic[] = (r.diagnostics || []).map((line: string) => {
            const m = line.match(/^(.*?):(\d+):(\d+)\s+(.*)$/);
            if (m) {
              return { loc: `${m[1]}:${m[2]}:${m[3]}`, code: "", isError: line.includes("错误"), message: m[4] };
            }
            return { loc: "", code: "", isError: line.includes("错误"), message: line };
          });
          const summary = `${r.errorCount > 0 ? "发现类型错误" : "✓ 类型检查通过"}：检查 ${r.files ?? 0} 个文件，${r.errorCount ?? 0} 个错误，耗时 ${(r.durationMs ?? 0)}ms。`;
          const body = summary + "\n" + ((r.diagnostics || []).join("\n") || "");
          resolve({ ok: r.errorCount === 0, output: body, files: r.files ?? 0, errorCount: r.errorCount ?? 0, diagnostics: diags, durationMs: r.durationMs ?? 0 });
        };

        w.onerror = (err) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve({ ok: false, output: `check_types: Worker 错误 — ${err.message || "未知"}`, files: Object.keys(files).length, errorCount: 0, diagnostics: [], durationMs: 0, error: err.message });
        };

        if (signal) {
          signal.addEventListener("abort", () => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            if (worker) worker.terminate();
            resolve({ ok: false, output: "check_types: 已取消", files: Object.keys(files).length, errorCount: 0, diagnostics: [], durationMs: 0, error: "aborted" });
          });
        }

        w.postMessage({ files, root: root.startsWith("/") ? root : `/${root}`, tsconfig: options.tsconfig ?? null, defaultOptions: {} });
      });
    });
  } catch (e) {
    return { ok: false, output: `check_types: ${e instanceof Error ? e.message : String(e)}`, files: Object.keys(files).length, errorCount: 0, diagnostics: [], durationMs: 0, error: String(e) };
  }
}

export const tscChecker = { checkTypes, wasmUrl };

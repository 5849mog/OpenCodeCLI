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
 * 主线程不冻结；typescript.js 惰性加载 9MB，只在真正调用 check_types 时发生。
 * Worker 经 worker-client 池化复用：常驻单例，typescript.js/tslib.js 只会话首次
 * 解析一次；每次调用仍重建 CompilerHost + Program（文件内容每次不同，无法缓存）。
 */

import { vfs } from "../vfs";
import { createWorkerClient } from "./worker-client";

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

/** tsc Worker 回包（池化客户端路由后的完整消息）。 */
interface TscWorkerMsg {
  ok: boolean;
  error?: string;
  result?: {
    files?: number;
    diagnostics?: string[];
    errorCount?: number;
    noteCount?: number;
    envNoise?: boolean;
    depMissing?: boolean;
    durationMs?: number;
  };
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

/** tsc Worker 池化单例（首次 request 才创建；常驻复用，typescript.js/tslib.js
 *  只会话首次 importScripts 解析一次）。 */
const tscClient = createWorkerClient(wasmUrl("wasm/tsc-worker.js"));

/** 对指定根做跨文件类型检查。 */
export async function checkTypes(
  options: TscCheckOptions,
  signal?: AbortSignal,
): Promise<TscCheckResult> {
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
  const fileCount = Object.keys(files).length;

  try {
    const msg = await tscClient.request<TscWorkerMsg>(
      { files, root: root.startsWith("/") ? root : `/${root}`, tsconfig: options.tsconfig ?? null, defaultOptions: {} },
      { timeoutMs, signal },
    );
    if (!msg.ok) {
      return { ok: false, output: msg.error || "类型检查失败", files: fileCount, errorCount: 0, diagnostics: [], durationMs: 0, error: msg.error };
    }
    const r = msg.result || {};
    const diags: TscDiagnostic[] = (r.diagnostics || []).map((line: string) => {
      const m = line.match(/^(.*?):(\d+):(\d+)\s+\[TS\d+\s+(错误|提示)\]\s+(.*)$/);
      if (m) {
        return { loc: `${m[1]}:${m[2]}:${m[3]}`, code: "", isError: m[4] === "错误", message: m[5] };
      }
      return { loc: "", code: "", isError: line.includes("错误"), message: line };
    });
    const errC = r.errorCount ?? 0;
    const noteC = r.noteCount ?? 0;
    const filesN = r.files ?? 0;
    const ms = r.durationMs ?? 0;
    // 缺依赖检测：依赖 node_modules 的项目（react/zustand/next…）浏览器无法权威解析。
    // 软封锁——此时不列任何诊断（连锁传播产生的 2339/2322 等"看着像真错的假错"会
    // 误导 AI 去复核、白烧 token），只返回一句说明，请用户本地 tsc。
    if (r.depMissing) {
      const body =
        `⚠️ 该项目依赖 \`node_modules\`（第三方模块无法在浏览器解析），浏览器无法进行权威的类型检查。\n` +
        `  为免误导，本工具不列出诊断（约 ${noteC} 条为模块/全局缺失类噪声，其余多为连锁传播的假错误）。\n` +
        `  请在本地装好 \`node_modules\` 后运行 \`npx tsc --noEmit\` 获取权威结果。\n` +
        `  提示：对自包含（无第三方依赖）的 TS/TSX 项目，check_types 结果才是可信的。`;
      return { ok: true, output: body, files: filesN, errorCount: 0, diagnostics: [], durationMs: ms };
    }
    let summary = errC > 0
      ? `发现 ${errC} 个类型错误`
      : `✓ 类型检查通过（${noteC} 条环境噪声已被列为提示）`;
    summary += `：检查 ${filesN} 个文件，耗时 ${ms}ms。`;
    // 环境边界：浏览器无 node_modules，第三方模块解析失败产生的噪声单独说明，
    // 避免用户误以为是真实代码错误。
    if (r.envNoise) {
      summary += `\n  ⚠️ 环境边界：浏览器无法解析第三方模块（react/zustand/…），其中 ${noteC} 条 "Cannot find module / implicit any" 类已被降为「提示」；上方标「错误」的才可能是真实代码问题。有 node_modules 的项目请用本地 \`tsc\` 做权威类型检查。`;
    }
    const body = summary + "\n" + ((r.diagnostics || []).join("\n") || "");
    return { ok: errC === 0, output: body, files: filesN, errorCount: errC, diagnostics: diags, durationMs: ms };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.startsWith("worker 请求超时")) {
      return { ok: false, output: `check_types: 超时（${Math.round(timeoutMs / 1000)}s）。tsc 对大项目较慢——可收缩 root 范围，或用 check_syntax 抽检。`, files: fileCount, errorCount: 0, diagnostics: [], durationMs: timeoutMs, error: msg };
    }
    if (signal?.aborted) {
      return { ok: false, output: "check_types: 已取消", files: fileCount, errorCount: 0, diagnostics: [], durationMs: 0, error: "aborted" };
    }
    return { ok: false, output: `check_types: ${msg}`, files: fileCount, errorCount: 0, diagnostics: [], durationMs: 0, error: msg };
  }
}

export const tscChecker = { checkTypes, wasmUrl };

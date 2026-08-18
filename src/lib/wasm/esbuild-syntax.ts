/**
 * esbuild-syntax.ts — esbuild Web Worker 宿主桥接层（check_syntax 目录遍历 + transpile 目录转译）。
 *
 * checkSyntaxDir：对 VFS 中的目录做**语法**检查（esbuild + JSON.parse，非类型检查），
 * 遍历目录下所有测试源文件，逐个校验，在 Worker 里跑（不卡主线程），输出只回错误文件
 * + 汇总，正常文件不逐行回（防上下文爆炸）。
 *
 * transpileDir：对 VFS 中的目录做**转译**（ts/tsx/js/jsx/mjs/cjs → JS，esbuild transform
 * 与主线程 esbuild.ts 一致：target es2018 / format esm），Worker 返回每文件 JS，host
 * 写回 VFS（产物 = 文件，编译器语义）。不传 outDir 时写在源码旁（foo.ts → foo.js，tsc
 * 语义）；传 outDir 时按源码目录结构镜像写入。.d.ts / json / 其他扩展名跳过。
 *
 * 与 check_types（tsc）互补：check_syntax 快、查语法；check_types 全、查类型。
 *
 * Worker: public/wasm/esbuild-syntax-worker.js（静态文件，importScripts 加载
 * esbuild-browser.js → self.esbuild → fetch esbuild.wasm，worker 线程实例化）。
 */

import { vfs } from "../vfs";

export interface SyntaxDirOptions {
  /** VFS 中的目录（或单文件）路径。 */
  path: string;
  /** 超时毫秒；默认 120_000。 */
  timeoutMs?: number;
}

export interface SyntaxDirResult {
  ok: boolean;
  /** 统一中文输出。 */
  output: string;
  totalFiles: number;
  supported: number;
  skipCount: number;
  errorFiles: string[];
  durationMs: number;
  error?: string;
}

/** GitHub Pages basePath 兼容（复用 esbuild.ts 的 wasmUrl 逻辑）。 */
function wasmUrl(file: string): string {
  if (typeof window === "undefined") return `/${file}`;
  if (window.location.hostname.endsWith("github.io")) {
    const seg = window.location.pathname.split("/").filter(Boolean)[0] ?? "";
    return `/${seg ? seg + "/" : ""}${file}`;
  }
  return `/${file}`;
}

/** 只读收集目录下所有候选源文件内容（.ts/.tsx/.js/.jsx/.mjs/.cjs/.json；其他扩展名
 *  也收集，宿主侧 worker 会归为「不支持」计数）。若 path 是单文件，只收集它。 */
function collectFiles(path: string): Record<string, string> {
  const map: Record<string, string> = {};
  const nodes = vfs.listAllFilesSync(path);
  for (const node of nodes) {
    if (node.type !== "file") continue;
    const c = vfs.readFileSync(node.path);
    if (c !== null) map[`/${node.path}`] = c;
  }
  return map;
}

/* ────────────────────────── transpile 目录转译 ────────────────────────── */

const JS_EXT_MAP: Record<string, string> = {
  ts: "js", tsx: "js", jsx: "js", js: "js", mjs: "mjs", cjs: "cjs",
};

/** 源文件相对路径 → 产物相对路径（扩展名替换 ts/tsx/jsx→js，js/mjs/cjs 保留；
 *  .d.ts / 无扩展名 / 不支持扩展名 → null（跳过）。纯函数，供 dispatch 与测试复用。 */
export function transpileDestRel(base: string): string | null {
  const slash = base.lastIndexOf("/");
  const dir = slash >= 0 ? base.slice(0, slash + 1) : "";
  const name = slash >= 0 ? base.slice(slash + 1) : base;
  if (/\.d\.ts$/i.test(name)) return null;
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return null;
  const ext = name.slice(dot + 1).toLowerCase();
  const outExt = JS_EXT_MAP[ext];
  if (!outExt) return null;
  return dir + name.slice(0, dot) + "." + outExt;
}

/** outDir + 相对产物路径 → VFS 绝对路径（自动补前导 /、去重斜杠）。 */
export function joinOutDir(outDir: string, rel: string): string {
  const a = outDir.replace(/^\/+|\/+$/g, "");
  const b = rel.replace(/^\/+/, "");
  return `/${a}/${b}`;
}

/** 字节数 → 人类可读（"1.2KB" / "890B"）。 */
function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  return `${(bytes / 1024).toFixed(1)}KB`;
}

export interface TranspileDirOptions {
  /** VFS 中的目录（或单文件）路径。 */
  path: string;
  /** 可选。产物镜像目录（如 /dist）；不传则写在源码旁（tsc 语义）。 */
  outDir?: string;
  /** 超时毫秒；默认 120_000。 */
  timeoutMs?: number;
}

export interface TranspileDirResult {
  ok: boolean;
  /** 统一中文输出。 */
  output: string;
  totalFiles: number;
  supported: number;
  skipCount: number;
  /** 实际写入 VFS 的产物文件数。 */
  writtenFiles: number;
  errorFiles: string[];
  durationMs: number;
  error?: string;
}

/** 对指定目录做转译（Worker 隔离），产物写入 VFS。 */
export async function transpileDir(
  options: TranspileDirOptions,
  signal?: AbortSignal,
): Promise<TranspileDirResult> {
  const p = options.path.trim();
  if (!p) {
    return { ok: false, output: "transpile: 缺少 path（目录）", totalFiles: 0, supported: 0, skipCount: 0, writtenFiles: 0, errorFiles: [], durationMs: 0 };
  }
  const st = vfs.statSync(p);
  if (!st) {
    return { ok: false, output: `transpile: 路径不存在 — ${p}`, totalFiles: 0, supported: 0, skipCount: 0, writtenFiles: 0, errorFiles: [], durationMs: 0 };
  }
  const files = collectFiles(p);
  const fileCount = Object.keys(files).length;
  if (fileCount === 0) {
    return { ok: false, output: `transpile: "${p}" 下没有可转译的源文件`, totalFiles: 0, supported: 0, skipCount: 0, writtenFiles: 0, errorFiles: [], durationMs: 0 };
  }

  const workerUrl = wasmUrl("wasm/esbuild-syntax-worker.js");
  const timeoutMs = options.timeoutMs ?? 120_000;

  try {
    return await new Promise<TranspileDirResult>((resolve) => {
      const w = new Worker(workerUrl, { type: "classic" });
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        w.terminate();
        resolve({ ok: false, output: `transpile: 超时（${Math.round(timeoutMs / 1000)}s）。目录过大或 esbuild 未就绪，可收缩目录或分批。`, totalFiles: fileCount, supported: 0, skipCount: 0, writtenFiles: 0, errorFiles: [], durationMs: timeoutMs });
      }, timeoutMs);

      w.onmessage = (e) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        const msg = e.data;
        if (!msg.ok) {
          resolve({ ok: false, output: msg.error || "转译失败", totalFiles: fileCount, supported: 0, skipCount: 0, writtenFiles: 0, errorFiles: [], durationMs: 0, error: msg.error });
          return;
        }
        const r = msg.result || {};
        // 写回 VFS：worker 返回每文件 JS，host 计算目标路径并写入（自动建目录）。
        const written: string[] = [];
        let writtenBytes = 0;
        let writtenFiles = 0;
        const outputs: { base: string; js: string }[] = r.outputs || [];
        const outDir = options.outDir && options.outDir.trim() ? options.outDir.trim() : undefined;
        for (const o of outputs) {
          const rel = transpileDestRel(o.base);
          if (!rel) continue;
          const dest = outDir ? joinOutDir(outDir, rel) : `/${rel}`;
          vfs.writeFileSync(dest, o.js);
          writtenFiles++;
          writtenBytes += o.js.length;
          written.push(`  ✓ ${o.base} → ${dest}（${fmtSize(o.js.length)}）`);
        }
        // 防爆：写入清单与错误都只列前 30 + "还有 X 个"。
        const CAP = 30;
        const diags: string[] = r.diagnostics || [];
        const shown = diags.slice(0, CAP);
        const more = diags.length - shown.length;
        const writtenShown = written.slice(0, CAP);
        const moreWritten = written.length - writtenShown.length;
        let body = r.summary || "";
        body += `\n产物已写入 VFS：${writtenFiles} 个文件，共 ${fmtSize(writtenBytes)}`;
        if (writtenShown.length) body += `\n${writtenShown.join("\n")}`;
        if (moreWritten > 0) body += `\n… 还有 ${moreWritten} 个已写入（用 ls/cat 查看具体产物）`;
        if (shown.length) body += `\n${shown.join("\n")}`;
        if (more > 0) body += `\n… 还有 ${more} 个转译失败文件`;
        resolve({ ok: r.ok !== false, output: body, totalFiles: r.totalFiles ?? fileCount, supported: r.supported ?? 0, skipCount: r.skipCount ?? 0, writtenFiles, errorFiles: r.errorFiles || [], durationMs: r.durationMs ?? 0 });
      };

      w.onerror = (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        w.terminate();
        resolve({ ok: false, output: `transpile: Worker 错误 — ${err.message || "未知"}`, totalFiles: fileCount, supported: 0, skipCount: 0, writtenFiles: 0, errorFiles: [], durationMs: 0, error: err.message });
      };

      if (signal) {
        signal.addEventListener("abort", () => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          w.terminate();
          resolve({ ok: false, output: "transpile: 已取消", totalFiles: fileCount, supported: 0, skipCount: 0, writtenFiles: 0, errorFiles: [], durationMs: 0, error: "aborted" });
        });
      }

      w.postMessage({ root: p.startsWith("/") ? p : `/${p}`, files, mode: "transpile" });
    });
  } catch (e) {
    return { ok: false, output: `transpile: ${e instanceof Error ? e.message : String(e)}`, totalFiles: fileCount, supported: 0, skipCount: 0, writtenFiles: 0, errorFiles: [], durationMs: 0, error: String(e) };
  }
}

/** 对指定目录做语法检查（Worker 隔离）。 */
export async function checkSyntaxDir(
  options: SyntaxDirOptions,
  signal?: AbortSignal,
): Promise<SyntaxDirResult> {
  const p = options.path.trim();
  if (!p) {
    return { ok: false, output: "check_syntax: 缺少 path（目录）", totalFiles: 0, supported: 0, skipCount: 0, errorFiles: [], durationMs: 0 };
  }
  const st = vfs.statSync(p);
  if (!st) {
    return { ok: false, output: `check_syntax: 路径不存在 — ${p}`, totalFiles: 0, supported: 0, skipCount: 0, errorFiles: [], durationMs: 0 };
  }
  const files = collectFiles(p);
  const fileCount = Object.keys(files).length;
  if (fileCount === 0) {
    return { ok: false, output: `check_syntax: "${p}" 下没有可检查的源文件`, totalFiles: 0, supported: 0, skipCount: 0, errorFiles: [], durationMs: 0 };
  }

  const workerUrl = wasmUrl("wasm/esbuild-syntax-worker.js");
  const timeoutMs = options.timeoutMs ?? 120_000;

  try {
    return await new Promise<SyntaxDirResult>((resolve) => {
      const w = new Worker(workerUrl, { type: "classic" });
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        w.terminate();
        resolve({ ok: false, output: `check_syntax: 超时（${Math.round(timeoutMs / 1000)}s）。目录过大或 esbuild 未就绪，可收缩目录或分批。`, totalFiles: fileCount, supported: 0, skipCount: 0, errorFiles: [], durationMs: timeoutMs });
      }, timeoutMs);

      w.onmessage = (e) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        const msg = e.data;
        if (!msg.ok) {
          resolve({ ok: false, output: msg.error || "语法检查失败", totalFiles: fileCount, supported: 0, skipCount: 0, errorFiles: [], durationMs: 0, error: msg.error });
          return;
        }
        const r = msg.result || {};
        // 防爆：错误文件超上限只列前 30 + "还有 X 个"；OK 文件已由 worker 汇总为 okFiles。
        const ERROR_LINE_CAP = 30;
        const diags: string[] = r.diagnostics || [];
        const shown = diags.slice(0, ERROR_LINE_CAP);
        const more = diags.length - shown.length;
        let body = r.summary || "";
        body += "\n" + shown.join("\n");
        if (more > 0) body += `\n… 还有 ${more} 个含错文件（用 check_syntax 单个文件精查）`;
        resolve({ ok: r.ok !== false, output: body, totalFiles: r.totalFiles ?? fileCount, supported: r.supported ?? 0, skipCount: r.skipCount ?? 0, errorFiles: r.errorFiles || [], durationMs: r.durationMs ?? 0 });
      };

      w.onerror = (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        w.terminate();
        resolve({ ok: false, output: `check_syntax: Worker 错误 — ${err.message || "未知"}`, totalFiles: fileCount, supported: 0, skipCount: 0, errorFiles: [], durationMs: 0, error: err.message });
      };

      if (signal) {
        signal.addEventListener("abort", () => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          w.terminate();
          resolve({ ok: false, output: "check_syntax: 已取消", totalFiles: fileCount, supported: 0, skipCount: 0, errorFiles: [], durationMs: 0, error: "aborted" });
        });
      }

      w.postMessage({ root: p.startsWith("/") ? p : `/${p}`, files });
    });
  } catch (e) {
    return { ok: false, output: `check_syntax: ${e instanceof Error ? e.message : String(e)}`, totalFiles: fileCount, supported: 0, skipCount: 0, errorFiles: [], durationMs: 0, error: String(e) };
  }
}

export const esbuildSyntax = { checkSyntaxDir, transpileDir, wasmUrl, transpileDestRel, joinOutDir };

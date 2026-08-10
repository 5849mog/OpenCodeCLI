/**
 * sed-wasm.ts — WebAssembly GNU sed 引擎（bash 的 sed 命令直连）
 *
 * 用 <script> 标签加载 emscripten 的输出（经典脚本），
 * 工厂函数注册到 window.SedModule，全程不经过打包器模块解析。
 *
 * 每次求值创建一个新的 wasm 实例（wasm Module 预编译缓存，仅实例化）。
 * 降级: wasm 不可用时回退到 JS 实现（src/lib/tools/sed.ts 的 runSed）。
 *
 * 输入编排（匹配真实 sed 语义）：
 *   - argv 由调用方（bash.ts）完整构造：旗标 + 脚本 + 输入文件名
 *     （如 ['-E','-n','s/a/b/p','file.txt']）；脚本经位置参数或 -e/-f 提供
 *   - files 注入 argv 中出现的每个文件的 MEMFS 同名副本（含 -f 脚本文件），
 *     先建父目录；sed 读到的只是内存副本，与真实 VFS 隔离
 *   - stdin 经 emscripten stdin 回调喂字节（无文件参数时 sed 读 stdin）
 *
 * 注意：接口刻意用「完整 argv + files 内容表」而非 awk 的 script/args 分离——
 *   sed 的 -f 脚本文件与数据文件都在 files 里，若像 awk 那样把 files 键全
 *   追加到 argv 会把 -f 脚本文件二次当作输入文件（2026-08 设计时踩坑）。
 */

import { runSed } from "../tools/sed";

let wasmBinary: ArrayBuffer | null = null;
let sedFactory: ((opts: Record<string, unknown>) => Promise<Record<string, unknown>>) | null = null;
let wasmReady = false;
let initPromise: Promise<boolean> | null = null;

/** Max chars allowed from a single sed evaluation. Prevents AI context overflow. */
const MAX_SED_OUTPUT_LENGTH = 20_000;

// ─── 路径解析 ────────────────────────────────────────────────────

function wasmUrl(file: string): string {
  const { hostname, pathname } = window.location;
  if (hostname.includes('github.io')) {
    const seg = pathname.split('/').filter(Boolean);
    if (seg.length > 0 && seg[0] !== '_next') return `/${seg[0]}/wasm/${file}`;
  }
  return `/wasm/${file}`;
}

// ─── <script> 加载器（绕过打包器） ───────────────────────────────

function loadScript(url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = url;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error(`loadScript failed: ${url}`));
    document.head.appendChild(s);
  });
}

// ─── 初始化 ───────────────────────────────────────────────────────

async function init(): Promise<boolean> {
  if (wasmReady) return true;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    try {
      // 1. 加载 <script> 标签（emscripten 粘合剂）→ window.SedModule
      await loadScript(wasmUrl('sed.js'));
      const factory = (window as any).SedModule;
      if (typeof factory !== 'function') throw new Error('SedModule not found');
      sedFactory = factory;

      // 2. 获取 wasm 二进制（预缓存，避免每次 fetch）
      const wasmResp = await fetch(wasmUrl('sed.wasm'));
      if (!wasmResp.ok) throw new Error(`sed.wasm HTTP ${wasmResp.status}`);
      wasmBinary = await wasmResp.arrayBuffer();

      // 3. 暖机测试（验证 wasm 端到端可用）
      const test = await createInstance({ argv: ['s/hi/bye/'], stdin: 'hi\n' });
      if (!test.ok || test.output !== 'bye') throw new Error(`warm-up failed: ${test.output}`);

      wasmReady = true;
      return true;
    } catch (err) {
      console.warn('[sed-wasm] init failed, using JS fallback:', err);
      wasmReady = false;
      return false;
    }
  })();

  return initPromise;
}

// ─── 创建实例 ─────────────────────────────────────────────────────

export interface SedOptions {
  /** 完整 argv：旗标 + 脚本 + 输入文件名，如 ['-E','-n','s/a/b/p','file.txt']。
   *  脚本可为位置参数，或经 -e 'script' / -f 'script.sed'（此时 script 不进 argv）。 */
  argv: string[];
  /** 文件名→内容，写入 MEMFS 同名文件（argv 里出现的每个文件都需在此提供，
   *  含 -f 脚本文件）。 */
  files?: Record<string, string>;
  /** 管道输入（stdin），无文件参数时 sed 读它 */
  stdin?: string;
  /** JS 降级入参（wasm 不可用时用）：脚本文本 + 输入内容 */
  fallback?: { script: string; content: string };
}

export interface SedResult {
  ok: boolean;
  output: string;
}

/** mkdir -p 父目录，让 FS.writeFile 支持嵌套文件名（如 "sub/file.txt"）。 */
function ensureParentDirs(fs: { mkdir(p: string): void }, path: string): void {
  const parts = path.split('/').filter(Boolean);
  let cur = '';
  for (let k = 0; k < parts.length - 1; k++) {
    cur += '/' + parts[k];
    try { fs.mkdir(cur); } catch { /* 已存在 */ }
  }
}

async function createInstance(opts: SedOptions): Promise<SedResult> {
  const stdout: string[] = [];
  const stderr: string[] = [];

  // stdin → emscripten stdin 回调喂字节（null=EOF），与 awk/bc 相同机制。
  const inputBuf = opts.stdin !== undefined ? new TextEncoder().encode(opts.stdin) : null;
  let inputPos = 0;

  const inst = (await sedFactory!({
    print: (t: unknown) => stdout.push(String(t)),
    printErr: (t: unknown) => stderr.push(String(t)),
    stdin: () => (inputBuf !== null && inputPos < inputBuf.length ? inputBuf[inputPos++] : null),
    // 提供 wasm 二进制 + locateFile，让 emscripten 内部处理实例化
    wasmBinary: wasmBinary,
    locateFile: (path: string) => wasmUrl(path),
  })) as Record<string, unknown>;

  // 文件参数 → MEMFS（先建父目录）
  const files = opts.files ?? {};
  const FS = inst.FS as { writeFile(p: string, d: Uint8Array): void; mkdir(p: string): void };
  for (const [name, content] of Object.entries(files)) {
    ensureParentDirs(FS, name);
    FS.writeFile(name, new TextEncoder().encode(content));
  }

  const callMain = inst.callMain as (args: string[]) => void;
  callMain(opts.argv);

  const errOutput = stderr.join('\n').trim();
  if (errOutput) return { ok: false, output: errOutput };

  let outOutput = stdout.join('\n').trim();
  if (outOutput.length > MAX_SED_OUTPUT_LENGTH) {
    outOutput = outOutput.slice(0, MAX_SED_OUTPUT_LENGTH) +
      `\n\n[... sed output truncated at ${MAX_SED_OUTPUT_LENGTH.toLocaleString()} chars; ` +
      `original output was ${outOutput.length.toLocaleString()} chars ` +
      `(${outOutput.split('\n').length} lines) — ` +
      `re-run with a more selective script for full result]`;
  }
  return { ok: true, output: outOutput || '(no output)' };
}

// ─── 降级 JS 实现 ────────────────────────────────────────────────

function jsFallback(fb?: { script: string; content: string }): SedResult {
  if (!fb) return { ok: false, output: 'sed: native engine unavailable' };
  return runSed(fb.script, fb.content);
}

// ─── 公开 API ─────────────────────────────────────────────────────

export async function evaluate(opts: SedOptions): Promise<SedResult> {
  if (!wasmReady && !initPromise) {
    await init();
  } else if (!wasmReady && initPromise) {
    await initPromise;
  }

  if (wasmReady && sedFactory && wasmBinary) {
    try {
      return await createInstance(opts); // wasm 结果为准（含 stderr 报错）
    } catch (err) {
      console.warn('[sed-wasm] evaluate error, falling back:', err);
    }
  }

  return jsFallback(opts.fallback);
}

export async function isAvailable(): Promise<boolean> {
  if (wasmReady) return true;
  return init();
}

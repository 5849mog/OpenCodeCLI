/**
 * awk-wasm.ts — WebAssembly awk 引擎（主线层直连）
 *
 * 用 <script> 标签加载 emscripten 的输出（经典脚本），
 * 工厂函数注册到 window.AWKModule，全程不经过打包器模块解析。
 *
 * 每次求值创建一个新的 wasm 实例（wasm Module 预编译缓存，仅实例化）。
 * 降级: wasm 不可用时自动回退到 JS 实现（src/lib/tools/awk.ts 的 runAwk）。
 *
 * 输入编排（匹配真实 awk 语义）：
 *   - 有文件参数 → 内容写 MEMFS 同名文件并出现在 argv（保 FILENAME/FNR）
 *   - 只有管道 stdin → emscripten stdin 回调喂字节（FILENAME 保持 ""）
 *   - 两者皆无 → 空 stdin，只有 BEGIN/END 运行
 */

import { runAwk } from "../tools/awk";

let wasmBinary: ArrayBuffer | null = null;
let awkFactory: ((opts: Record<string, unknown>) => Promise<Record<string, unknown>>) | null = null;
let wasmReady = false;
let initPromise: Promise<boolean> | null = null;

/** Max chars allowed from a single awk evaluation. Prevents AI context overflow. */
const MAX_AWK_OUTPUT_LENGTH = 20_000;

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
      // 1. 加载 <script> 标签（emscripten 粘合剂）→ window.AWKModule
      await loadScript(wasmUrl('awk.js'));
      const factory = (window as any).AWKModule;
      if (typeof factory !== 'function') throw new Error('AWKModule not found');
      awkFactory = factory;

      // 2. 获取 wasm 二进制（预缓存，避免每次 fetch）
      const wasmResp = await fetch(wasmUrl('awk.wasm'));
      if (!wasmResp.ok) throw new Error(`awk.wasm HTTP ${wasmResp.status}`);
      wasmBinary = await wasmResp.arrayBuffer();

      // 3. 暖机测试（验证 wasm 端到端可用）
      const test = await createInstance('BEGIN{print 6*7}', {});
      if (!test.ok) throw new Error(`warm-up failed: ${test.output}`);

      wasmReady = true;
      return true;
    } catch (err) {
      console.warn('[awk-wasm] init failed, using JS fallback:', err);
      wasmReady = false;
      return false;
    }
  })();

  return initPromise;
}

// ─── 创建实例 ─────────────────────────────────────────────────────

export interface AwkOptions {
  /** awk 程序文本，如 'BEGIN{print 6*7}' 或 '{print $2}' */
  script: string;
  /** 旗标，置于 script 之前，如 ["-F,", "-v", "x=1"] */
  args?: string[];
  /** 文件名→内容，写入 MEMFS 同名文件并出现在 argv（保留 FILENAME/FNR） */
  files?: Record<string, string>;
  /** 管道输入（stdin） */
  stdin?: string;
}

export interface AwkResult {
  ok: boolean;
  output: string;
}

/** mkdir -p 父目录，让 FS.writeFile 支持嵌套文件名（如 "sub/x.csv"）。 */
function ensureParentDirs(fs: { mkdir(p: string): void }, path: string): void {
  const parts = path.split('/').filter(Boolean);
  let cur = '';
  for (let k = 0; k < parts.length - 1; k++) {
    cur += '/' + parts[k];
    try { fs.mkdir(cur); } catch { /* 已存在 */ }
  }
}

async function createInstance(script: string, opts: Omit<AwkOptions, "script">): Promise<AwkResult> {
  const stdout: string[] = [];
  const stderr: string[] = [];

  // awk 经 C stdio 读 fd 0（getc/ungetc）→ 用 stdin 回调喂字节、null=EOF（与 bc 相同机制）。
  const inputBuf = opts.stdin !== undefined ? new TextEncoder().encode(opts.stdin) : null;
  let inputPos = 0;

  const inst = (await awkFactory!({
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

  // argv = 旗标 + script + 文件们
  const callMain = inst.callMain as (args: string[]) => void;
  callMain([...(opts.args ?? []), script, ...Object.keys(files)]);

  const errOutput = stderr.join('\n').trim();
  if (errOutput) return { ok: false, output: errOutput };

  let outOutput = stdout.join('\n').trim();
  if (outOutput.length > MAX_AWK_OUTPUT_LENGTH) {
    outOutput = outOutput.slice(0, MAX_AWK_OUTPUT_LENGTH) +
      `\n\n[... awk output truncated at ${MAX_AWK_OUTPUT_LENGTH.toLocaleString()} chars; ` +
      `original output was ${outOutput.length.toLocaleString()} chars ` +
      `(${outOutput.split('\n').length} lines) — ` +
      `re-run with a more selective program for full result]`;
  }
  return { ok: true, output: outOutput || '(no output)' };
}

// ─── 降级 JS 实现 ────────────────────────────────────────────────

/** 从 argv 旗标里解析 -F 分隔符（-F<sep> 附着 / -F <sep> 分离），供 JS 降级用。 */
function parseFieldSep(args: string[] | undefined): string | RegExp | undefined {
  if (!args) return undefined;
  for (let i = 0; i < args.length; i++) {
    const t = args[i];
    if (t === '-F' && args[i + 1] !== undefined) return args[i + 1];
    if (t.startsWith('-F') && t.length > 2) return t.slice(2);
  }
  return undefined;
}

function jsFallback(script: string, opts: AwkOptions): AwkResult {
  if (!script.trim()) return { ok: false, output: 'awk: missing script' };
  const content = opts.stdin ?? (opts.files ? Object.values(opts.files)[0] ?? '' : '');
  try {
    return { ok: true, output: runAwk(script, content, parseFieldSep(opts.args) ?? /\s+/) };
  } catch {
    return { ok: false, output: 'awk: evaluation failed' };
  }
}

// ─── 公开 API ─────────────────────────────────────────────────────

export async function evaluate(opts: AwkOptions): Promise<AwkResult> {
  if (!wasmReady && !initPromise) {
    await init();
  } else if (!wasmReady && initPromise) {
    await initPromise;
  }

  if (wasmReady && awkFactory && wasmBinary) {
    try {
      return await createInstance(opts.script, opts); // wasm 结果为准（含 stderr 报错）
    } catch (err) {
      console.warn('[awk-wasm] evaluate error, falling back:', err);
    }
  }

  return jsFallback(opts.script, opts);
}

export async function isAvailable(): Promise<boolean> {
  if (wasmReady) return true;
  return init();
}

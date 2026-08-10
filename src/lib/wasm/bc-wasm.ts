/**
 * bc-wasm.ts — WebAssembly bc 引擎（主线层直连）
 *
 * 用 <script> 标签加载 emscripten 的输出（经典脚本），
 * 工厂函数注册到 window.BCModule，全程不经过打包器模块解析。
 *
 * 每次求值创建一个新的 wasm 实例（wasm Module 预编译缓存，仅实例化）。
 * 降级: wasm 不可用时自动回退到 JS 实现（evalArithmetic 安全解析器，无 eval）。
 */

import { evalArithmetic } from "../math-eval";

let wasmBinary: ArrayBuffer | null = null;
let bcFactory: ((opts: Record<string, unknown>) => Promise<Record<string, unknown>>) | null = null;
let wasmReady = false;
let initPromise: Promise<boolean> | null = null;

/** Max chars allowed from a single bc evaluation. Prevents AI context overflow
 *  from astronomical numbers (e.g. 2^1000000 outputs ~300K digits). */
const MAX_BC_OUTPUT_LENGTH = 10_000;

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
      // 1. 加载 <script> 标签（emscripten 粘合剂）
      //    UMD 回退到 window.BCModule
      await loadScript(wasmUrl('bc.js'));
      const factory = (window as any).BCModule;
      if (typeof factory !== 'function') throw new Error('BCModule not found');
      bcFactory = factory;

      // 2. 获取 wasm 二进制（预缓存，避免每次 fetch）
      const wasmResp = await fetch(wasmUrl('bc.wasm'));
      if (!wasmResp.ok) throw new Error(`bc.wasm HTTP ${wasmResp.status}`);
      wasmBinary = await wasmResp.arrayBuffer();

      // 3. 暖机测试（同时验证 -l 模式）
      const test = await createInstance('1+1', { useMathLib: true });
      if (!test.ok) throw new Error(`warm-up failed: ${test.output}`);

      wasmReady = true;
      return true;
    } catch (err) {
      console.warn('[bc-wasm] init failed, using JS fallback:', err);
      wasmReady = false;
      return false;
    }
  })();

  return initPromise;
}

// ─── 创建实例 ─────────────────────────────────────────────────────

interface InstanceOptions {
  useMathLib?: boolean;
}

interface InstanceResult {
  ok: boolean;
  output: string;
}

async function createInstance(expr: string, opts?: InstanceOptions): Promise<InstanceResult> {
  const stdout: string[] = [];
  const stderr: string[] = [];

  const inputBuf = new TextEncoder().encode(expr + '\n');
  let inputPos = 0;

  const inst = (await bcFactory!({
    print: (t: unknown) => stdout.push(String(t)),
    printErr: (t: unknown) => stderr.push(String(t)),
    stdin: () => (inputPos < inputBuf.length ? inputBuf[inputPos++] : null),
    // 提供 wasm 二进制 + locateFile，让 emscripten 内部处理实例化
    // （避免我们自己实现 instantiateWasm 时漏传 module 参数导致崩溃）
    wasmBinary: wasmBinary,
    locateFile: (path: string) => wasmUrl(path),
  })) as Record<string, unknown>;

  const callMain = inst.callMain as (args: string[]) => void;
  const bcArgs = opts?.useMathLib ? ['-q', '-l'] : ['-q'];
  callMain(bcArgs);

  const errOutput = stderr.join('\n').trim();
  if (errOutput) return { ok: false, output: errOutput };

  let outOutput = stdout.join('\n').trim();
  if (outOutput.length > MAX_BC_OUTPUT_LENGTH) {
    outOutput = outOutput.slice(0, MAX_BC_OUTPUT_LENGTH) +
      `\n\n[... bc output truncated at ${MAX_BC_OUTPUT_LENGTH.toLocaleString()} chars; ` +
      `original output was ${outOutput.length.toLocaleString()} chars ` +
      `(${outOutput.split('\n').length} lines) — ` +
      `re-run with a smaller scale / narrower expression for full result]`;
  }
  return { ok: true, output: outOutput || '(no output)' };
}

// ─── 降级 JS 实现 ────────────────────────────────────────────────

function jsFallback(expr: string, stdin?: string): InstanceResult {
  let calcExpr: string;
  let calcScale = 0;

  if (stdin) {
    calcExpr = stdin.trim();
  } else {
    calcExpr = expr;
  }

  if (!calcExpr) return { ok: false, output: 'bc: missing expression' };

  const sm = calcExpr.match(/\bscale\s*=\s*(\d+)\b/);
  if (sm) {
    calcScale = parseInt(sm[1], 10);
    calcExpr = calcExpr.replace(/\bscale\s*=\s*\d+\s*[;,]\s*/g, '');
  }

  try {
    // 安全解析器（无 eval）：数字 + 运算符 + 显式注册的数学函数/常量
    const result = evalArithmetic(calcExpr, {
      functions: {
        sqrt: Math.sqrt, s: Math.sin, c: Math.cos, a: Math.atan,
        l: Math.log, e: Math.exp, abs: Math.abs, floor: Math.floor, ceil: Math.ceil,
      },
      constants: { pi: Math.PI },
    });
    if (calcScale > 0) {
      return { ok: true, output: (result as number).toFixed(calcScale) };
    }
    return { ok: true, output: String(result) };
  } catch {
    return { ok: false, output: 'bc: expression evaluation failed' };
  }
}

// ─── 公开 API ─────────────────────────────────────────────────────

export interface BcOptions {
  useMathLib?: boolean;
  stdin?: string;
}

export interface BcResult {
  ok: boolean;
  output: string;
}

export async function evaluate(expr: string, opts?: BcOptions): Promise<BcResult> {
  if (!wasmReady && !initPromise) {
    await init();
  } else if (!wasmReady && initPromise) {
    await initPromise;
  }

  const expression = opts?.stdin ?? expr;

  if (wasmReady && bcFactory && wasmBinary) {
    try {
      const result = await createInstance(expression, { useMathLib: opts?.useMathLib });
      if (result.ok && result.output !== '(no output)') return result;
      if (!result.ok) return result;
    } catch (err) {
      console.warn('[bc-wasm] evaluate error, falling back:', err);
    }
  }

  return jsFallback(expression, opts?.stdin);
}

export async function isAvailable(): Promise<boolean> {
  if (wasmReady) return true;
  return init();
}

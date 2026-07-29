/**
 * bc-wasm.ts — WebAssembly bc 引擎 (主线层直连)
 *
 * 直接在主线程加载 emscripten 编译的 bc.wasm，通过动态 import() 加载
 * emscripten 工厂。每次求值创建一个新的 wasm 实例（编译已缓存，仅实例化）。
 *
 * 无 Worker，无 importScripts，避免 GitHub Pages 子目录部署的路径问题。
 *
 * API:
 *   - evaluate(expr, opts?) — 执行 bc 表达式
 *   - isAvailable()         — 检查 wasm 是否就绪
 *
 * 降级: wasm 不可用时自动回退到 JS 实现（基本运算）。
 */

let wasmModule: WebAssembly.Module | null = null;
let bcFactory: ((opts: Record<string, unknown>) => Promise<Record<string, unknown>>) | null = null;
let wasmReady = false;
let initPromise: Promise<boolean> | null = null;

// ─── 路径解析 ────────────────────────────────────────────────────

/**
 * 动态解析 wasm 文件的 URL，兼容 GitHub Pages 子目录部署。
 * 例如 https://5849mog.github.io/OpenCodeCLI/ 下返回 /OpenCodeCLI/wasm/xxx。
 */
function wasmUrl(file: string): string {
  const { hostname, pathname } = window.location;
  if (hostname.includes('github.io')) {
    const seg = pathname.split('/').filter(Boolean);
    if (seg.length > 0 && seg[0] !== '_next') return `/${seg[0]}/wasm/${file}`;
  }
  return `/wasm/${file}`;
}

// ─── 初始化 ───────────────────────────────────────────────────────

async function init(): Promise<boolean> {
  if (wasmReady) return true;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    try {
      // 1. 预编译 wasm Module（缓存 WebAssembly.Module，重复实例化很快）
      const wasmResp = await fetch(wasmUrl('bc.wasm'));
      if (!wasmResp.ok) throw new Error(`bc.wasm HTTP ${wasmResp.status}`);
      wasmModule = await WebAssembly.compileStreaming(wasmResp);

      // 2. 动态加载 emscripten 工厂（ES 模块）
      const mod = await import(/* @vite-ignore */ wasmUrl('bc.mjs'));
      bcFactory = mod.default as (opts: Record<string, unknown>) => Promise<Record<string, unknown>>;

      // 3. 暖机测试：创建一个实例然后丢弃（确保工厂能工作）
      const test = await createInstance('1+1');
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

interface InstanceResult {
  ok: boolean;
  output: string;
}

async function createInstance(expr: string): Promise<InstanceResult> {
  const stdout: string[] = [];
  const stderr: string[] = [];

  const inputBuf = new TextEncoder().encode(expr + '\n');
  let inputPos = 0;

  const inst = (await bcFactory!({
    print: (t: unknown) => stdout.push(String(t)),
    printErr: (t: unknown) => stderr.push(String(t)),
    stdin: () => (inputPos < inputBuf.length ? inputBuf[inputPos++] : null),
    instantiateWasm: (
      imports: WebAssembly.Imports,
      callback: (instance: WebAssembly.Instance) => void,
    ) => {
      WebAssembly.instantiate(wasmModule!, imports).then(
        ({ instance }) => callback(instance),
      );
      return {};
    },
  })) as Record<string, unknown>;

  // callMain 触发 bc 的 main()，处理 stdin → stdout
  const callMain = inst.callMain as (args: string[]) => void;
  callMain(['-q']);

  const errOutput = stderr.join('\n').trim();
  if (errOutput) return { ok: false, output: errOutput };

  const outOutput = stdout.join('\n').trim();
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

  // Extract scale=N
  const sm = calcExpr.match(/\bscale\s*=\s*(\d+)\b/);
  if (sm) {
    calcScale = parseInt(sm[1], 10);
    calcExpr = calcExpr.replace(/\bscale\s*=\s*\d+\s*[;,]\s*/g, '');
  }

  // Convert bc syntax → JavaScript equivalents
  calcExpr = calcExpr
    .replace(/\^/g, '**')
    .replace(/\bsqrt\s*\(/g, 'Math.sqrt(')
    .replace(/(?<!\w)s\s*\(/g, 'Math.sin(')
    .replace(/(?<!\w)c\s*\(/g, 'Math.cos(')
    .replace(/(?<!\w)a\s*\(/g, 'Math.atan(')
    .replace(/(?<!\w)l\s*\(/g, 'Math.log(')
    .replace(/(?<!\w)e\s*\(/g, 'Math.exp(')
    .replace(/\bpi\b/gi, 'Math.PI')
    .replace(/\b(length|ibase|obase)\s*[=\(\s]/gi, '');

  // Sanitize
  const sanitized = calcExpr.replace(/[^0-9+\-*/().%\sa-zA-Z.]/g, '');
  if (!sanitized.trim()) return { ok: false, output: 'bc: missing expression' };

  try {
    const result = Function('"use strict"; return (' + sanitized + ')')();
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

/**
 * 执行 bc 表达式。
 *
 * @param expr  表达式
 * @param opts  可选参数（stdin, useMathLib）
 *
 * 示例:
 *   evaluate('2+2')                     → { ok: true, output: '4' }
 *   evaluate('ibase=16; FF')           → { ok: true, output: '255' }
 *   evaluate('', { stdin: '2+2' })     → { ok: true, output: '4' }
 */
export async function evaluate(expr: string, opts?: BcOptions): Promise<BcResult> {
  // wasm 未就绪 → 尝试初始化
  if (!wasmReady && !initPromise) {
    await init();
  } else if (!wasmReady && initPromise) {
    await initPromise;
  }

  const expression = opts?.stdin ?? expr;

  // wasm 就绪 → 用它
  if (wasmReady && bcFactory && wasmModule) {
    try {
      const result = await createInstance(expression);
      // 如果 wasm 返回空输出，降级
      if (result.ok && result.output !== '(no output)') return result;
      if (!result.ok) return result;
    } catch (err) {
      console.warn('[bc-wasm] evaluate error, falling back:', err);
    }
  }

  // 降级到 JS 实现
  return jsFallback(expression, opts?.stdin);
}

/**
 * 检查 wasm bc 是否可用。
 */
export async function isAvailable(): Promise<boolean> {
  if (wasmReady) return true;
  return init();
}

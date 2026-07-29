/**
 * bc-wasm.ts — WebAssembly bc 引擎中间层
 *
 * 通过 Web Worker 调用真正的 bc (gavinhoward/bc 编译为 wasm)，
 * 支持完整的 POSIX bc 语法：变量、函数、条件、循环、进制转换等。
 *
 * API:
 *   - initBC()         — 初始化 Worker 和 wasm 模块（惰性调用，无需手动）
 *   - evaluate(expr)   — 执行 bc 表达式，返回 { ok, output }
 *   - evaluateSync(expr) — （实验性）同步版本，作为 fallback
 *
 * 降级策略：
 *   如果 Worker 初始化失败，自动降级到内置 JS 实现。
 */

// Worker 实例（单例，惰性创建）
let worker: Worker | null = null;
let workerReady = false;
let workerInitPromise: Promise<boolean> | null = null;
let nextCallId = 0;

// 待处理的调用（callId → resolve）
const pendingCalls = new Map<number, (result: BcResult) => void>();

// 降级用 JS 实现（Worker 不可用时的保底）
function jsFallbackEvaluate(expr: string, stdin?: string): BcResult {
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

export interface BcOptions {
  /** 是否使用 -l 数学库（默认 false，由 AI 通过参数控制） */
  useMathLib?: boolean;
  /** stdin 管道输入（适用于 echo "..." | bc 场景） */
  stdin?: string;
}

export interface BcResult {
  ok: boolean;
  output: string;
}

/**
 * 初始化 Web Worker 和 wasm 模块。
 * 惰性调用——在任何 evaluate() 首次调用时自动触发。
 */
export async function initBC(): Promise<boolean> {
  if (workerReady) return true;
  if (workerInitPromise) return workerInitPromise;

  workerInitPromise = (async () => {
    try {
      worker = new Worker('/wasm/bc-worker.js');

      // 监听 Worker 消息
      worker.onmessage = (e: MessageEvent) => {
        const { id, ok, output, type } = e.data;

        // "ready" 信号
        if (type === 'ready') {
          workerReady = true;
          return;
        }

        // 处理 evaluate 结果
        const resolve = pendingCalls.get(id);
        if (resolve) {
          pendingCalls.delete(id);
          resolve({ ok, output });
        }
      };

      worker.onerror = (err: ErrorEvent) => {
        console.warn('bc-worker error:', err.message);
        workerReady = false;
      };

      // 等待 Worker 就绪（或超时）
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          // 即使超时也继续——Worker 可能还在初始化
          console.warn('bc-worker init timeout, proceeding without wasm');
          resolve();
        }, 10000);

        const checkReady = (e: MessageEvent) => {
          if (e.data.type === 'ready') {
            clearTimeout(timeout);
            workerReady = true;
            worker!.removeEventListener('message', checkReady);
            resolve();
          }
        };
        worker!.addEventListener('message', checkReady);
      });

      return true;
    } catch (err) {
      console.warn('bc-worker init failed, using JS fallback:', err);
      workerReady = false;
      return false;
    }
  })();

  return workerInitPromise;
}

/**
 * 执行 bc 表达式。
 *
 * @param expr 要计算的表达式
 * @param options 可选参数（useMathLib, stdin）
 * @returns { ok, output }
 *
 * 示例：
 *   evaluate('2+2')                    → { ok: true, output: '4' }
 *   evaluate('ibase=16; FF')          → { ok: true, output: '255' }
 *   evaluate('', { stdin: '2+2' })    → { ok: true, output: '4' }
 */
export async function evaluate(
  expr: string,
  options?: BcOptions,
): Promise<BcResult> {
  // 尝试 wasm Worker
  if (!workerReady) {
    const ok = await initBC();
    if (!ok) {
      // Wasm 不可用，降级到 JS 实现
      return jsFallbackEvaluate(expr, options?.stdin);
    }
  }

  // 如果 Worker 不可用（初始化失败）
  if (!worker || !workerReady) {
    return jsFallbackEvaluate(expr, options?.stdin);
  }

  return new Promise<BcResult>((resolve) => {
    const callId = nextCallId++;
    pendingCalls.set(callId, resolve);

    worker!.postMessage({
      id: callId,
      expr: options?.stdin ?? expr,
      command: 'eval',
    });

    // 安全超时（15 秒）
    setTimeout(() => {
      if (pendingCalls.has(callId)) {
        pendingCalls.delete(callId);
        resolve({ ok: false, output: 'bc: evaluation timed out' });
      }
    }, 15000);
  });
}

/**
 * 检查 bc wasm 是否可用。
 */
export async function isAvailable(): Promise<boolean> {
  if (workerReady) return true;
  return initBC();
}

/**
 * 销毁 Worker 实例（释放资源）。
 */
export function destroy(): void {
  if (worker) {
    worker.terminate();
    worker = null;
  }
  workerReady = false;
  workerInitPromise = null;
  pendingCalls.clear();
}

/**
 * 同步降级求值（用于无法使用 async 的上下文）。
 * 注意：只支持基础运算，不支持完整 bc 语法。
 */
export function evaluateSync(expr: string): BcResult {
  return jsFallbackEvaluate(expr);
}

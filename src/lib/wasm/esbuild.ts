/**
 * esbuild.ts — esbuild-wasm 桥接层（transpile 转译 + check_syntax 语法检查）。
 *
 * esbuild 是原生 Go 编译的转译器（WASM ~9MB）。它做语法校验、类型擦除、
 * JSX/TS → JS 转译、打包——但不做完整类型检查（那是 tsc 的活）。
 *
 * 加载：惰性。首次调用 initialize({ wasmURL }) 才下载 9MB wasm（不进首页
 * bundle，只有 AI 真正要转译/检查时才加载）。main thread，无 worker。
 *
 * 用法：
 *   await esbuildWasm.transpile("const x: number = 1;", "ts"); // → JS
 *   await esbuildWasm.checkSyntax("function ( {", "ts");       // → 错误
 */

// eslint-disable-next-line @typescript-eslint/no-var-requires
type EsbuildApi = typeof import("esbuild-wasm");

let esb: EsbuildApi | null = null;
let initPromise: Promise<boolean> | null = null;

/** GitHub Pages basePath 兼容（复用 js-wasm 的 wasmUrl 逻辑）。 */
function wasmUrl(file: string): string {
  if (typeof window === "undefined") return `/${file}`;
  if (window.location.hostname.endsWith("github.io")) {
    const seg = window.location.pathname.split("/").filter(Boolean)[0] ?? "";
    return `/${seg ? seg + "/" : ""}${file}`;
  }
  return `/${file}`;
}

async function init(): Promise<boolean> {
  if (initPromise) return initPromise;
  initPromise = (async () => {
    try {
      const mod = await import("esbuild-wasm");
      await mod.initialize({
        wasmURL: wasmUrl("wasm/esbuild.wasm"),
        worker: false,
      });
      esb = mod;
      return true;
    } catch (e) {
      console.warn("[esbuild] init failed:", e);
      esb = null;
      return false;
    }
  })();
  return initPromise;
}

export interface TranspileResult {
  ok: boolean;
  code?: string;
  error?: string;
}

/** 转译 TS/TSX/JSX/JS → JS。loader 自动推断或显式给定。 */
export async function transpile(source: string, loader?: string): Promise<TranspileResult> {
  const okReady = await init();
  if (!okReady || !esb) {
    return { ok: false, error: "esbuild 引擎初始化失败（public/wasm/esbuild.wasm 可能未 prepare）" };
  }
  const resolvedLoader = loader ?? inferLoader(source);
  try {
    const res = await esb.transform(source, {
      loader: resolvedLoader as never,
      target: "es2018",
      format: "esm",
      sourcemap: false,
    });
    return { ok: true, code: res.code };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** 检查源码语法是否合法（非类型检查）。返回错误信息或 null。 */
export async function checkSyntax(source: string, loader?: string): Promise<string | null> {
  const okReady = await init();
  if (!okReady || !esb) {
    return "esbuild 引擎初始化失败（public/wasm/esbuild.wasm 可能未 prepare）";
  }
  const resolvedLoader = loader ?? inferLoader(source);
  try {
    await esb.transform(source, { loader: resolvedLoader as never, target: "es2018" });
    return null; // 语法合法
  } catch (e) {
    // esbuild 报错格式：`<stdin>:1:9: ERROR: ...`（0.28 带 <>，旧版不带）。
    const raw = e instanceof Error ? e.message : String(e);
    // 提取友好信息（避免 /s flag——tsconfig target ES2017）
    const m = raw.match(/<?stdin>?:(\d+):(\d+):\s*(ERROR|WARNING):\s*([\s\S]*)/);
    if (m) return `第 ${m[1]} 行第 ${m[2]} 列: ${m[4].trim()}`;
    return raw;
  }
}

/** 从源码特征推断 loader（ts/tsx/js/jsx）。默认 ts。 */
function inferLoader(source: string): string {
  const trimmed = source.trimStart();
  // 含 JSX 尖括号 + 类型注解 → tsx；含类型先关键字 → ts；含 JSX 无类型 → jsx
  if (/<[A-Za-z][^>]*(>|\/>)/.test(trimmed) && /:\s*[A-Za-z]|interface\s+\w+/.test(trimmed)) return "tsx";
  if (/interface\s+\w+|type\s+\w+\s*=|:\s*[A-Za-z][\w<>[\]|]*/.test(trimmed)) return "ts";
  if (/<[A-Za-z][^>]*(>|\/>)/.test(trimmed)) return "jsx";
  return "js";
}

export const esbuildWasm = { transpile, checkSyntax };

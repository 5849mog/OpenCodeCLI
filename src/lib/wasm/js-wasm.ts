/**
 * js-wasm.ts — QuickJS WebAssembly JavaScript 引擎（run_js 工具直连）
 *
 * 与 lua/awk/sed 引擎不同：quickjs-emscripten 是 npm 包（自带预编译 wasm，
 * release-sync 变体），不走 emcc 编译。桥接层用打包器 import 它，wasm 通过
 * `wasmBinary` 显式注入（fetch public/wasm/js.wasm，由 tools/js-wasm/
 * prepare.sh 从 node_modules 拷贝）。
 *
 * 数据编排（QuickJS 无 C 式 stdin，与 Lua 的 io.open 不同）：
 *   - `input` → 注入全局变量 `globalThis.__input`（string）
 *   - `files` → 注入全局变量 `globalThis.__files`（{ path: content } 只读副本）
 *   - `args`  → 注入全局变量 `globalThis.__args`（string[]）
 *   - 输出（两条路）：
 *     ① 脚本 `return` 的值（同步 JS 脚本的返回值）
 *     ② 写 `globalThis.__outputs = { path: content }`（白名单，回传摘要）
 *   - console.log 被捕获（stdout）
 *
 * 降级：wasm 不可用时诚实报错（绝不降级到浏览器裸 eval——那会绕过
 * VFS 沙箱，破坏安全模型）。
 */

import { getQuickJS, type QuickJSContext } from "quickjs-emscripten";
import { runJsFallback } from "../tools/js";

/** Max chars allowed from a single js evaluation. Prevents AI context overflow. */
const MAX_JS_OUTPUT_LENGTH = 20_000;
/** Max chars per output file (matches other engines). */
export const MAX_FILE_BYTES = 200_000;
/** Max files/outputs count (matches other engines). */
export const MAX_INJECTED_FILES = 20;

export interface JsOptions {
  script: string;
  /** 注入为 globalThis.__input */
  stdin?: string;
  /** 注入为 globalThis.__files（path → content，只读副本） */
  files?: Record<string, string>;
  /** 注入为 globalThis.__args */
  args?: string[];
  /** 写回白名单（globalThis.__outputs 的 key） */
  outputs?: string[];
}

export interface JsResult {
  ok: boolean;
  output: string;
  written?: Record<string, string>;
}

let quickjsModule: Awaited<ReturnType<typeof getQuickJS>> | null = null;
let wasmBinary: ArrayBuffer | null = null;
let wasmReady = false;
let initPromise: Promise<boolean> | null = null;

/** GitHub Pages basePath 兼容：hostname 含 github.io 时用首段 repo 名。 */
function wasmUrl(file: string): string {
  if (typeof window === "undefined") return `/${file}`;
  if (window.location.hostname.endsWith("github.io")) {
    const seg = window.location.pathname.split("/").filter(Boolean)[0] ?? "";
    return `/${seg ? seg + "/" : ""}${file}`;
  }
  return `/${file}`;
}

async function fetchWasm(): Promise<ArrayBuffer> {
  const res = await fetch(wasmUrl("wasm/js.wasm"));
  if (!res.ok) throw new Error(`Failed to fetch js.wasm: ${res.status}`);
  return res.arrayBuffer();
}

async function init(): Promise<boolean> {
  if (initPromise) return initPromise;
  initPromise = (async () => {
    try {
      // 预取 wasm，显式注入（绕过打包器对 wasm 的默认处理）
      wasmBinary = await fetchWasm();
      // 加载 quickjs-emscripten 模块（打包器 import）
      quickjsModule = await getQuickJS();
      // 暖机测试：现代 JS + JSON 必须正常工作
      const ctx = quickjsModule.newContext();
      const warm = ctx.evalCode("JSON.stringify([1,2,3].map(x=>x*2))");
      let ok = false;
      if (warm.error) {
        warm.error.dispose();
      } else {
        ok = ctx.dump(warm.value) === "[2,4,6]";
        warm.value.dispose();
      }
      ctx.dispose();
      if (!ok) throw new Error("QuickJS warm-up test failed");
      wasmReady = true;
      return true;
    } catch (e) {
      console.warn("[js-wasm] init failed:", e);
      wasmReady = false;
      return false;
    }
  })();
  return initPromise;
}

/** 注入全局变量到上下文（input/files/args/outputs）。 */
function injectGlobals(
  ctx: QuickJSContext,
  opts: Omit<JsOptions, "script">,
): void {
  if (opts.stdin !== undefined) {
    const h = ctx.newString(opts.stdin);
    ctx.setProp(ctx.global, "__input", h);
    h.dispose();
  }
  if (opts.args && opts.args.length > 0) {
    const arr = ctx.newArray();
    opts.args.forEach((a, i) => {
      const s = ctx.newString(a);
      ctx.setProp(arr, i, s);
      s.dispose();
    });
    ctx.setProp(ctx.global, "__args", arr);
    arr.dispose();
  }
  if (opts.files && Object.keys(opts.files).length > 0) {
    const obj = ctx.newObject();
    for (const [path, content] of Object.entries(opts.files)) {
      const s = ctx.newString(content);
      ctx.setProp(obj, path, s);
      s.dispose();
    }
    ctx.setProp(ctx.global, "__files", obj);
    obj.dispose();
  }
  // __outputs 始终注入（即使无 outputs，脚本写它也无害——白名单由
  // dispatch 层校验，这里只提供可写对象）
  const outputs = ctx.newObject();
  ctx.setProp(ctx.global, "__outputs", outputs);
  outputs.dispose();
}

/** 注入 console.log 捕获（stdout）。 */
function injectConsole(ctx: QuickJSContext, stdout: string[]): void {
  const consoleHandle = ctx.newObject();
  const logFn = ctx.newFunction("log", (...args) => {
    const parts = args.map((a) => {
      try {
        const v = ctx.dump(a);
        if (typeof v === "string") return v;
        return JSON.stringify(v);
      } catch {
        return String(a);
      }
    });
    stdout.push(parts.join(" "));
  });
  ctx.defineProp(consoleHandle, "log", {
    value: logFn,
    enumerable: true,
  });
  ctx.setProp(ctx.global, "console", consoleHandle);
  consoleHandle.dispose();
  logFn.dispose();
}

function createContext(
  script: string,
  opts: Omit<JsOptions, "script">,
): { ok: boolean; output: string; written?: Record<string, string> } {
  if (!quickjsModule) return { ok: false, output: "run_js: QuickJS engine not initialized." };

  const ctx = quickjsModule.newContext();
  const stdout: string[] = [];
  const written: Record<string, string> = {};
  try {
    injectGlobals(ctx, opts);
    injectConsole(ctx, stdout);

    // 包一层：捕获 return 值 + 读取 __outputs
    const wrapped = `
      (function() {
        const __run = (function() {
          ${script}
        });
        let __result;
        try {
          __result = __run();
        } catch (e) {
          return { __error: String(e && e.stack || e) };
        }
        const __outs = {};
        if (globalThis.__outputs) {
          for (const k of Object.keys(globalThis.__outputs)) {
            __outs[k] = globalThis.__outputs[k];
          }
        }
        return { __result: typeof __result === 'undefined' ? undefined : __result, __outs };
      })()
    `;
    const res = ctx.evalCode(wrapped);
    if (res.error) {
      const errText = ctx.dump(res.error);
      res.error.dispose();
      return { ok: false, output: `run_js: ${errText}` };
    }
    const val = ctx.dump(res.value);
    res.value.dispose();

    if (val && typeof val === "object" && "__error" in val) {
      return { ok: false, output: `run_js: ${val.__error}` };
    }

    let outParts: string[] = [...stdout];
    if (val && typeof val === "object" && "__result" in val && val.__result !== undefined) {
      outParts.push(typeof val.__result === "string" ? val.__result : JSON.stringify(val.__result));
    }
    let output = outParts.join("\n").trim();

    // 读取 __outputs 白名单
    if (val && typeof val === "object" && val.__outs) {
      for (const [path, content] of Object.entries(val.__outs as Record<string, unknown>)) {
        if (typeof content !== "string") continue;
        if (content.length > MAX_FILE_BYTES) {
          return { ok: false, output: `run_js: 输出文件过大(>${MAX_FILE_BYTES.toLocaleString()} 字符): ${path}` };
        }
        written[path] = content;
      }
    }

    if (output.length > MAX_JS_OUTPUT_LENGTH) {
      output = output.slice(0, MAX_JS_OUTPUT_LENGTH) +
        `\n\n[... js output truncated at ${MAX_JS_OUTPUT_LENGTH.toLocaleString()} chars; ` +
        `original output was ${output.length.toLocaleString()} chars — ` +
        `re-run with a more selective script for full result]`;
    }
    return { ok: true, output: output || "(no output)", written };
  } finally {
    ctx.dispose();
  }
}

// ─── 公开 API ─────────────────────────────────────────────────────

export async function evaluate(opts: JsOptions): Promise<JsResult> {
  if (!wasmReady && !initPromise) {
    await init();
  } else if (!wasmReady && initPromise) {
    await initPromise;
  }

  if (wasmReady && quickjsModule) {
    try {
      return createContext(opts.script, opts);
    } catch (err) {
      console.warn("[js-wasm] evaluate error, falling back:", err);
    }
  }

  return runJsFallback(opts.script, opts.stdin);
}

export async function isAvailable(): Promise<boolean> {
  if (wasmReady) return true;
  return init();
}

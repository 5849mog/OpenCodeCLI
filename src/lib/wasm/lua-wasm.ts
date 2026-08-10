/**
 * lua-wasm.ts — WebAssembly Lua 引擎（run_lua 工具直连）
 *
 * 用 <script> 标签加载 emscripten 的输出（经典脚本），
 * 工厂函数注册到 window.LUAModule，全程不经过打包器模块解析。
 *
 * 每次求值创建一个新的 wasm 实例（wasm Module 预编译缓存，仅实例化）。
 * 降级: wasm 不可用时回退到 JS 降级实现（src/lib/tools/lua.ts 的 runLuaJs，
 * 只报「原生引擎不可用」，不假意执行——半吊子解释器会静默产出错误结果）。
 *
 * 输入编排（匹配真实 lua 语义）：
 *   - script 写成 MEMFS 文件后以 `lua script.lua` 执行（位置参数，不走选项解析）：
 *     若用 `-e`，选项解析器会碰脚本内容——'--' 开头的注释脚本会被误判为
 *     命令行选项，报 `'-e' needs argument`（2026-08 实测踩坑）
 *   - stdin 提供两条路，但**绝不进 argv**：
 *     ① emscripten stdin 回调喂字节 → 脚本 `io.read("*a")` / `io.lines()` 可读
 *     ② 写入 MEMFS 的 input.txt → 脚本 `io.open("input.txt")` 可读
 *     注意：不能把 input.txt 放进 argv——lua 会把第一个非选项参数当脚本执行
 *   - files 注入工作区文件只读副本（路径 → 内容，写 MEMFS 同名文件）：
 *     脚本 `io.open(path)` 读到的只是内存副本；写操作（io.open 'w' / os.remove）
 *     也只改 MEMFS 副本，摸不到真实 VFS。VFS 读取由调用方（dispatch 层）完成。
 *   - 无 stdin → 空 stdin，argv 只有 script.lua
 *
 * 权限边界（严格，与 system-prompt 一致）：
 *   纯内存计算。不改 VFS、不访问网络、不持久化。
 */

import { runLuaJs } from "../tools/lua";

let wasmBinary: ArrayBuffer | null = null;
let luaFactory: ((opts: Record<string, unknown>) => Promise<Record<string, unknown>>) | null = null;
let wasmReady = false;
let initPromise: Promise<boolean> | null = null;

/** Max chars allowed from a single lua evaluation. Prevents AI context overflow. */
const MAX_LUA_OUTPUT_LENGTH = 20_000;

/** files 注入防护：最多 20 个文件、单文件 ≤200KB（超限直接报错，不静默截断——
 *  截断数据会让脚本算出错误结果，不如明说）。dispatch 层复用同一组常量。 */
export const MAX_INJECTED_FILES = 20;
export const MAX_FILE_BYTES = 200_000;

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
      // 1. 加载 <script> 标签（emscripten 粘合剂）→ window.LUAModule
      await loadScript(wasmUrl('lua.js'));
      const factory = (window as any).LUAModule;
      if (typeof factory !== 'function') throw new Error('LUAModule not found');
      luaFactory = factory;

      // 2. 获取 wasm 二进制（预缓存，避免每次 fetch）
      const wasmResp = await fetch(wasmUrl('lua.wasm'));
      if (!wasmResp.ok) throw new Error(`lua.wasm HTTP ${wasmResp.status}`);
      wasmBinary = await wasmResp.arrayBuffer();

      // 3. 暖机测试（验证 wasm 端到端可用）
      const test = await createInstance('print(6*7)', {});
      if (!test.ok || test.output !== '42') throw new Error(`warm-up failed: ${test.output}`);

      wasmReady = true;
      return true;
    } catch (err) {
      console.warn('[lua-wasm] init failed, using JS fallback:', err);
      wasmReady = false;
      return false;
    }
  })();

  return initPromise;
}

// ─── 创建实例 ─────────────────────────────────────────────────────

export interface LuaOptions {
  /** Lua 程序文本，如 'print(6*7)' 或 'for i=1,3 do print(i) end' */
  script: string;
  /** 管道输入（stdin）：脚本可用 io.read("*a") / io.lines() 读，或 io.open("input.txt") 读 */
  stdin?: string;
  /** 工作区文件只读副本：路径 → 内容，写入 MEMFS 同名文件，脚本 io.open(path) 读取。
   *  只读——脚本写这些路径只改内存副本，摸不到真实 VFS。 */
  files?: Record<string, string>;
  /** 传给脚本的 argv（脚本读 arg[1..]），如 ["--mode=fast"] */
  args?: string[];
  /** 写回白名单：求值后把 MEMFS 中这些路径的内容同步回 VFS（写回由调用方完成）。
   *  未声明的路径不同步（跑完即毁）；脚本未写的路径由调用方摘要注明「未产生」。 */
  outputs?: string[];
}

export interface LuaResult {
  ok: boolean;
  output: string;
  /** outputs 白名单内、脚本实际写出的文件（路径 → 内容），由调用方同步回 VFS */
  written?: Record<string, string>;
}

/** mkdir -p 父目录，让 FS.writeFile 支持嵌套文件名（如 "src/util.ts"）。 */
function ensureParentDirs(fs: { mkdir(p: string): void }, path: string): void {
  const parts = path.split('/').filter(Boolean);
  let cur = '';
  for (let k = 0; k < parts.length - 1; k++) {
    cur += '/' + parts[k];
    try { fs.mkdir(cur); } catch { /* 已存在 */ }
  }
}

async function createInstance(script: string, opts: Omit<LuaOptions, "script">): Promise<LuaResult> {
  const stdout: string[] = [];
  const stderr: string[] = [];

  // stdin → emscripten stdin 回调喂字节（null=EOF），与 awk/bc 相同机制。
  const inputBuf = opts.stdin !== undefined ? new TextEncoder().encode(opts.stdin) : null;
  let inputPos = 0;

  const inst = (await luaFactory!({
    print: (t: unknown) => stdout.push(String(t)),
    printErr: (t: unknown) => stderr.push(String(t)),
    stdin: () => (inputBuf !== null && inputPos < inputBuf.length ? inputBuf[inputPos++] : null),
    // 提供 wasm 二进制 + locateFile，让 emscripten 内部处理实例化
    wasmBinary: wasmBinary,
    locateFile: (path: string) => wasmUrl(path),
  })) as Record<string, unknown>;

  const FS = inst.FS as {
    writeFile(p: string, d: Uint8Array): void;
    mkdir(p: string): void;
    readFile(p: string): Uint8Array;
  };
  const callMain = inst.callMain as (args: string[]) => void;

  // files → MEMFS 只读副本（先建父目录）。脚本对这些路径的写操作只改副本，
  // 摸不到真实 VFS。
  for (const [path, content] of Object.entries(opts.files ?? {})) {
    ensureParentDirs(FS, path);
    FS.writeFile(path, new TextEncoder().encode(content));
  }

  if (inputBuf !== null) {
    // stdin 走 io.read('*a')/io.lines()；同时写 MEMFS input.txt 供 io.open("input.txt")。
    // 绝不放进 argv——lua 会把第一个非选项参数当脚本执行（见文件头注释）。
    FS.writeFile('input.txt', inputBuf);
  }

  // script 作为 MEMFS 文件执行（lua script.lua）——不走 -e 选项（选项解析会
  // 碰脚本内容，'--' 开头的注释脚本会被误判为命令行选项）。最后写入，避免
  // 与 files/input.txt 同名时被覆盖。args 追加到 argv（脚本读 arg[1..]）。
  FS.writeFile('script.lua', new TextEncoder().encode(script));
  callMain(['script.lua', ...(opts.args ?? [])]);

  // outputs 白名单：求值后读 MEMFS 内容回传（超限报错不静默截断；脚本未写
  // 的路径跳过，由调用方摘要注明「未产生」）
  const written: Record<string, string> = {};
  for (const outPath of opts.outputs ?? []) {
    let bytes: Uint8Array;
    try {
      bytes = FS.readFile(outPath) as Uint8Array;
    } catch {
      continue; // 脚本未写该路径
    }
    const content = new TextDecoder().decode(bytes);
    if (content.length > MAX_FILE_BYTES) {
      return { ok: false, output: `run_lua: 输出文件过大(>${MAX_FILE_BYTES.toLocaleString()} 字符): ${outPath}` };
    }
    written[outPath] = content;
  }

  const errOutput = stderr.join('\n').trim();
  if (errOutput) return { ok: false, output: errOutput };

  let outOutput = stdout.join('\n').trim();
  if (outOutput.length > MAX_LUA_OUTPUT_LENGTH) {
    outOutput = outOutput.slice(0, MAX_LUA_OUTPUT_LENGTH) +
      `\n\n[... lua output truncated at ${MAX_LUA_OUTPUT_LENGTH.toLocaleString()} chars; ` +
      `original output was ${outOutput.length.toLocaleString()} chars ` +
      `(${outOutput.split('\n').length} lines) — ` +
      `re-run with a more selective script for full result]`;
  }
  return { ok: true, output: outOutput || '(no output)', written };
}

// ─── 公开 API ─────────────────────────────────────────────────────

export async function evaluate(opts: LuaOptions): Promise<LuaResult> {
  if (!wasmReady && !initPromise) {
    await init();
  } else if (!wasmReady && initPromise) {
    await initPromise;
  }

  if (wasmReady && luaFactory && wasmBinary) {
    try {
      return await createInstance(opts.script, opts); // wasm 结果为准（含 stderr 报错）
    } catch (err) {
      console.warn('[lua-wasm] evaluate error, falling back:', err);
    }
  }

  return runLuaJs(opts.script, opts.stdin);
}

export async function isAvailable(): Promise<boolean> {
  if (wasmReady) return true;
  return init();
}

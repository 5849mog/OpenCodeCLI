/**
 * awk-wasm.ts — WebAssembly mawk 引擎（主线层直连）
 *
 * 完整复制 bc-wasm 的技术栈，通过 <script> 标签加载 emscripten 编译的 mawk。
 * 管道模式（echo "..." | awk）走 wasm stdin，文件模式降级到 JS。
 */

let wasmBinary: ArrayBuffer | null = null;
let factory: ((opts: Record<string, unknown>) => Promise<Record<string, unknown>>) | null = null;
let wasmReady = false;
let initPromise: Promise<boolean> | null = null;

// ─── 路径解析 ────────────────────────────────────────────────────

function wasmUrl(file: string): string {
  const { hostname, pathname } = window.location;
  if (hostname.includes('github.io')) {
    const seg = pathname.split('/').filter(Boolean);
    if (seg.length > 0 && seg[0] !== '_next') return `/${seg[0]}/wasm/${file}`;
  }
  return `/wasm/${file}`;
}

// ─── <script> 加载器 ─────────────────────────────────────────────

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
      await loadScript(wasmUrl('mawk.js'));
      const mawkFactory = (window as any).MawkModule;
      if (typeof mawkFactory !== 'function') throw new Error('MawkModule not found on window');
      factory = mawkFactory;

      // 2. 获取 wasm 二进制（预缓存）
      const wasmResp = await fetch(wasmUrl('mawk.wasm'));
      if (!wasmResp.ok) throw new Error(`mawk.wasm HTTP ${wasmResp.status}`);
      wasmBinary = await wasmResp.arrayBuffer();

      // 3. 暖机测试
      const test = await createInstance('BEGIN { print "ok" }', '');
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

interface InstanceResult {
  ok: boolean;
  output: string;
}

async function createInstance(script: string, input: string): Promise<InstanceResult> {
  const stdout: string[] = [];
  const stderr: string[] = [];

  // mawk reads script from a file (via -f) or from the first argument
  // We'll pass the script via -f /tmp/script.awk and input via stdin
  const inst = (await factory!({
    print: (t: unknown) => stdout.push(String(t)),
    printErr: (t: unknown) => stderr.push(String(t)),
    locateFile: (path: string) => wasmUrl(path),
    wasmBinary: wasmBinary,
    noFSInit: false,
  })) as Record<string, unknown>;

  const FS = inst.FS as any;

  // Write the AWK script to a virtual file
  FS.writeFile('/tmp/script.awk', script);

  // Write input data to a virtual file
  FS.writeFile('/tmp/input.txt', input);

  const callMain = inst.callMain as (args: string[]) => void;
  callMain(['-f', '/tmp/script.awk', '/tmp/input.txt']);

  const errOutput = stderr.join('\n').trim();
  if (errOutput) return { ok: false, output: errOutput };

  const outOutput = stdout.join('\n').trim();
  return { ok: true, output: outOutput || '(no output)' };
}

// ─── 公开 API ─────────────────────────────────────────────────────

export interface AwkOptions {
  fieldSep?: string;
}

export interface AwkResult {
  ok: boolean;
  output: string;
}

/**
 * 执行 awk 脚本。
 *
 * @param script  awk 脚本（如 '{print $1}'）
 * @param input   输入文本（管道数据）
 * @param opts    可选参数（fieldSep 字段分隔符）
 */
export async function evaluate(
  script: string,
  input: string,
  opts?: AwkOptions,
): Promise<AwkResult> {
  // 无输入数据 → 不走 wasm（mawk 会读文件而非 stdin）
  if (!input || !input.trim()) {
    return { ok: false, output: 'no input data' };
  }

  if (!wasmReady && !initPromise) {
    await init();
  } else if (!wasmReady && initPromise) {
    await initPromise;
  }

  if (wasmReady && factory && wasmBinary) {
    try {
      // Build the script: if -F is given, prepend the field separator
      let fullScript = script;
      if (opts?.fieldSep) {
        fullScript = `BEGIN { FS = "${opts.fieldSep}" }\n${script}`;
      }
      const result = await createInstance(fullScript, input);
      if (result.ok) return result;
      // Wasm returned an error — fall through to JS fallback
    } catch (err) {
      console.warn('[awk-wasm] evaluate error, falling back:', err);
    }
  }

  return { ok: false, output: 'wasm not available, falling back to JS awk' };
}

/**
 * 检查 wasm mawk 是否可用。
 */
export async function isAvailable(): Promise<boolean> {
  if (wasmReady) return true;
  return init();
}

/**
 * js.ts — run_js 工具的 JS 降级实现
 *
 * QuickJS WASM 引擎（src/lib/wasm/js-wasm.ts）不可用时回退到这里。
 * 关键安全决策：**绝不降级到浏览器裸 eval / new Function**——那会绕过
 * VFS 沙箱（files 白名单、outputs 白名单、无网络/无持久化边界全被破坏），
 * 等于给 AI 一个不受约束的 JavaScript 执行器。因此降级策略是诚实报错，
 * 与 run_lua 的降级（runLuaJs）一致。
 */

export interface JsResult {
  ok: boolean;
  output: string;
}

/** JS 降级：不假意执行，明确告知原生引擎不可用。 */
export function runJsFallback(script: string, _stdin?: string): JsResult {
  return {
    ok: false,
    output:
      "js: native QuickJS WebAssembly engine unavailable (public/wasm/js.wasm was not loaded — " +
      "the prepare step may not have run). This sandbox deliberately has NO JS fallback via " +
      "browser eval/new Function: that would escape the VFS whitelist sandbox (files/outputs " +
      "whitelists, no network, no persistence). " +
      "Alternatives: " +
      "(1) push this repo to trigger the CI prepare step and redeploy; " +
      "(2) express the same computation with run_lua (Lua) or awk; " +
      "(3) ask the user to run tools/js-wasm/prepare.sh locally after npm install.",
  };
}

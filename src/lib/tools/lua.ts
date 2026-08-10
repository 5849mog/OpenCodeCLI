/**
 * lua.ts — run_lua 工具的 JS 降级实现
 *
 * wasm 引擎（src/lib/wasm/lua-wasm.ts）不可用时回退到这里。
 * 与 awk/bc 不同，Lua 没有轻量 JS 等价物——写一个「半吊子解释器」
 * 会静默产出错误结果，对 AI 比报错更危险。因此降级策略是**诚实报错**：
 * 告知原生引擎不可用，并给出替代路径。
 */

export interface LuaResult {
  ok: boolean;
  output: string;
}

/** JS 降级：不假意执行，明确告知原生引擎不可用。 */
export function runLuaJs(script: string, _stdin?: string): LuaResult {
  return {
    ok: false,
    output:
      "lua: native WebAssembly engine unavailable (public/wasm/lua.js was not loaded — " +
      "the build step may not have run). This sandbox deliberately has NO JS fallback for Lua: " +
      "a partial interpreter would silently produce wrong results, which is worse than an error. " +
      "Alternatives: " +
      "(1) push this repo to trigger the CI 'Build lua.wasm' step and redeploy; " +
      "(2) express the same computation with awk (line/column data) or with step-by-step tool calls; " +
      "(3) ask the user to run tools/lua-wasm/build.sh locally.",
  };
}

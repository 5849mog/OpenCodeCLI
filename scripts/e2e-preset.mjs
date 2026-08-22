// e2e: 三种运行模式（full/light/minimal）—— 提示词组装 + 工具过滤 + 缓存稳定性。
// 真实源码经 esbuild-wasm 打包。
import { build } from "esbuild-wasm";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

const outfile = path.join(__dirname, ".e2e-preset-bundle.mjs");
const entryFile = path.join(__dirname, ".e2e-preset-entry.mjs");
fs.writeFileSync(
  entryFile,
  'export { buildSystemPrompt, PRESET_TOOLS, filterToolsByPreset } from "../src/lib/tools/system-prompt.ts";\n',
);
await build({
  entryPoints: [entryFile],
  outfile,
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node18",
  logLevel: "error",
  external: [],
  sourcemap: false,
});
const mod = await import("file://" + outfile.replaceAll("\\", "/"));
const { buildSystemPrompt, PRESET_TOOLS, filterToolsByPreset } = mod;

let pass = 0, fail = 0;
function assert(cond, msg) {
  if (cond) { pass++; console.log("  ✓ " + msg); }
  else { fail++; console.error("  ✗ FAIL: " + msg); }
}

console.log("\n== preset (full/light/minimal) e2e ==");

// 1) minimal：一句话 persona，不含冗长段
{
  const p = buildSystemPrompt({ preset: "minimal" });
  assert(p.length < 300, `minimal system 极短（${p.length} chars）`);
  assert(p.includes("software engineer"), "minimal 含 persona");
  assert(!p.includes("Rule 3"), "minimal 不含 Rule 3");
  assert(!p.includes("Your tools"), "minimal 不含 Your tools");
  assert(!p.includes("failure protocol"), "minimal 不含失败协议");
}

// 2) light：含硬约束（失败协议），不含说教/元信息段
{
  const p = buildSystemPrompt({ preset: "light" });
  assert(p.includes("Tool failure protocol"), "light 含失败协议");
  assert(p.includes("节奏与心法"), "light 含核心行为规则");
  assert(!p.includes("Output format"), "light 不含 Output format");
  assert(!p.includes("Web access notes"), "light 不含 Web access notes");
  assert(!p.includes("Rule 3 — Be extremely conservative"), "light 不含 Rule 3 说教");
  assert(p.includes("Your tools"), "light 含工具清单");
  assert(p.length < 40000, `light 比 full 短（${p.length} chars）`);
}

// 3) full：包含全部段
{
  const p = buildSystemPrompt({ preset: "full" });
  assert(p.includes("Output format"), "full 含 Output format");
  assert(p.includes("Web access notes"), "full 含 Web access notes");
  assert(p.includes("Tool failure protocol"), "full 含失败协议");
}

// 4) 工具过滤
{
  const minimal = filterToolsByPreset("minimal");
  const minimalNames = minimal.map((t) => t.function.name).sort();
  assert(minimal.length === 6, `minimal 恰好 6 工具（实际 ${minimal.length}）`);
  assert(
    JSON.stringify(minimalNames) ===
      JSON.stringify(["bash", "edit_file", "glob", "read_file", "run_js", "run_lua"]),
    `minimal 工具集 = bash/edit_file/glob/read_file/run_lua/run_js（实际 ${minimalNames.join(",")}）`,
  );

  const light = filterToolsByPreset("light");
  assert(light.length > 4 && light.length < 44, `light 工具数介于 4~44（实际 ${light.length}）`);
  const lightNames = new Set(light.map((t) => t.function.name));
  assert(lightNames.has("bash") && lightNames.has("search_files"), "light 含核心工具");

  const full = filterToolsByPreset("full");
  assert(full.length === 44, `full 全部 44 工具（实际 ${full.length}）`);
}

// 5) 缓存稳定性：同一 preset 两次调用字节相同
{
  for (const preset of ["full", "light", "minimal"]) {
    const a = buildSystemPrompt({ preset, customInstructions: "测试" });
    const b = buildSystemPrompt({ preset, customInstructions: "测试" });
    assert(a === b, `${preset} 两次调用字节相同`);
  }
  // minimal 忽略 customInstructions（persona 是唯一提示词，保持前缀稳定）
  const m1 = buildSystemPrompt({ preset: "minimal", customInstructions: "A" });
  const m2 = buildSystemPrompt({ preset: "minimal", customInstructions: "B" });
  assert(m1 === m2, "minimal 忽略 customInstructions（前缀稳定）");
}

console.log(`\n结果: ${pass} passed, ${fail} failed`);
try { fs.unlinkSync(entryFile); fs.unlinkSync(outfile); } catch {}
if (fail > 0) process.exit(1);
console.log("\npreset e2e 全部通过 ✅");

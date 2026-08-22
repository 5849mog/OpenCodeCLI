// 验证：重构后的 full 模式与重构前（dce5fbc）的 buildSystemPrompt 输出逐字节一致。
// 方法：用 esbuild 分别打包旧/新 system-prompt.ts（resolveDir 指向 src/lib/tools，
// 相对 import 正常解析），执行两版 buildSystemPrompt 对比（含/不含 customInstructions）。
import { build } from "esbuild-wasm";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const toolsDir = path.join(repoRoot, "src/lib/tools");
const OLD_COMMIT = "dce5fbc";

let pass = 0, fail = 0;
function assert(cond, msg) {
  if (cond) { pass++; console.log("  ✓ " + msg); }
  else { fail++; console.error("  ✗ FAIL: " + msg); }
}

async function bundleToTemp(source, tag) {
  const res = await build({
    stdin: { contents: source, sourcefile: "system-prompt.ts", resolveDir: toolsDir, loader: "ts" },
    bundle: true,
    write: false,
    format: "esm",
    platform: "node",
    target: "node18",
    logLevel: "error",
  });
  const tmp = path.join(os.tmpdir(), `${tag}-${Date.now()}.mjs`);
  fs.writeFileSync(tmp, res.outputFiles[0].text);
  const mod = await import("file://" + tmp.replaceAll("\\", "/"));
  return { mod, tmp };
}

// 1) 旧文件（dce5fbc）→ 打包出 buildSystemPrompt
const oldSrc = execSync(`git show ${OLD_COMMIT}:src/lib/tools/system-prompt.ts`, { cwd: repoRoot }).toString();
const { mod: oldMod, tmp: oldTmp } = await bundleToTemp(oldSrc, "old-sp");

// 2) 新文件（当前工作区）→ 打包出 buildSystemPrompt
const newSrc = fs.readFileSync(path.join(toolsDir, "system-prompt.ts"), "utf8");
const { mod: newMod, tmp: newTmp } = await bundleToTemp(newSrc, "new-sp");

console.log("\n== full 模式 vs 重构前(dce5fbc) 逐字节一致 ==");

// 3) 对比：无 customInstructions + 含 customInstructions
const cases = [
  { name: "无 customInstructions", old: {}, cur: {} },
  {
    name: "含 customInstructions",
    old: { customInstructions: "测试指令：优先使用 TypeScript。" },
    cur: { customInstructions: "测试指令：优先使用 TypeScript。" },
  },
];
for (const c of cases) {
  const a = oldMod.buildSystemPrompt(c.old);
  const b = newMod.buildSystemPrompt(c.cur); // preset 默认 full
  const same = a === b;
  assert(same, `${c.name} 逐字节一致（${a.length} chars）`);
  if (!same) {
    const n = Math.min(a.length, b.length);
    let firstDiff = -1;
    for (let i = 0; i < n; i++) if (a[i] !== b[i]) { firstDiff = i; break; }
    console.error(`    旧长度 ${a.length} / 新长度 ${b.length} / 首个差异 @${firstDiff}`);
    console.error(`    旧: ...${a.slice(Math.max(0, firstDiff - 80), firstDiff + 80)}...`);
    console.error(`    新: ...${b.slice(Math.max(0, firstDiff - 80), firstDiff + 80)}...`);
  }
}

// 4) 旧输出确实包含全部关键段（双重保险）
{
  const a = oldMod.buildSystemPrompt({});
  for (const key of [
    "## Your tools",
    "## Tool side effects",
    "## Web access notes",
    "## ⛔ Tool failure protocol",
    "## Coding standards",
    "## Output format",
    "### Rule 1",
    "### Rule 2",
    "### Rule 3",
    "### Rule 3b",
    "### Rule 4",
    "## 📎 用户消息中的文件引用",
    "## 🎯 Skills",
    "Remember: you are operating on the 文件袋",
  ]) {
    assert(a.includes(key), `旧模板含 "${key}"`);
  }
}

try { fs.unlinkSync(oldTmp); fs.unlinkSync(newTmp); } catch {}

console.log(`\n结果: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
console.log("\nfull 模式与重构前完全一致 ✅");

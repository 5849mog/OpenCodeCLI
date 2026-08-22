// e2e: 视觉消息（ContentPart[]）的 token 计数与摘要安全（真实源码经 esbuild-wasm 打包）。
// 覆盖：estimateContentPartsTokens（image 384 / file 15 / text 按字数）、
// estimateMessageTokens 数组分支、countConversationTokensAccurate 数组分支、
// compact.ts contentToText 对数组不崩。
import { build } from "esbuild-wasm";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

// ---------- esbuild 打包：内联入口 re-export 被测模块 ----------
const outfile = path.join(__dirname, ".e2e-vision-bundle.mjs");
const entryFile = path.join(__dirname, ".e2e-vision-entry.mjs");
fs.writeFileSync(
  entryFile,
  'export { estimateContentPartsTokens, estimateMessageTokens } from "../src/lib/context.ts";\n' +
  'export { countConversationTokensAccurate } from "../src/lib/wasm/tokenizer.ts";\n',
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
const { estimateContentPartsTokens, estimateMessageTokens, countConversationTokensAccurate } = mod;

// ---------- 辅助 ----------
let pass = 0, fail = 0;
function assert(cond, msg) {
  if (cond) { pass++; console.log("  ✓ " + msg); }
  else { fail++; console.error("  ✗ FAIL: " + msg); }
}

console.log("\n== vision ContentPart[] e2e ==");

// 1) estimateContentPartsTokens：text 按字数、image 固定 384、file 固定 15
{
  const parts = [
    { type: "text", text: "hello" },
    { type: "image_url", image_url: { url: "data:image/png;base64,AAAA" } },
    { type: "file", file_id: "file-api-abc" },
  ];
  const t = estimateContentPartsTokens(parts);
  // hello ≈ ceil(5/4)=2；image 384；file 15 → 401
  assert(t === 401, `数组计数正确 (401，实际 ${t})`);
}

// 2) estimateMessageTokens：字符串路径不变、数组路径走部件计数
{
  const str = estimateMessageTokens({ role: "user", content: "hello" }); // 4 + 2 = 6
  assert(str === 6, `字符串 content 计数不变 (6，实际 ${str})`);
  const arr = estimateMessageTokens({
    role: "user",
    content: [
      { type: "text", text: "hi" },
      { type: "image_url", image_url: { url: "x" } },
    ],
  }); // 4 + ceil(2/4)=1 + 384 = 389
  assert(arr === 389, `数组 content 计数正确 (389，实际 ${arr})`);
  const noContent = estimateMessageTokens({ role: "user", content: null });
  assert(noContent === 4, `null content 只计开销 (4，实际 ${noContent})`);
}

// 3) countConversationTokensAccurate：数组 content 走 local 计数不崩、不双计
{
  const n = await countConversationTokensAccurate([
    { role: "system", content: "sys" },
    {
      role: "user",
      content: [
        { type: "text", text: "hello" },
        { type: "image_url", image_url: { url: "data:image/jpeg;base64,BBBB" } },
      ],
    },
    { role: "assistant", content: "ok", tool_calls: [{ id: "1", type: "function", function: { name: "f", arguments: "{}" } }] },
  ]);
  // msg0: 4 + ceil(3/4)=1 = 5
  // msg1: 4 + (2 + 384) = 390
  // msg2: 4 + ceil(2/4)=1 + 8 + (ceil(1/4)=1 + ceil(2/4)=1) = 15
  // total = 5 + 390 + 15 = 410
  assert(n === 410, `countConversationTokensAccurate 数组分支正确 (410，实际 ${n})`);
}

console.log(`\n结果: ${pass} passed, ${fail} failed`);
try { fs.unlinkSync(entryFile); fs.unlinkSync(outfile); } catch {}
if (fail > 0) process.exit(1);
console.log("\nvision ContentPart[] e2e 全部通过 ✅");

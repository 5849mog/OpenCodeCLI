// e2e: url-guard 主机校验（真实源码经 esbuild-wasm 打包）。
// 断言：http/https 公网放行；localhost/环回/私有/保留地址拒绝。
import { build } from "esbuild-wasm";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

const outfile = path.join(__dirname, ".e2e-urlguard-bundle.mjs");
const entryFile = path.join(__dirname, ".e2e-urlguard-entry.mjs");
fs.writeFileSync(entryFile, 'export { validateExternalUrl } from "../src/lib/url-guard.ts";\n');
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
const { validateExternalUrl } = await import("file://" + outfile.replaceAll("\\", "/"));

let pass = 0, fail = 0;
function assert(cond, msg) {
  if (cond) { pass++; console.log("  ✓ " + msg); }
  else { fail++; console.error("  ✗ FAIL: " + msg); }
}

console.log("\n== url-guard e2e ==");

// 放行：公网 https/http
assert(validateExternalUrl("https://api.deepseek.com/v1/chat/completions") === null, "https 公网放行");
assert(validateExternalUrl("http://api.example.com/x") === null, "http 公网放行");

// 拒绝：localhost / 环回 / 私有 / 保留
assert(validateExternalUrl("https://localhost:3000") !== null, "localhost 拒绝");
assert(validateExternalUrl("http://127.0.0.1:8000") !== null, "127.0.0.1 拒绝");
assert(validateExternalUrl("http://[::1]:3000") !== null, "IPv6 ::1 拒绝");
assert(validateExternalUrl("http://10.0.0.5/x") !== null, "10.x 私有拒绝");
assert(validateExternalUrl("http://172.16.0.1/x") !== null, "172.16-31 私有拒绝");
assert(validateExternalUrl("http://192.168.1.1/x") !== null, "192.168 私有拒绝");
assert(validateExternalUrl("http://169.254.1.1/x") !== null, "链路本地 169.254 拒绝");
assert(validateExternalUrl("http://224.0.0.1/x") !== null, "组播 224.x 拒绝");
assert(validateExternalUrl("http://0.0.0.0/x") !== null, "0.0.0.0 拒绝");

// 拒绝：非 http/https 协议
assert(validateExternalUrl("file:///etc/passwd") !== null, "file:// 拒绝");
assert(validateExternalUrl("javascript:alert(1)") !== null, "javascript: 拒绝");
assert(validateExternalUrl("not-a-url") !== null, "非法 URL 拒绝");

console.log(`\n结果: ${pass} passed, ${fail} failed`);
try { fs.unlinkSync(entryFile); fs.unlinkSync(outfile); } catch {}
if (fail > 0) process.exit(1);
console.log("\nurl-guard e2e 全部通过 ✅");

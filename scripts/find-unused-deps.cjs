// 一次性脚本：扫描 package.json 依赖在源码/脚本/配置中的实际引用
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));

const scanDirs = ["src", "scripts", "tools"];
const scanFiles = ["next.config.ts", "tailwind.config.ts", "postcss.config.mjs", "eslint.config.mjs", "gen-changelog.mjs", "components.json"];
let contents = "";
function collect(p) {
  const st = fs.statSync(p);
  if (st.isDirectory()) {
    if (path.basename(p) === "node_modules" || path.basename(p) === "out" || path.basename(p) === ".next") return;
    for (const e of fs.readdirSync(p)) collect(path.join(p, e));
  } else if (/\.(tsx?|mjs|cjs|js|css|json)$/.test(p)) {
    contents += fs.readFileSync(p, "utf8");
  }
}
for (const d of scanDirs) collect(path.join(root, d));
for (const f of scanFiles) {
  const p = path.join(root, f);
  if (fs.existsSync(p)) contents += fs.readFileSync(p, "utf8");
}

const all = { ...pkg.dependencies, ...pkg.devDependencies };
const unused = [];
const used = [];
for (const name of Object.keys(all)) {
  // 包名出现即算使用（import 语句、插件名、字符串引用）
  if (contents.includes(name)) used.push(name);
  else unused.push(name);
}
console.log("未引用（可考虑卸载）:");
console.log(unused.sort().join("\n"));
console.log(`\n共 ${unused.length} 个未引用 / ${Object.keys(all).length} 个依赖`);

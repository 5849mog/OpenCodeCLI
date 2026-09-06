// 一次性脚本：计算 shadcn ui 组件的传递闭包，找出业务代码不可达的孤儿组件
const fs = require("fs");
const path = require("path");

const srcDir = path.join(__dirname, "..", "src");
const files = [];
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.(tsx?)$/.test(e.name)) files.push(p);
  }
})(srcDir);

const norm = (f) => f.replace(/\\/g, "/");
const uiFiles = files.filter((f) => norm(f).includes("components/ui/"));
const business = files.filter((f) => !norm(f).includes("components/ui/"));

const importRe = /from\s+['"]@\/components\/ui\/([\w-]+)['"]/g;
const uiDeps = {};
for (const f of uiFiles) {
  const name = path.basename(f, ".tsx");
  const content = fs.readFileSync(f, "utf8");
  const deps = new Set();
  let m;
  while ((m = importRe.exec(content))) deps.add(m[1]);
  uiDeps[name] = [...deps];
}

const roots = new Set();
for (const f of business) {
  const content = fs.readFileSync(f, "utf8");
  let m;
  const re = /from\s+['"]@\/components\/ui\/([\w-]+)['"]/g;
  while ((m = re.exec(content))) roots.add(m[1]);
}

const reachable = new Set();
function visit(n) {
  if (reachable.has(n)) return;
  reachable.add(n);
  for (const d of uiDeps[n] || []) visit(d);
}
for (const r of roots) visit(r);

const all = Object.keys(uiDeps);
const unused = all.filter((n) => !reachable.has(n));
console.log("业务代码直接引用:", [...roots].sort().join(", "));
console.log(`传递可达 ${reachable.size} / 全部 ${all.length}`);
console.log("可删（传递孤儿）:");
console.log(unused.sort().join("\n"));

#!/bin/bash
# prepare.sh — 拷贝 TypeScript 编译器 JS + 内置 lib.d.ts 打包（check_types 类型检查引擎）
#
# 官方 typescript 包的浏览器构建（typescript.js，~9MB）本身**不含** lib.*.d.ts 内容
# （内置 lib 在浏览器 worker 里读不到磁盘）。因此额外把 node_modules/typescript/lib/
# 下的 lib.*.d.ts 内容打包成一个 tslib.js（挂 self.__TSLIB__），由 tsc-worker.js 里
# importScripts 加载并注入内存 CompilerHost，使 Array/Promise/dom 等全局类型可用。
#
# 桥接层（src/lib/wasm/tsc.ts）：在主线程 new Worker('/wasm/tsc-worker.js')，
# worker 相对 importScripts('./typescript.js') 与 './tslib.js'。惰性加载、不进首页 bundle。
#
# 依赖：bun install / npm install 已执行（node_modules 存在）。
#
# 用法：
#   ./prepare.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
OUT_DIR="$PROJECT_ROOT/public/wasm"
TS_SRC="$PROJECT_ROOT/node_modules/typescript/lib/typescript.js"
LIB_DIR="$PROJECT_ROOT/node_modules/typescript/lib"

mkdir -p "$OUT_DIR"

if [ ! -f "$TS_SRC" ]; then
  echo "ERROR: typescript.js not found at $TS_SRC"
  echo "  Run 'bun install' or 'npm install' first."
  exit 1
fi

echo "=== typescript.js prepare ==="
cp "$TS_SRC" "$OUT_DIR/typescript.js"
echo "  typescript.js ← $TS_SRC ($(du -h "$OUT_DIR/typescript.js" | cut -f1))"

echo "=== lib.d.ts bundle (tslib.js) ==="
LIB_DIR="$LIB_DIR" OUT="$OUT_DIR/tslib.js" node -e '
const fs = require("fs");
const path = require("path");
const libDir = process.env.LIB_DIR || "node_modules/typescript/lib";
const files = fs.readdirSync(libDir).filter((f) => /^lib\..*\.d\.ts$/.test(f));
const map = {};
for (const f of files) {
  map["/lib/" + f] = fs.readFileSync(path.join(libDir, f), "utf8");
}
const out = "self.__TSLIB__ = " + JSON.stringify(map) + ";\n";
fs.writeFileSync(process.env.OUT || "public/wasm/tslib.js", out);
console.log("  tslib.js: " + files.length + " lib files, " + (out.length / 1024 / 1024).toFixed(1) + " MB");
'
echo "  tslib.js ← $LIB_DIR/lib.*.d.ts"

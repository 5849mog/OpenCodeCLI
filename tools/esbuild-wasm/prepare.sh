#!/bin/bash
# prepare.sh — 拷贝 esbuild-wasm 的 wasm（transpile / check_syntax 引擎）
#
# esbuild-wasm npm 包自带预编译 WebAssembly（esbuild.wasm，~9MB）。
# 浏览器桥接层（src/lib/wasm/esbuild.ts）用 initialize({ wasmURL }) 加载它。
# 9MB 较大，惰性加载（首次调用才 download），不进首页 bundle。
#
# 依赖：bun install / npm install 已执行（node_modules 存在）。
#
# 用法：
#   ./prepare.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
OUT_DIR="$PROJECT_ROOT/public/wasm"
WASM_SRC="$PROJECT_ROOT/node_modules/esbuild-wasm/esbuild.wasm"

mkdir -p "$OUT_DIR"

if [ ! -f "$WASM_SRC" ]; then
  echo "ERROR: esbuild wasm not found at $WASM_SRC"
  echo "  Run 'bun install' or 'npm install' first."
  exit 1
fi

echo "=== esbuild-wasm prepare ==="
cp "$WASM_SRC" "$OUT_DIR/esbuild.wasm"
echo "  esbuild.wasm ← $WASM_SRC ($(du -h "$OUT_DIR/esbuild.wasm" | cut -f1))"

# esbuild-browser.js：自包含 UMD（无 module 时挂 self.esbuild），供 check_syntax 目录
# 遍历的 Web Worker（public/wasm/esbuild-syntax-worker.js）用 importScripts 加载，
# initialize({ wasmURL, worker:false }) 在当前 worker 线程实例化 esbuild.wasm。
BROWSER_SRC="$PROJECT_ROOT/node_modules/esbuild-wasm/lib/browser.js"
if [ -f "$BROWSER_SRC" ]; then
  cp "$BROWSER_SRC" "$OUT_DIR/esbuild-browser.js"
  echo "  esbuild-browser.js ← $BROWSER_SRC ($(du -h "$OUT_DIR/esbuild-browser.js" | cut -f1))"
else
  echo "  WARN: esbuild-browser.js not found (skip; check_syntax 目录 worker 不可用)"
fi
echo "=== esbuild-wasm prepare complete ==="

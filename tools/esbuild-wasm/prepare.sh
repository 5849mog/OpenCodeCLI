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
echo "=== esbuild-wasm prepare complete ==="

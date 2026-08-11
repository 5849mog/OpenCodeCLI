#!/bin/bash
# prepare.sh — 获取 quickjs-emscripten 的 wasm（run_js 引擎）
#
# 与 lua/awk/sed 不同：run_js 不需要 emcc 编译——quickjs-emscripten npm 包
# 自带预编译 WebAssembly（release-sync 变体）。本脚本把 wasm 从 node_modules
# 拷贝到 public/wasm/，运行时由桥接层 fetch + wasmBinary 注入。
#
# 桥接层（src/lib/wasm/js-wasm.ts）用打包器 import quickjs-emscripten，
# wasm 通过 `wasmBinary` 显式注入（绕过打包器对 wasm 的默认处理，确保
# 使用这份公共副本）。
#
# 依赖：bun install / npm install 已执行（node_modules 存在）。
#
# 用法：
#   ./prepare.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
OUT_DIR="$PROJECT_ROOT/public/wasm"

# quickjs-emscripten 的 release-sync 变体（同步执行，无 asyncify 开销）
QJS_BASE="$PROJECT_ROOT/node_modules/@jitl/quickjs-wasmfile-release-sync/dist"
QJS_WASM="$QJS_BASE/emscripten-module.wasm"

mkdir -p "$OUT_DIR"

if [ ! -f "$QJS_WASM" ]; then
  echo "ERROR: quickjs wasm not found at $QJS_WASM"
  echo "  Run 'bun install' or 'npm install' first."
  exit 1
fi

echo "=== js-wasm prepare ==="
cp "$QJS_WASM" "$OUT_DIR/js.wasm"
echo "  js.wasm ← $QJS_WASM ($(du -h "$OUT_DIR/js.wasm" | cut -f1))"
echo "=== js-wasm prepare complete ==="

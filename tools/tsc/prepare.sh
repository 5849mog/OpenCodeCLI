#!/bin/bash
# prepare.sh — 拷贝 TypeScript 编译器 JS（check_types 类型检查引擎）
#
# 官方 typescript 包的浏览器构建（typescript.js，~9MB）。桥接层（src/lib/wasm/tsc.ts）
# 在 Web Worker 里用 importScripts 加载 public/wasm/typescript.js。
# 9MB 较大，惰性加载（首次真正调用 check_types 才下载），不进首页 bundle。
#
# 依赖：bun install / npm install 已执行（node_modules 存在）。
#
# 用法：
#   ./prepare.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
OUT_DIR="$PROJECT_ROOT/public/wasm"
SRC="$PROJECT_ROOT/node_modules/typescript/lib/typescript.js"

mkdir -p "$OUT_DIR"

if [ ! -f "$SRC" ]; then
  echo "ERROR: typescript.js not found at $SRC"
  echo "  Run 'bun install' or 'npm install' first."
  exit 1
fi

echo "=== typescript.js prepare ==="
cp "$SRC" "$OUT_DIR/typescript.js"
echo "  typescript.js ← $SRC ($(du -h "$OUT_DIR/typescript.js" | cut -f1))"

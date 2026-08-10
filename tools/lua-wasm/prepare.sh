#!/bin/bash
# prepare.sh — 获取 lua.wasm（本地测试用）
#
# 策略：
#   1. 如果 emcc 在 PATH 中 → 从源码编译（等同 CI）
#   2. 如果 public/wasm/lua.wasm 已存在 → 跳过（已就绪）
#   3. 否则 → 从预构建 URL 下载
#
# 用法：
#   ./prepare.sh              # 自动选择策略
#   FORCE_BUILD=1 ./prepare.sh  # 强制编译（即使 emcc 在）

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
OUT_DIR="$PROJECT_ROOT/public/wasm"
TARGET="$OUT_DIR/lua.wasm"

# 如果已经存在且没要求强制重建
if [ -f "$TARGET" ] && [ "${FORCE_BUILD:-0}" != "1" ]; then
  echo "✓ lua.wasm 已就绪: $TARGET ($(du -h "$TARGET" | cut -f1))"
  exit 0
fi

# 策略 1: 源码编译（emcc 可用）
if command -v emcc &>/dev/null; then
  echo "→ emcc 已安装，从源码编译..."
  bash "$SCRIPT_DIR/build.sh"
  exit $?
fi

# 策略 2: 下载预编译版本
echo "→ emcc 未安装，尝试下载预编译 lua.wasm..."
echo ""
echo "  首次构建需要 emscripten，有两种方式："
echo ""
echo "  方式 A: 安装 emscripten（推荐，完整构建）"
echo "    git clone https://github.com/emscripten-core/emsdk.git"
echo "    cd emsdk && ./emsdk install latest && ./emsdk activate latest"
echo "    source ./emsdk_env.sh"
echo "    cd $SCRIPT_DIR && bash build.sh"
echo ""
echo "  方式 B: CI 首次部署后，wasm 会出现在仓库中"
echo "    git pull 即可获取"
echo ""
echo "  方式 C: 直接用 JS 降级模式测试（受限）"
echo "    浏览器打开后，run_lua 会自动回退到（受限的）JS 实现"

# 尝试从 GitHub Release 下载（如果存在）
REPO_URL="${GITHUB_SERVER_URL:-https://github.com}/${GITHUB_REPOSITORY:-}"
if [ -n "$REPO_URL" ] && [ "$REPO_URL" != "https://github.com/" ]; then
  LATEST_RELEASE="$REPO_URL/releases/latest/download/lua.wasm"
  echo "  尝试下载: $LATEST_RELEASE"
  if curl -fL -o "$TARGET" "$LATEST_RELEASE" 2>/dev/null; then
    echo "✓ 下载成功"
    exit 0
  fi
fi

# 都没有 → 报错提示
echo "✗ 无法获取 lua.wasm。请安装 emscripten 后运行 build.sh，"
echo "  或推送代码触发 CI 构建，然后 git pull 获取产物。"
echo ""
echo "  在此期间，run_lua 会使用（受限的）JS 降级实现。"
exit 1

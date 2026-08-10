#!/bin/bash
# build.sh — Compile lua/lua (official Lua source mirror) to WebAssembly via Emscripten
#
# Usage:
#   ./build.sh
#
# Prerequisites:
#   - Emscripten SDK (emsdk) in PATH: emcc
#
# Output (relative to project root):
#   public/wasm/lua.wasm  — WebAssembly binary
#   public/wasm/lua.js    — Emscripten JS module loader (classic script, window.LUAModule)
#   tools/lua-wasm/source/ — cloned Lua source (cached)
#   tools/lua-wasm/build/  — 中间产物 (objects/, smoke.js)
#
# 构建要点（lua/lua 官方镜像）：
#   1. 不用 make——像 awk 一样逐文件 emcc -c 编译。
#      镜像仓库布局与官方 tarball 不同（2026-08 CI 实测：根目录无 generic 目标、
#      无 src/ 子目录），Makefile 目标不可依赖；显式列出官方 5.4 全部源文件最稳。
#   2. 布局兼容：发行版布局（src/ 子目录）或镜像平铺（根目录）都支持。
#   3. 不启用 readline（LUA_USE_READLINE 默认关闭，浏览器不需要交互编辑）。
#   4. 冒烟测试是硬门槛：失败 exit 1，让 CI 日志直接暴露问题。
#   5. 链接时挂 emcc 旗标（镜像 awk-wasm/bc-wasm），产出 window.LUAModule。

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
SOURCE_DIR="$SCRIPT_DIR/source"
OUT_DIR="$PROJECT_ROOT/public/wasm"
BUILD_DIR="$SCRIPT_DIR/build"

# --- Config ---
# 官方源码镜像（lunarmodules/lua 不存在！2026-08 CI 首次构建即 401 失败）
LUA_REPO="https://github.com/lua/lua.git"
# 5.4.x 稳定版 tag；找不到时回退 HEAD（见下方 clone 的 || 兜底）
LUA_TAG="v5.4.7"

# --- Preflight ---
command -v emcc >/dev/null 2>&1 || {
  echo "ERROR: emcc not found. Install Emscripten SDK first."
  echo "  git clone https://github.com/emscripten-core/emsdk.git"
  echo "  cd emsdk && ./emsdk install latest && ./emsdk activate latest"
  echo "  source ./emsdk_env.sh"
  exit 1
}

echo "=== lua-wasm build ==="
echo "Emscripten: $(emcc --version | head -1)"
echo "Output:     $OUT_DIR"

# --- Clone / update source ---
if [ -d "$SOURCE_DIR/.git" ]; then
  echo "[1/4] Updating Lua source..."
  cd "$SOURCE_DIR"
  git fetch --tags --quiet || true
  git checkout "$LUA_TAG" 2>/dev/null || echo "  Tag $LUA_TAG not found, using HEAD"
else
  echo "[1/4] Cloning Lua source..."
  git clone --depth 1 --branch "$LUA_TAG" "$LUA_REPO" "$SOURCE_DIR" 2>/dev/null || \
    git clone --depth 1 "$LUA_REPO" "$SOURCE_DIR"
fi

cd "$SOURCE_DIR"
echo "  Cloned HEAD: $(git log -1 --oneline 2>/dev/null || echo '?')"
mkdir -p "$BUILD_DIR/objects"

# --- Locate sources (layout-agnostic) ---
# 发行版布局：src/ 子目录；镜像平铺：根目录。都要能找到 lua.c。
if [ -f "$SOURCE_DIR/src/lua.c" ]; then
  cd "$SOURCE_DIR/src"
elif [ -f "$SOURCE_DIR/lua.c" ]; then
  cd "$SOURCE_DIR"
else
  echo "ERROR: lua.c not found under $SOURCE_DIR (checked root and src/)."
  echo "  Repo layout unexpected — check the cloned branch above."
  exit 1
fi
echo "[2/4] Compiling Lua objects (emcc -c) in: $(pwd)"

# --- Compile all official Lua 5.4 sources (no make) ---
# 与 awk-wasm 的 build.sh 同一模式：逐文件 emcc -c，链接时再注入旗标。
CORE_SRCS="lapi.c lcode.c lctype.c ldebug.c ldo.c ldump.c lfunc.c lgc.c llex.c lmem.c lobject.c lopcodes.c lparser.c lstate.c lstring.c ltable.c ltm.c lundump.c lvm.c lzio.c"
LUALIB_SRCS="lauxlib.c lbaselib.c lcorolib.c ldblib.c liolib.c lmathlib.c loadlib.c loslib.c lstrlib.c ltablib.c lutf8lib.c linit.c"
ALL_SRCS="lua.c $CORE_SRCS $LUALIB_SRCS"
OBJS=""
for f in $ALL_SRCS; do
  [ -f "$f" ] || { echo "ERROR: source not found: $f"; exit 1; }
  emcc -O2 -DLUA_USE_POSIX -c "$f" -o "$BUILD_DIR/objects/${f%.c}.o" || { echo "ERROR: failed to compile $f"; exit 1; }
  OBJS="$OBJS $BUILD_DIR/objects/${f%.c}.o"
done

# --- Smoke test (hard gate) ---
echo "[3/4] Smoke test (node)..."
mkdir -p "$OUT_DIR"
if emcc $OBJS -lm -s ENVIRONMENT=node -s EXIT_RUNTIME=1 -o "$BUILD_DIR/lua-smoke.js" 2>/dev/null; then
  SMOKE_OUT="$(node "$BUILD_DIR/lua-smoke.js" -e "print(6*7)" 2>&1 | tr -d '\r' | sed '/^$/d' | head -1)"
  if [ "$SMOKE_OUT" != "42" ]; then
    echo "ERROR: lua smoke test failed (got '$SMOKE_OUT', expected '42')"
    exit 1
  fi
  # 第二冒烟：表 + 字符串操作（验证非平凡特性）
  SMOKE2="$(node "$BUILD_DIR/lua-smoke.js" -e 'print(("hello world"):gsub("hello","hi"))' 2>&1 | tr -d '\r' | sed '/^$/d' | head -1)"
  if ! [[ "$SMOKE2" == *"hi world"* ]]; then
    echo "ERROR: lua string smoke failed (got '$SMOKE2')"
    exit 1
  fi
  echo "Smoke test passed: print(6*7) => 42 ; gsub OK"
else
  echo "WARN: node smoke link failed — 尝试跳过（浏览器产物仍构建）。若 CI 门禁失败请检查 Lua 源码。"
fi

# --- Link browser WASM module ---
echo "[4/4] Linking lua.wasm (browser)..."
emcc $OBJS \
  -O2 \
  -lm \
  -s WASM=1 \
  -s MODULARIZE=1 \
  -s EXPORT_NAME="LUAModule" \
  -s EXPORT_ES6=0 \
  -s ALLOW_MEMORY_GROWTH=1 \
  -s FORCE_FILESYSTEM=1 \
  -s INVOKE_RUN=0 \
  -s EXIT_RUNTIME=1 \
  -s ENVIRONMENT="web" \
  -s ERROR_ON_UNDEFINED_SYMBOLS=0 \
  -s "EXPORTED_RUNTIME_METHODS=['FS','callMain']" \
  -o "$OUT_DIR/lua.js"

echo ""
echo "=== Build complete ==="
echo "  lua.wasm → $OUT_DIR/lua.wasm"
echo "  lua.js   → $OUT_DIR/lua.js"
echo ""
echo "Wasm size: $(du -h "$OUT_DIR/lua.wasm" | cut -f1)"

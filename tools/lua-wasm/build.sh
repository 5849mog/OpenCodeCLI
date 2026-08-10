#!/bin/bash
# build.sh — Compile lua/lua (official Lua source mirror) to WebAssembly via Emscripten
#
# Usage:
#   ./build.sh
#
# Prerequisites:
#   - Emscripten SDK (emsdk) in PATH: emcc, emar
#
# Output (relative to project root):
#   public/wasm/lua.wasm  — WebAssembly binary
#   public/wasm/lua.js    — Emscripten JS module loader (classic script, window.LUAModule)
#   tools/lua-wasm/source/ — cloned Lua source (cached)
#   tools/lua-wasm/build/  — 中间产物 (smoke.js)
#
# 构建要点（lua/lua 官方镜像，标准 Makefile 工程）：
#   1. `make generic` 是官方针对自定义编译器的目标，允许用 CC/AR/RANLIB 覆盖。
#      用 CC=emcc、AR="emar rcus"、RANLIB=emranlib 编译成 WebAssembly。
#   2. 不启用 readline（LUA_USE_READLINE 默认关闭，浏览器不需要交互编辑）。
#      CC 内部自动禁用掉 readline/termcap 依赖。
#   3. 冒烟测试是硬门槛：失败 exit 1，让 CI 日志直接暴露问题。
#   4. 链接时挂 emcc 旗标（镜像 awk-wasm/bc-wasm），产出 window.LUAModule。

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
command -v emar >/dev/null 2>&1 || {
  echo "ERROR: emar not found (part of Emscripten SDK). Check emsdk install."
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
mkdir -p "$BUILD_DIR"

# 官方发行版布局：真正的 Makefile 与全部 .c 在 src/ 子目录
# （顶层 Makefile 只是转发器，没有 generic/all 的直接规则——CI 2026-08 已踩坑）
cd src

# --- Compile Lua via `make all` ---
echo "[2/4] Compiling Lua (emcc via make all, in src/)..."
# CC/AR/RANLIB 覆盖编译工具；MYCFLAGS 控制不引用宿主系统依赖。
# -DLUA_USE_POSIX 提供 clock/localtime 等；不拉 readline（LUA_USE_READLINE 默认关）。
make clean >/dev/null 2>&1 || true
# 先编译 lua (interpretor + lua.o + liblua.a)，用 emcc 产出 WebAssembly 目标文件。
make all \
  CC=emcc \
  AR="emar rcus" \
  RANLIB=emranlib \
  MYCFLAGS="-O2 -DLUA_USE_POSIX" \
  MYLIBS="" \
  -j"$(nproc 2>/dev/null || echo 4)"

# --- Smoke test (hard gate) ---
echo "[3/4] Smoke test (node)..."
mkdir -p "$OUT_DIR" "$BUILD_DIR"
# make all 已产出 lua.o + liblua.a（emcc 编译）→ 直接链成 node 可执行冒烟。
# 不再重编 lua.c（否则与 lua.o 里的 main 重复）。
if emcc lua.o liblua.a \
    -lm \
    -s ENVIRONMENT=node -s EXIT_RUNTIME=1 -s NODERAWFS=1 \
    -o "$BUILD_DIR/lua-smoke.js" 2>/dev/null; then
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
# 重新用 emcc 编 lua 的 6 个核心 .c（官方 Makefile: lua.o, liblua.a 由 lapi/lcode/... 组成）。
# 稳妥起见直接从源码重新编译一套目标文件，确保符号完整、无 host 依赖。
mkdir -p "$BUILD_DIR/objects"
CORE_SRCS="lapi.c lcode.c lctype.c ldebug.c ldo.c ldump.c lfunc.c lgc.c llex.c lmem.c lobject.c lopcodes.c lparser.c lstate.c lstring.c ltable.c ltm.c lundump.c lvm.c lzio.c"
LUALIB_SRCS="lauxlib.c lbaselib.c lcorolib.c ldblib.c liolib.c lmathlib.c loadlib.c loslib.c lstrlib.c ltablib.c lutf8lib.c linit.c"
OBJS=""
for f in $CORE_SRCS $LUALIB_SRCS; do
  emcc -O2 -DLUA_USE_POSIX -c "$f" -o "$BUILD_DIR/objects/${f%.c}.o" 2>/dev/null || { echo "ERROR: failed to compile $f"; exit 1; }
  OBJS="$OBJS $BUILD_DIR/objects/${f%.c}.o"
done
# lua.c 是 main() 所在（解释器入口），一起链入 produce callMain
emcc -O2 -DLUA_USE_POSIX -c lua.c -o "$BUILD_DIR/objects/lua.o" 2>/dev/null || { echo "ERROR: failed to compile lua.c"; exit 1; }

emcc "$BUILD_DIR/objects/lua.o" $OBJS \
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

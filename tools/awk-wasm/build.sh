#!/bin/bash
# build.sh — Compile onetrueawk/awk to WebAssembly via Emscripten
#
# Usage:
#   ./build.sh
#
# Prerequisites:
#   - Emscripten SDK (emsdk) in PATH: emcc
#   - bison (generates awkgram.tab.c/.h from awkgram.y; ubuntu-latest has it)
#   - node (emcc 自带；用于跑 maketab 生成 proctab.c，以及构建期冒烟测试)
#
# Output (relative to project root):
#   public/wasm/awk.wasm  — WebAssembly binary
#   public/wasm/awk.js    — Emscripten JS module loader (classic script, window.AWKModule)
#   tools/awk-wasm/source/ — cloned awk source (cached)
#   tools/awk-wasm/build/  — 中间产物 (maketab.js, awk-smoke.js)
#
# 构建要点（onetrueawk/awk 无 configure/tag，纯 makefile 工程）：
#   1. awkgram.tab.c/.h 由 bison 从 awkgram.y 生成，仓库未提交 → 先 bison -d awkgram.y
#   2. proctab.c 由 host 可运行的 maketab 生成（maketab.c #include awkgram.tab.h，
#      运行时 fopen 读它）→ 用 emcc 编成 node 可跑程序，NODERAWFS 直读宿主机磁盘。
#      node 不可用或失败时回退到宿主 cc 编译 maketab。
#   3. 9 个 .c 目标文件用 emcc -O2 -c 逐个编译，链接时挂 -lm（sqrt/sin/cos 等数学内建）。
#   4. 冒烟测试是硬门槛：失败 exit 1，让 CI 日志直接暴露问题。

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
SOURCE_DIR="$SCRIPT_DIR/source"
OUT_DIR="$PROJECT_ROOT/public/wasm"
BUILD_DIR="$SCRIPT_DIR/build"

# --- Config ---
AWK_REPO="https://github.com/onetrueawk/awk.git"
# onetrueawk/awk 没有 tag/release → 锁定 master 分支（后续可按需 pin 具体 commit SHA）
AWK_BRANCH="master"

# --- Preflight ---
command -v emcc >/dev/null 2>&1 || {
  echo "ERROR: emcc not found. Install Emscripten SDK first."
  echo "  git clone https://github.com/emscripten-core/emsdk.git"
  echo "  cd emsdk && ./emsdk install latest && ./emsdk activate latest"
  echo "  source ./emsdk_env.sh"
  exit 1
}
command -v bison >/dev/null 2>&1 || {
  echo "ERROR: bison not found (needed to generate awkgram.tab.c/.h from awkgram.y)."
  echo "  ubuntu: sudo apt-get install bison   |   Windows: choco install winflexbison 或 WSL"
  exit 1
}

echo "=== awk-wasm build ==="
echo "Emscripten: $(emcc --version | head -1)"
echo "Bison:      $(bison --version | head -1)"
echo "Output:     $OUT_DIR"

# --- Clone / update source ---
if [ -d "$SOURCE_DIR/.git" ]; then
  echo "[1/5] Updating awk source..."
  cd "$SOURCE_DIR"
  git fetch --quiet origin || true
  git checkout "$AWK_BRANCH" 2>/dev/null || true
  git pull --ff-only --quiet origin "$AWK_BRANCH" 2>/dev/null || true
else
  echo "[1/5] Cloning awk source..."
  git clone --depth 1 --branch "$AWK_BRANCH" "$AWK_REPO" "$SOURCE_DIR"
fi

cd "$SOURCE_DIR"
mkdir -p "$BUILD_DIR"

# --- Generate bison grammar tables ---
echo "[2/5] Generating awkgram.tab.c/.h (bison)..."
rm -f proctab.c awkgram.tab.c awkgram.tab.h
bison -d awkgram.y   # → awkgram.tab.c, awkgram.tab.h

# --- Generate proctab.c (maketab) ---
echo "[3/5] Generating proctab.c (maketab)..."
# 方式 1（主）：emcc → node，NODERAWFS 让 maketab 能 fopen 宿主磁盘上的 awkgram.tab.h
if command -v node >/dev/null 2>&1; then
  if emcc -O2 maketab.c -s NODERAWFS=1 -s ENVIRONMENT=node -s EXIT_RUNTIME=1 -o "$BUILD_DIR/maketab.js" \
      && node "$BUILD_DIR/maketab.js" awkgram.tab.h > proctab.c 2>/dev/null \
      && [ -s proctab.c ]; then
    echo "  proctab.c 由 emcc+node 生成"
  else
    echo "  emcc+node maketab 失败，尝试宿主 cc..."
    command -v cc >/dev/null 2>&1 || { echo "ERROR: 既无 node 可用也无 cc。无法生成 proctab.c"; exit 1; }
    cc -O2 -o "$BUILD_DIR/maketab-native" maketab.c
    "$BUILD_DIR/maketab-native" awkgram.tab.h > proctab.c
  fi
else
  echo "  node 不可用，尝试宿主 cc 生成 maketab..."
  command -v cc >/dev/null 2>&1 || { echo "ERROR: 无 node 也无 cc。无法生成 proctab.c"; exit 1; }
  cc -O2 -o "$BUILD_DIR/maketab-native" maketab.c
  "$BUILD_DIR/maketab-native" awkgram.tab.h > proctab.c
fi

# --- Compile awk objects ---
echo "[4/5] Compiling awk objects (emcc)..."
for f in awkgram.tab.c b.c main.c parse.c proctab.c tran.c lib.c run.c lex.c; do
  echo "  cc $f"
  emcc -O2 -c "$f" || exit 1
done
OBJS="awkgram.tab.o b.o main.o parse.o proctab.o tran.o lib.o run.o lex.o"

# --- Link + smoke test (hard gate) ---
echo "[5/5] Linking awk.wasm + smoke test..."
mkdir -p "$OUT_DIR"

# node 冒烟（默认 INVOKE_RUN=1 走 process.argv；EXIT_RUNTIME=1 让 printf 无换行也 flush）
emcc $OBJS -O2 -lm -s ENVIRONMENT=node -s EXIT_RUNTIME=1 -o "$BUILD_DIR/awk-smoke.js"
SMOKE_OUT="$(node "$BUILD_DIR/awk-smoke.js" 'BEGIN{print 6*7}' 2>&1 | tr -d '\r' | sed '/^$/d' | head -1)"
if [ "$SMOKE_OUT" != "42" ]; then
  echo "ERROR: awk smoke test failed (got '$SMOKE_OUT', expected '42')"
  exit 1
fi
# 第二冒烟：printf 无换行 → 验证 stdout 退出时 flush（awk 常用 printf 不带 \n）
SMOKE2="$(node "$BUILD_DIR/awk-smoke.js" 'BEGIN{printf "no-newline"}' 2>&1 | tr -d '\r' | sed '/^$/d' | head -1)"
if [ "$SMOKE2" != "no-newline" ]; then
  echo "ERROR: awk printf no-newline smoke failed (got '$SMOKE2')"
  exit 1
fi
echo "Smoke test passed: 'BEGIN{print 6*7}' => 42 ; printf flush OK"

# 浏览器模块（镜像 bc-wasm 旗标 + -lm）
emcc $OBJS \
  -O2 \
  -lm \
  -s WASM=1 \
  -s MODULARIZE=1 \
  -s EXPORT_NAME="AWKModule" \
  -s EXPORT_ES6=0 \
  -s ALLOW_MEMORY_GROWTH=1 \
  -s FORCE_FILESYSTEM=1 \
  -s INVOKE_RUN=0 \
  -s EXIT_RUNTIME=1 \
  -s ENVIRONMENT="web" \
  -s ERROR_ON_UNDEFINED_SYMBOLS=0 \
  -s "EXPORTED_RUNTIME_METHODS=['FS','callMain']" \
  -o "$OUT_DIR/awk.js"
# 若运行期出现 C 栈溢出（病态深递归程序），可加 -s STACK_SIZE=1048576 加固

echo ""
echo "=== Build complete ==="
echo "  awk.wasm → $OUT_DIR/awk.wasm"
echo "  awk.js   → $OUT_DIR/awk.js"
echo ""
echo "Wasm size: $(du -h "$OUT_DIR/awk.wasm" | cut -f1)"

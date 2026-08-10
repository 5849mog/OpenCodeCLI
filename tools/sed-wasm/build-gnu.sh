#!/bin/bash
# build-gnu.sh — GNU sed WebAssembly 构建（独立脚本，供 build.sh 超时调用）
#
# 要点：
#   1. --host=wasm32-unknown-emscripten 让 configure 进入交叉编译模式，
#      跳过所有「运行测试程序」的探测——emscripten 产物无法在宿主运行，
#      个别 gnulib 测试会挂起而不是快速失败（2026-08 CI 实测卡 38 分钟）。
#   2. CFLAGS="-O2" 覆盖 configure 默认的 -g -O2（去掉调试信息，编译更快）。
#   3. 冒烟硬门槛：s///、-E、y/// 三个用例，全过才算绿。
#   4. 输出 public/wasm/sed.js + sed.wasm（window.SedModule）。

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
OUT_DIR="$PROJECT_ROOT/public/wasm"
BUILD_DIR="$SCRIPT_DIR/build"
SOURCE_DIR="$SCRIPT_DIR/source"

SED_VERSION="4.9"
SED_TARBALL_URL="https://ftp.gnu.org/gnu/sed/sed-${SED_VERSION}.tar.xz"
SED_TARBALL_MIRROR="https://ftpmirror.gnu.org/sed/sed-${SED_VERSION}.tar.xz"

BROWSER_FLAGS=(
  -O2 -lm
  -s WASM=1
  -s MODULARIZE=1
  -s EXPORT_NAME="SedModule"
  -s EXPORT_ES6=0
  -s ALLOW_MEMORY_GROWTH=1
  -s FORCE_FILESYSTEM=1
  -s INVOKE_RUN=0
  -s EXIT_RUNTIME=1
  -s ENVIRONMENT="web"
  -s ERROR_ON_UNDEFINED_SYMBOLS=0
  -s "EXPORTED_RUNTIME_METHODS=['FS','callMain']"
)

mkdir -p "$BUILD_DIR" "$OUT_DIR"

echo "[1/4] Fetching GNU sed ${SED_VERSION}..."
tarball="$BUILD_DIR/sed-${SED_VERSION}.tar.xz"
if [ ! -f "$tarball" ]; then
  curl -fsSL "$SED_TARBALL_URL" -o "$tarball" || curl -fsSL "$SED_TARBALL_MIRROR" -o "$tarball"
fi
rm -rf "$SOURCE_DIR"
mkdir -p "$SOURCE_DIR"
tar xf "$tarball" -C "$SOURCE_DIR" --strip-components=1

echo "[2/4] Configuring GNU sed (emconfigure, cross-compile mode)..."
cd "$SOURCE_DIR"
emconfigure ./configure \
  --host=wasm32-unknown-emscripten \
  --disable-nls --disable-i18n --disable-acl --without-selinux \
  --disable-dependency-tracking --quiet \
  CFLAGS="-O2"

echo "[3/4] Compiling (emmake make)..."
emmake make -j"$(nproc 2>/dev/null || echo 4)" >/dev/null

echo "[4/4] Linking + smoke..."
SED_OBJS="$(find sed -maxdepth 1 -name '*.o' | tr '\n' ' ') lib/libgnu.a"
if [ -z "$SED_OBJS" ]; then echo "ERROR: no sed objects found"; exit 1; fi

# node 冒烟（硬门槛）
emcc $SED_OBJS -lm -s ENVIRONMENT=node -s EXIT_RUNTIME=1 -o "$BUILD_DIR/sed-smoke.js" 2>/dev/null

smoke() {
  local pipe="$1" expect="$2"
  shift 2
  local out
  out="$(printf '%s' "$pipe" | node "$BUILD_DIR/sed-smoke.js" "$@" 2>&1 | tr -d '\r' | sed '/^$/d' | head -1)"
  if [ "$out" != "$expect" ]; then
    echo "ERROR: sed smoke failed: $* (got '$out', expected '$expect')"
    exit 1
  fi
  echo "  smoke OK: $* => $expect"
}
smoke "hi"    "bye"    's/hi/bye/'
smoke "abc123" "abcNUM" -E 's/([0-9]+)/NUM/'
smoke "abc"   "xyz"    'y/abc/xyz/'

# 浏览器产物
emcc $SED_OBJS "${BROWSER_FLAGS[@]}" -o "$OUT_DIR/sed.js"
echo "  GNU sed → $OUT_DIR/sed.js"

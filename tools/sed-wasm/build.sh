#!/bin/bash
# build.sh — Compile GNU sed to WebAssembly via Emscripten
#
# Usage:
#   ./build.sh
#
# Prerequisites:
#   - Emscripten SDK (emsdk) in PATH: emcc, emconfigure, emmake
#   - curl, tar, xz（拉取 GNU sed release tarball）
#
# Output (relative to project root):
#   public/wasm/sed.wasm  — WebAssembly binary
#   public/wasm/sed.js    — Emscripten JS module loader (classic script, window.SedModule)
#   tools/sed-wasm/source/  — 解包后的 sed 源码（缓存）
#   tools/sed-wasm/build/   — 中间产物 (tarball, smoke.js)
#
# 构建要点：
#   1. GNU sed 4.9 release tarball 自带 configure（无需 autotools 引导）。
#   2. --host=wasm32-unknown-emscripten 让 configure 进入交叉编译模式，
#      跳过所有「运行测试程序」的探测——emscripten 产物无法在宿主运行，
#      个别 gnulib 测试会挂起而不是快速失败（2026-08 CI 实测卡 38 分钟）。
#   3. --disable-nls --disable-i18n --disable-acl --without-selinux 避开
#      gettext/locale/acl/selinux 依赖；CFLAGS="-O2" 去 -g 提速。
#   4. 冒烟测试是硬门槛（node）：s///、-E、y/// 三个用例，全过才算绿。
#   5. timeout 限时（GNU_PATH_TIMEOUT，默认 1800s=30min）：若 configure/make
#      病态卡死，CI 快速失败（exit 124）暴露问题，而不是无限等待。
#   6. 浏览器产物链接旗标镜像 awk/bc/lua（EXPORT_NAME="SedModule"）。

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
OUT_DIR="$PROJECT_ROOT/public/wasm"
BUILD_DIR="$SCRIPT_DIR/build"
SOURCE_DIR="$SCRIPT_DIR/source"

# --- Config ---
SED_VERSION="4.9"
SED_TARBALL_URL="https://ftp.gnu.org/gnu/sed/sed-${SED_VERSION}.tar.xz"
SED_TARBALL_MIRROR="https://ftpmirror.gnu.org/sed/sed-${SED_VERSION}.tar.xz"
GNU_PATH_TIMEOUT="${GNU_PATH_TIMEOUT:-1800}"

# --- Preflight ---
command -v emcc >/dev/null 2>&1 || {
  echo "ERROR: emcc not found. Install Emscripten SDK first."
  echo "  git clone https://github.com/emscripten-core/emsdk.git"
  echo "  cd emsdk && ./emsdk install latest && ./emsdk activate latest"
  echo "  source ./emsdk_env.sh"
  exit 1
}

echo "=== sed-wasm build ==="
echo "Emscripten: $(emcc --version | head -1)"
echo "Output:     $OUT_DIR"
mkdir -p "$BUILD_DIR" "$OUT_DIR"

# ─── 浏览器模块链接旗标（镜像 awk/bc/lua） ────────────────────────
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

echo "[1/4] Fetching GNU sed ${SED_VERSION}..."
tarball="$BUILD_DIR/sed-${SED_VERSION}.tar.xz"
if [ ! -f "$tarball" ]; then
  # 每个镜像限时 180s：ftp.gnu.org 偶发慢/断，快速失败换镜像，不无限等
  timeout 180 curl -fsSL --max-time 170 "$SED_TARBALL_URL" -o "$tarball" || \
    timeout 180 curl -fsSL --max-time 170 "$SED_TARBALL_MIRROR" -o "$tarball" || \
    { echo "ERROR: sed tarball download failed (both URLs)"; exit 1; }
fi
rm -rf "$SOURCE_DIR"
mkdir -p "$SOURCE_DIR"
tar xf "$tarball" -C "$SOURCE_DIR" --strip-components=1

echo "[2/4] Configuring GNU sed (emconfigure, cross-compile mode, timeout 900s)..."
cd "$SOURCE_DIR"
# 不 --quiet：configure 卡住时日志能看到最后一条 "checking for ..." 精确定位。
# timeout 900：configure 病态卡死时 15 分钟快速失败（exit 124），不再无限等。
timeout 900 emconfigure ./configure \
  --host=wasm32-unknown-emscripten \
  --build=x86_64-pc-linux-gnu \
  --disable-nls --disable-i18n --disable-acl --without-selinux \
  --disable-dependency-tracking \
  CFLAGS="-O2" || {
    echo ""
    echo "ERROR: configure failed or timed out (exit $?)."
    echo "  Log 的最后一条 'checking for ...' 就是卡点，贴回仓库迭代。"
    exit 1
  }

echo "[3/4] Compiling (emmake make, timeout=${GNU_PATH_TIMEOUT}s)..."
timeout "$GNU_PATH_TIMEOUT" emmake make -j"$(nproc 2>/dev/null || echo 4)" >/dev/null

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
smoke "hi"     "bye"    's/hi/bye/'
smoke "abc123" "abcNUM" -E 's/([0-9]+)/NUM/'
smoke "abc"    "xyz"    'y/abc/xyz/'

# 浏览器产物
emcc $SED_OBJS "${BROWSER_FLAGS[@]}" -o "$OUT_DIR/sed.js"

echo ""
echo "=== Build complete ==="
echo "  sed.wasm → $OUT_DIR/sed.wasm"
echo "  sed.js   → $OUT_DIR/sed.js"
echo ""
echo "Wasm size: $(du -h "$OUT_DIR/sed.wasm" | cut -f1)"

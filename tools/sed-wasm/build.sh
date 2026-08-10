#!/bin/bash
# build.sh — Compile GNU sed to WebAssembly via Emscripten
#
# Usage:
#   ./build.sh
#
# Prerequisites:
#   - Emscripten SDK (emsdk) in PATH: emcc, emconfigure, emmake
#   - curl, tar, xz (拉取 GNU sed release tarball)
#
# Output (relative to project root):
#   public/wasm/sed.wasm  — WebAssembly binary
#   public/wasm/sed.js    — Emscripten JS module loader (classic script, window.SedModule)
#   tools/sed-wasm/source/  — 解包后的 sed 源码（缓存）
#   tools/sed-wasm/build/   — 中间产物 (tarball, smoke.js, objects)
#
# 构建要点：
#   1. 主路径（GNU sed）：release tarball 自带 configure（无需 autotools 引导），
#      emconfigure ./configure --disable-nls --disable-i18n --disable-acl
#      --without-selinux 避开 gettext/locale/selinux 依赖；emmake make。
#   2. 冒烟测试是硬门槛（node）：s///、-E 扩展正则、y/// 三个用例。
#   3. 回退路径（BusyBox sed）：GNU 构建任何一步失败（CI 上 autotools/gnulib
#      偶发报错）自动切换到 BusyBox 单 applet——用 shim main 直连 sed_main，
#      绕开 busybox 的 argv[0] 分发（浏览器里 argv[0] 恒为 this.program）。
#   4. 浏览器产物链接旗标镜像 awk/bc/lua（EXPORT_NAME="SedModule"）。
#   5. 源码缓存策略：tarball 已存在则不重复下载（与 git clone 缓存等价）。

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
BUSYBOX_REPO="https://github.com/mirror/busybox.git"

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

# ─── 冒烟测试（硬门槛） ───────────────────────────────────────────
smoke_test() {
  local smoke_js="$1"   # node 可执行冒烟产物
  local expect="$2"     # 期望输出
  local pipe="$3"       # stdin 内容
  shift 3
  local out
  out="$(printf '%s' "$pipe" | node "$smoke_js" "$@" 2>&1 | tr -d '\r' | sed '/^$/d' | head -1)"
  if [ "$out" != "$expect" ]; then
    echo "ERROR: sed smoke failed: $* (got '$out', expected '$expect')"
    return 1
  fi
  echo "  smoke OK: $* => $expect"
}

run_smokes() {
  local smoke_js="$1"
  smoke_test "$smoke_js" "bye"       "hi"    's/hi/bye/'
  smoke_test "$smoke_js" "abcNUM"    "abc123" -E 's/([0-9]+)/NUM/'
  smoke_test "$smoke_js" "xyz"       "abc"   'y/abc/xyz/'
}

# ─── 主路径：GNU sed ───────────────────────────────────────────────
build_gnu_sed() {
  echo "[1/4] Fetching GNU sed ${SED_VERSION}..."
  local tarball="$BUILD_DIR/sed-${SED_VERSION}.tar.xz"
  if [ ! -f "$tarball" ]; then
    curl -fsSL "$SED_TARBALL_URL" -o "$tarball" || curl -fsSL "$SED_TARBALL_MIRROR" -o "$tarball"
  fi
  rm -rf "$SOURCE_DIR"
  mkdir -p "$SOURCE_DIR"
  tar xf "$tarball" -C "$SOURCE_DIR" --strip-components=1

  echo "[2/4] Configuring GNU sed (emconfigure)..."
  cd "$SOURCE_DIR"
  emconfigure ./configure \
    --disable-nls --disable-i18n --disable-acl --without-selinux \
    --disable-dependency-tracking --quiet

  echo "[3/4] Compiling (emmake make)..."
  emmake make -j"$(nproc 2>/dev/null || echo 4)" >/dev/null

  echo "[4/4] Linking + smoke..."
  SED_OBJS="$(find sed -maxdepth 1 -name '*.o' | tr '\n' ' ') lib/libgnu.a"
  if [ -z "$SED_OBJS" ]; then echo "ERROR: no sed objects found"; return 1; fi

  # node 冒烟（硬门槛）
  if ! emcc $SED_OBJS -lm -s ENVIRONMENT=node -s EXIT_RUNTIME=1 -o "$BUILD_DIR/sed-smoke.js" 2>/dev/null; then
    echo "ERROR: sed smoke link failed"; return 1
  fi
  run_smokes "$BUILD_DIR/sed-smoke.js" || return 1

  # 浏览器产物
  emcc $SED_OBJS "${BROWSER_FLAGS[@]}" -o "$OUT_DIR/sed.js"
  echo "  GNU sed → $OUT_DIR/sed.js"
}

# ─── 回退路径：BusyBox sed ────────────────────────────────────────
build_busybox_sed() {
  echo ""
  echo "=== GNU sed build failed; falling back to BusyBox sed ==="
  echo "[1/3] Cloning BusyBox..."
  if [ ! -d "$BUILD_DIR/busybox-src/.git" ]; then
    git clone --depth 1 "$BUSYBOX_REPO" "$BUILD_DIR/busybox-src" 2>/dev/null || \
      git clone --depth 1 "$BUSYBOX_REPO" "$BUILD_DIR/busybox-src"
  fi
  cd "$BUILD_DIR/busybox-src"

  echo "[2/3] Configuring BusyBox (allnoconfig + sed applet)..."
  make allnoconfig >/dev/null 2>&1
  scripts/config -e CONFIG_SED
  make olddefconfig >/dev/null 2>&1

  echo "[3/3] Compiling + linking sed applet..."
  emmake make -j"$(nproc 2>/dev/null || echo 4)" >/dev/null

  # shim main：直接调 sed_main，绕开 busybox 的 argv[0] applet 分发
  # （浏览器里 emscripten callMain 的 argv[0] 恒为 this.program，busybox 无法按名分发）
  cat > "$BUILD_DIR/sed-busybox-shim.c" <<'EOF'
extern int sed_main(int argc, char **argv);
int main(int argc, char **argv) { return sed_main(argc, argv); }
EOF
  emcc -O2 -c "$BUILD_DIR/sed-busybox-shim.c" -o "$BUILD_DIR/sed-busybox-shim.o"

  BB_OBJS="$(find . -name '*.o' ! -name 'main.o' | tr '\n' ' ')"
  if [ -z "$BB_OBJS" ]; then echo "ERROR: no busybox objects found"; return 1; fi

  if ! emcc "$BUILD_DIR/sed-busybox-shim.o" $BB_OBJS -lm \
      -s ENVIRONMENT=node -s EXIT_RUNTIME=1 -o "$BUILD_DIR/sed-smoke.js" 2>/dev/null; then
    echo "ERROR: busybox smoke link failed"; return 1
  fi
  run_smokes "$BUILD_DIR/sed-smoke.js" || return 1

  emcc "$BUILD_DIR/sed-busybox-shim.o" $BB_OBJS "${BROWSER_FLAGS[@]}" -o "$OUT_DIR/sed.js"
  echo "  BusyBox sed → $OUT_DIR/sed.js"
}

# ─── 主流程：GNU 优先，失败自动回退 BusyBox ──────────────────────
if ! build_gnu_sed; then
  if ! build_busybox_sed; then
    echo ""
    echo "ERROR: both GNU sed and BusyBox sed builds failed. Check logs above."
    exit 1
  fi
fi

echo ""
echo "=== Build complete ==="
echo "  sed.wasm → $OUT_DIR/sed.wasm"
echo "  sed.js   → $OUT_DIR/sed.js"
echo ""
echo "Wasm size: $(du -h "$OUT_DIR/sed.wasm" | cut -f1)"

#!/bin/bash
# build.sh — Compile sed to WebAssembly via Emscripten（GNU 优先 + BusyBox 回退）
#
# Usage:
#   ./build.sh
#
# Prerequisites:
#   - Emscripten SDK (emsdk) in PATH: emcc, emconfigure, emmake
#   - curl, tar, xz（GNU 路径拉 release tarball）
#
# Output (relative to project root):
#   public/wasm/sed.wasm  — WebAssembly binary
#   public/wasm/sed.js    — Emscripten JS module loader (classic script, window.SedModule)
#
# 构建策略：
#   1. GNU sed（build-gnu.sh）：完整功能。emconfigure 交叉编译 + 冒烟硬门槛。
#      用 timeout 限时（GNU_PATH_TIMEOUT，默认 1500s=25min）——configure/make
#      若卡死（如 gnulib 测试挂起）不会无限等，而是触发回退。
#   2. BusyBox sed（本文件内）：GNU 失败/超时后自动回退——allnoconfig + CONFIG_SED
#      只编 sed applet，shim main 直连 sed_main（绕开 busybox 的 argv[0] 分发，
#      浏览器里 argv[0] 恒为 this.program）。功能为 GNU 主流子集。
#   3. 两条路径都有 node 冒烟硬门槛（s///、-E、y/// 三用例）。
#   4. 浏览器产物链接旗标镜像 awk/bc/lua（EXPORT_NAME="SedModule"）。

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
OUT_DIR="$PROJECT_ROOT/public/wasm"
BUILD_DIR="$SCRIPT_DIR/build"

# GNU 路径时限（秒）。GH Actions 免费 runner 2 核，gnulib 全量编译 10-25 分钟。
GNU_PATH_TIMEOUT="${GNU_PATH_TIMEOUT:-1500}"

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
  local smoke_js="$1" expect="$2" pipe="$3"
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
  smoke_test "$smoke_js" "bye"    "hi"     's/hi/bye/' || return 1
  smoke_test "$smoke_js" "abcNUM" "abc123" -E 's/([0-9]+)/NUM/' || return 1
  smoke_test "$smoke_js" "xyz"    "abc"    'y/abc/xyz/' || return 1
}

# ─── 回退路径：BusyBox sed ────────────────────────────────────────
build_busybox_sed() {
  echo ""
  echo "=== GNU sed build failed or timed out; falling back to BusyBox sed ==="
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

# ─── 主流程：GNU 优先（限时），失败/超时自动回退 BusyBox ─────────
echo "=== [GNU sed path] timeout=${GNU_PATH_TIMEOUT}s ==="
if timeout "$GNU_PATH_TIMEOUT" bash "$SCRIPT_DIR/build-gnu.sh"; then
  echo "  GNU sed → $OUT_DIR/sed.js"
else
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

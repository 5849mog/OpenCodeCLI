#!/bin/bash
# build.sh — Compile gavinhoward/bc to WebAssembly via Emscripten
#
# Usage:
#   ./build.sh                    # full build (clone + compile)
#   EMCC_DEBUG=1 ./build.sh       # debug build
#
# Prerequisites:
#   - Emscripten SDK (emsdk) in PATH: emcc, emconfigure, emmake
#
# Output (relative to project root):
#   public/wasm/bc.wasm   — WebAssembly binary
#   public/wasm/bc.mjs    — Emscripten JS module loader
#   tools/bc-wasm/source/ — cloned bc source (cached, git pull if exists)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
SOURCE_DIR="$SCRIPT_DIR/source"
OUT_DIR="$PROJECT_ROOT/public/wasm"
BUILD_DIR="$SCRIPT_DIR/build"

# --- Config ---
BC_REPO="https://github.com/gavinhoward/bc.git"
BC_TAG="7.0.3"  # Latest stable release

# --- Preflight ---
command -v emcc >/dev/null 2>&1 || {
  echo "ERROR: emcc not found. Install Emscripten SDK first."
  echo "  git clone https://github.com/emscripten-core/emsdk.git"
  echo "  cd emsdk && ./emsdk install latest && ./emsdk activate latest"
  echo "  source ./emsdk_env.sh"
  exit 1
}

echo "=== bc-wasm build ==="
echo "Emscripten: $(emcc --version | head -1)"
echo "Output:     $OUT_DIR"

# --- Clone / update source ---
if [ -d "$SOURCE_DIR/.git" ]; then
  echo "[1/4] Updating bc source..."
  cd "$SOURCE_DIR"
  git fetch --tags
  git checkout "$BC_TAG" 2>/dev/null || echo "  Tag $BC_TAG not found, using HEAD"
else
  echo "[1/4] Cloning bc source..."
  git clone --depth 1 --branch "$BC_TAG" "$BC_REPO" "$SOURCE_DIR" 2>/dev/null || \
    git clone --depth 1 "$BC_REPO" "$SOURCE_DIR"
fi

# --- Configure ---
echo "[2/4] Configuring bc (emconfigure)..."
cd "$SOURCE_DIR"
mkdir -p "$BUILD_DIR"

# gavinhoward/bc uses a custom configure.sh
# Disable readline/history/editline for browser use — we only need non-interactive pipe mode
emconfigure ./configure.sh \
  --disable-readline \
  --disable-history \
  --enable-static \
  --prefix="$BUILD_DIR/installed"

# --- Compile static library ---
echo "[3/4] Compiling bc (emmake)..."
emmake make -j"$(nproc)" clean
emmake make -j"$(nproc)"

# --- Link to WebAssembly ---
echo "[4/4] Linking bc.wasm..."
mkdir -p "$OUT_DIR"

# Collect all .o files from the build
# gavinhoward/bc builds into src/ directory
BC_OBJECTS=$(find src -name '*.o' 2>/dev/null | tr '\n' ' ')

if [ -z "$BC_OBJECTS" ]; then
  echo "ERROR: No .o files found in src/. Did the compilation step fail?"
  exit 1
fi

emcc $BC_OBJECTS \
  -O2 \
  -s WASM=1 \
  -s MODULARIZE=1 \
  -s EXPORT_NAME="BCModule" \
  -s EXPORT_ES6=0 \
  -s ALLOW_MEMORY_GROWTH=1 \
  -s FORCE_FILESYSTEM=1 \
  -s INVOKE_RUN=0 \
  -s EXIT_RUNTIME=1 \
  -s ENVIRONMENT="web,worker" \
  -s ERROR_ON_UNDEFINED_SYMBOLS=0 \
  -s "EXPORTED_RUNTIME_METHODS=['FS','callMain']" \
  -o "$OUT_DIR/bc.js"

echo ""
echo "=== Build complete ==="
echo "  bc.wasm  → $OUT_DIR/bc.wasm"
echo "  bc.mjs   → $OUT_DIR/bc.mjs"
echo ""
echo "Wasm size: $(du -h "$OUT_DIR/bc.wasm" | cut -f1)"

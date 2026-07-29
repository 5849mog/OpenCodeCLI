#!/bin/bash
# build.sh — Compile mawk to WebAssembly via Emscripten
#
# Usage:
#   ./build.sh                    # full build (clone + compile)
#
# Prerequisites:
#   - Emscripten SDK (emsdk) in PATH: emcc, emconfigure, emmake
#
# Output:
#   public/wasm/mawk.wasm   — WebAssembly binary
#   public/wasm/mawk.js     — Emscripten JS module loader

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
SOURCE_DIR="$SCRIPT_DIR/source"
OUT_DIR="$PROJECT_ROOT/public/wasm"

# --- Config ---
MAWK_REPO="https://github.com/ThomasDickey/nawk-snapshots.git"
MAWK_TAG="v1.3.4-20240930"

# --- Preflight ---
command -v emcc >/dev/null 2>&1 || {
  echo "ERROR: emcc not found. Install Emscripten SDK first."
  exit 1
}

echo "=== mawk-wasm build ==="
echo "Emscripten: $(emcc --version | head -1)"
echo "Output:     $OUT_DIR"

# --- Clone / update source ---
if [ -d "$SOURCE_DIR/.git" ]; then
  echo "[1/3] Updating mawk source..."
  cd "$SOURCE_DIR"
  git fetch --tags
  git checkout "$MAWK_TAG" 2>/dev/null || echo "  Tag $MAWK_TAG not found, using HEAD"
else
  echo "[1/3] Cloning mawk source..."
  git clone --depth 1 --branch "$MAWK_TAG" "$MAWK_REPO" "$SOURCE_DIR" 2>/dev/null || \
    git clone --depth 1 "$MAWK_REPO" "$SOURCE_DIR"
fi

# --- Configure ---
echo "[2/3] Configuring mawk (emconfigure)..."
cd "$SOURCE_DIR"

# mawk uses autoconf; --host tells it we're cross-compiling for wasm
# --without-libsigsegv skips a signal-handling library that won't work in wasm
# ac_cv_func_setrlimit=no skips setrlimit detection (not available in wasm)
emconfigure ./configure \
  --host=wasm32-unknown-emscripten \
  --without-libsigsegv \
  --disable-nls \
  ac_cv_func_setrlimit=no \
  ac_cv_func_sigaction=no

# --- Compile ---
echo "[3/3] Compiling mawk (emmake)..."
emmake make -j"$(nproc)" clean
emmake make -j"$(nproc)"

# --- Link to WebAssembly ---
echo "[4/4] Linking mawk.wasm..."
mkdir -p "$OUT_DIR"

# Collect .o files (mawk builds into its root directory)
MAWK_OBJECTS=$(find . -maxdepth 1 -name '*.o' 2>/dev/null | tr '\n' ' ')

if [ -z "$MAWK_OBJECTS" ]; then
  echo "ERROR: No .o files found. Did 'emmake make' succeed?"
  exit 1
fi

emcc $MAWK_OBJECTS \
  -O2 \
  -s WASM=1 \
  -s MODULARIZE=1 \
  -s EXPORT_NAME="MawkModule" \
  -s EXPORT_ES6=0 \
  -s ALLOW_MEMORY_GROWTH=1 \
  -s FORCE_FILESYSTEM=1 \
  -s INVOKE_RUN=0 \
  -s EXIT_RUNTIME=1 \
  -s ENVIRONMENT="web" \
  -s ERROR_ON_UNDEFINED_SYMBOLS=0 \
  -s "EXPORTED_RUNTIME_METHODS=['FS','callMain']" \
  -o "$OUT_DIR/mawk.js"

echo ""
echo "=== Build complete ==="
echo "  mawk.wasm → $OUT_DIR/mawk.wasm"
echo "  mawk.js   → $OUT_DIR/mawk.js"
echo ""
echo "Wasm size: $(du -h "$OUT_DIR/mawk.wasm" | cut -f1)"

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

# --- Download source ---
if [ -d "$SOURCE_DIR" ] && [ -f "$SOURCE_DIR/mawk.c" ]; then
  echo "[1/3] Source already present, skipping download..."
  cd "$SOURCE_DIR"
else
  echo "[1/3] Downloading mawk source..."
  rm -rf "$SOURCE_DIR"
  mkdir -p "$SOURCE_DIR"

  # Download tarball from GitHub (avoids git auth issues in CI)
  TARBALL_URL="${MAWK_REPO%.git}/tarball/${MAWK_TAG}"
  curl -fsSL "$TARBALL_URL" | tar xz --strip-components=1 -C "$SOURCE_DIR" 2>/dev/null || \
    curl -fsSL "${MAWK_REPO%.git}/tarball/master" | tar xz --strip-components=1 -C "$SOURCE_DIR" 2>/dev/null || \
    curl -fsSL "${MAWK_REPO%.git}/tarball/main" | tar xz --strip-components=1 -C "$SOURCE_DIR"

  cd "$SOURCE_DIR"
  if [ ! -f "mawk.c" ]; then
    echo "ERROR: Failed to download mawk source"
    exit 1
  fi
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

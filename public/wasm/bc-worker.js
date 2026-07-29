/**
 * bc-worker.js — Web Worker for bc WebAssembly evaluation
 *
 * Loads the emscripten-compiled bc.wasm and exposes evaluate(expr) via
 * postMessage protocol.
 *
 * Lifecycle:
 *   1. Worker starts, loads bc.js (emscripten glue) via importScripts
 *   2. Pre-compiles bc.wasm for faster per-call instantiation
 *   3. For each message: creates fresh instance, pipes expr through stdin→stdout, returns result
 *
 * Message protocol:
 *   { id: number, expr: string } → { id, ok: boolean, output: string }
 *
 * Path resolution:
 *   Uses self.location.href to derive the wasm directory dynamically,
 *   so it works in both dev (localhost) and GitHub Pages subdirectory deployment.
 */

// --- Resolve wasm file paths dynamically ---
// self.location.href in a Worker = the worker script's own URL
// e.g. https://5849mog.github.io/OpenCodeCLI/wasm/bc-worker.js
// Derive the directory to find bc.js and bc.wasm in the same folder
const WASM_DIR = self.location.href.substring(
  0, self.location.href.lastIndexOf('/') + 1
);

// Emscripten-generated module loader (MODULARIZE=1, classic script)
importScripts(WASM_DIR + 'bc.js');

let wasmModule = null;
let ready = false;

// Pre-compile wasm module for fast per-call instantiation
async function init() {
  if (ready) return;
  try {
    const response = await fetch(WASM_DIR + 'bc.wasm');
    wasmModule = await WebAssembly.compileStreaming(response);
    ready = true;
  } catch (err) {
    console.error('bc-worker init failed:', err);
    // Without wasm compilation, we still attempt runtime fallback
    ready = true;
  }
}

// Evaluate a bc expression in a fresh emscripten module instance
async function evaluate(expr) {
  const stdout = [];
  const stderr = [];

  // Prepare stdin buffer (bc expects newline-terminated expressions)
  const inputBuf = new TextEncoder().encode(expr + '\n');
  let inputPos = 0;

  // Create a fresh module instance with custom I/O hooks
  const module = await BCModule({
    print: (text) => stdout.push(text),
    printErr: (text) => stderr.push(text),
    stdin: () => {
      if (inputPos < inputBuf.length) {
        return inputBuf[inputPos++];
      }
      return null; // EOF
    },
    // Use pre-compiled wasm module when available
    instantiateWasm: wasmModule
      ? (imports, callback) => {
          WebAssembly.instantiate(wasmModule, imports).then(
            ({ instance }) => callback(instance),
          );
          return {};
        }
      : undefined,
  });

  // Run bc (no args = stdin mode, -q = quiet/no banner)
  module.callMain(['-q']);

  return {
    ok: stderr.length === 0,
    output: (stderr.length > 0 ? stderr : stdout).join('\n').trim(),
  };
}

// Handle messages from main thread
self.onmessage = async (e) => {
  const { id, expr, command } = e.data;

  if (command === 'init') {
    await init();
    self.postMessage({ id, type: 'ready' });
    return;
  }

  try {
    const result = await evaluate(expr);
    self.postMessage({ id, ...result });
  } catch (err) {
    self.postMessage({
      id,
      ok: false,
      output: `bc error: ${err.message || String(err)}`,
    });
  }
};

// Auto-init
init();

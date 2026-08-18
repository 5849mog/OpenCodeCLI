#!/usr/bin/env bash
# prepare.sh — DeepSeek 真分词器构建产物生成（tokenizers-lib.js）。
#
# 说明：
#  - public/tokenizer/tokenizer.json（7.8MB，DeepSeek-V3 官方 128k BPE 词表）
#    已提交进 git（部署零网络依赖）；如官方更新词表，可手动替换该文件。
#  - public/wasm/tokenizers-lib.js 是 @huggingface/tokenizers（纯 JS 移植，
#    与 Python transformers 同引擎）经 esbuild 打包的 IIFE（挂 self.TokenizersLib），
#    已提交进 git；本脚本用于 @huggingface/tokenizers 升级后重新生成。
#
# 用法：bash tools/tokenizer/prepare.sh   （需要 node_modules 里有 esbuild-wasm）
set -euo pipefail
cd "$(dirname "$0")/../.."

node -e '
const esb = require("esbuild-wasm");
(async () => {
  await esb.initialize({ worker: false });
  const r = await esb.build({
    entryPoints: ["node_modules/@huggingface/tokenizers/dist/tokenizers.mjs"],
    bundle: true,
    format: "iife",
    globalName: "TokenizersLib",
    write: true,
    outfile: "public/wasm/tokenizers-lib.js",
    target: "es2018",
    minify: true,
  });
  const fs = require("fs");
  const bytes = fs.statSync("public/wasm/tokenizers-lib.js").size;
  console.log("tokenizers-lib.js generated:", bytes, "bytes");
  if (!fs.existsSync("public/tokenizer/tokenizer.json")) {
    console.error("WARN: public/tokenizer/tokenizer.json 缺失——请从 DeepSeek 官方仓库放置（hf-mirror.com/deepseek-ai/DeepSeek-V3/resolve/main/tokenizer.json）");
    process.exit(1);
  }
})().catch((e) => { console.error("prepare failed:", e.message); process.exit(1); });
'

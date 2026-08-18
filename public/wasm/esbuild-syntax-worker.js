/**
 * esbuild-syntax-worker.js — check_syntax 目录遍历 + transpile 目录转译的 Web Worker
 * （静态资源，不经 next 打包）。
 *
 * 用 importScripts 加载同目录的 esbuild-browser.js（esbuild-wasm 的自包含 UMD，
 * 无 module 时挂 self.esbuild），再 fetch 同目录 esbuild.wasm 实例化到当前 worker 线程
 * （worker:false = 不在 esbuild 内部再套一层 worker）。
 *
 * 主线程 new Worker('/wasm/esbuild-syntax-worker.js') → postMessage({ root, files, mode })，
 * files 是 { path: content } 内存映射（host 已从 VFS 读好）。mode：
 *   "syntax"（默认）→ 语法校验（与历史行为一致）：ts/tsx/js/jsx/mjs/cjs → esbuild.transform
 *     校验；json → JSON.parse 校验；其他 → 归类为「不支持」（计数，不出错）。
 *   "transpile" → 转译并返回每文件 JS（{ base, js }，host 写回 VFS）：ts/tsx/js/jsx/mjs/cjs →
 *     esbuild.transform({ target:"es2018", format:"esm" }，与主线程 esbuild.ts 一致)；
 *     .d.ts / json / 其他 → 跳过（计数）。
 * 返回 { ok, totalFiles, supported, okFiles, skipCount, errorFiles, diagnostics, summary,
 *        outputs?, totalJsBytes? }。只读、无文件数上限；esbuild.initialize 只调用一次；
 * 错误按文件聚合，OK 文件不逐行回。
 */
"use strict";

(function () {
  // reqId 为请求 id（宿主池化路由用）；加载期致命错误不传 reqId（无 id 回包 = 致命）。
  function postErr(msg, reqId) {
    var payload = { ok: false, error: String(msg) };
    if (typeof reqId === "number") payload.id = reqId;
    try { self.postMessage(payload); }
    catch (_) { /* ignore */ }
  }

  try {
    // 相对路径：与 esbuild-browser.js / esbuild.wasm 同在 public/wasm/，同目录无 CSP 问题。
    self.importScripts("./esbuild-browser.js");
  }
  catch (e) { postErr("加载 esbuild 引擎失败: " + (e && e.message || e)); return; }

  var esbuild = (typeof self !== "undefined" ? self : globalThis).esbuild;
  if (!esbuild) { postErr("esbuild 引擎未就绪"); return; }

  var initPromise = null;
  function ensureInit() {
    if (!initPromise) initPromise = esbuild.initialize({ wasmURL: "./esbuild.wasm", worker: false });
    return initPromise;
  }

  function extOf(path) {
    var base = String(path).split("/").pop() || "";
    var idx = base.lastIndexOf(".");
    if (idx < 0) return "";
    return base.slice(idx + 1).toLowerCase();
  }

  var JS_LOADERS = { ts: "ts", tsx: "tsx", js: "js", jsx: "jsx", mjs: "js", cjs: "js" };

  self.onmessage = function (ev) {
    var req = ev.data || {};
    var reqId = typeof req.id === "number" ? req.id : null;
    var mode = req.mode === "transpile" ? "transpile" : "syntax";
    var t0 = Date.now();
    ensureInit().then(function () {
      return runCheck(req.files || {}, req.root || "", mode);
    }).then(function (result) {
      result.durationMs = Date.now() - t0;
      self.postMessage({ id: reqId, ok: true, result: result });
    }).catch(function (e) {
      postErr((mode === "transpile" ? "转译" : "语法检查") + "失败: " + (e && (e.stack || e.message) || e), reqId);
    });
  };

  async function runCheck(files, root, mode) {
    var isTranspile = mode === "transpile";
    // 收集：按扩展名分派到不同队列。
    var keys = Object.keys(files || {}).sort();
    var esbQueue = [];   // { base, content, loader }
    var jsonFails = [];  // { base, error }（仅 syntax 模式）
    var skipCount = 0;
    var totalFiles = keys.length;
    var supported = 0;

    keys.forEach(function (rel) {
      var base = rel.replace(/^\/+/, "");
      var ext = extOf(base);
      var loader = JS_LOADERS[ext];
      var isDts = /\.d\.ts$/i.test(base);
      // transpile 模式：.d.ts 不产出 JS → 跳过；syntax 模式：d.ts 仍是合法 TS，照常校验。
      if (loader && (!isTranspile || !isDts)) {
        supported++;
        esbQueue.push({ base: base, content: files[rel], loader: loader });
      } else if (!isTranspile && ext === "json") {
        // syntax 模式：json 用 JSON.parse 校验。
        supported++;
        try { JSON.parse(files[rel]); }
        catch (e) { jsonFails.push({ base: base, error: e instanceof Error ? e.message : String(e) }); }
      } else {
        // transpile 模式：.d.ts / json / 其他语言不产出 JS；syntax 模式：不支持语言仅计数。
        skipCount++;
      }
    });

    // 串行跑 esbuild transform（复用同一实例；transform 是异步，在 worker 线程不卡主线程）。
    var esbFails = [];
    var okFiles = 0;
    var outputs = isTranspile ? [] : null; // [{ base, js }]
    var totalJsBytes = 0;
    for (var i = 0; i < esbQueue.length; i++) {
      var c = esbQueue[i];
      var err = null;
      try {
        var opts = { loader: c.loader, target: "es2018" };
        if (isTranspile) { opts.format = "esm"; opts.sourcemap = false; }
        var out = await esbuild.transform(c.content, opts);
        if (isTranspile) {
          outputs.push({ base: c.base, js: out.code });
          totalJsBytes += out.code.length;
        }
        okFiles++;
      } catch (e) {
        var raw = (e && (e.message || String(e))) || "错误";
        // esbuild 0.28 报错前缀是 <stdin>:1:9:（旧版是 stdin:1:9:），两种都兼容。
        var m = raw.match(/<?stdin>?:(\d+):(\d+):\s*(?:ERROR|WARNING):\s*([\s\S]*)/);
        err = m ? "第 " + m[1] + " 行第 " + m[2] + " 列: " + m[3].trim() : raw;
        esbFails.push({ base: c.base, error: err });
      }
    }

    var allFails = esbFails.concat(jsonFails.map(function (j) { return { base: j.base, error: j.error }; }));
    var errorFiles = allFails.map(function (f) { return f.base; });
    var allOk = allFails.length === 0;

    var verb = isTranspile ? "转译" : "语法";
    var diagnostics = allFails.map(function (f) { return "[" + f.base + " 错误] " + f.error; });
    var summary = (allOk ? "✓ 全部文件" + verb + "成功" : "发现" + verb + "错误") +
      "：共 " + totalFiles + " 个文件（支持 " + supported + "，跳过 " + skipCount + "），" +
      okFiles + " 正常，" + errorFiles.length + " 个含错误。";

    var result = {
      ok: allOk,
      totalFiles: totalFiles,
      supported: supported,
      okFiles: okFiles,
      skipCount: skipCount,
      errorFiles: errorFiles,
      diagnostics: diagnostics,
      summary: summary,
      durationMs: 0
    };
    if (isTranspile) {
      result.outputs = outputs;
      result.totalJsBytes = totalJsBytes;
    }
    return result;
  }
})();

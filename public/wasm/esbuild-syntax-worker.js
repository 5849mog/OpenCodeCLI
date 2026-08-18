/**
 * esbuild-syntax-worker.js — check_syntax 目录遍历的 Web Worker（静态资源，不经 next 打包）。
 *
 * 用 importScripts 加载同目录的 esbuild-browser.js（esbuild-wasm 的自包含 UMD，
 * 无 module 时挂 self.esbuild），再 fetch 同目录 esbuild.wasm 实例化到当前 worker 线程
 * （worker:false = 不在 esbuild 内部再套一层 worker）。
 *
 * 主线程 new Worker('/wasm/esbuild-syntax-worker.js') → postMessage({ root, files })，
 * files 是 { path: content } 内存映射（host 已从 VFS 读好）。worker 内按扩展名分派：
 *   ts/tsx/js/jsx/mjs/cjs → esbuild.transform 语法校验
 *   json                  → JSON.parse 校验
 *   其他                  → 归类为「不支持」（计数，不出错）
 * 返回 { ok, totalFiles, supported, okFiles, skipCount, errorFiles, diagnostics, summary }。
 * 只读、无文件数上限；esbuild.initialize 只调用一次；错误按文件聚合，OK 文件不逐行回。
 */
"use strict";

(function () {
  function postErr(msg) {
    try { self.postMessage({ ok: false, error: String(msg) }); }
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
    var t0 = Date.now();
    ensureInit().then(function () {
      return runCheck(req.files || {}, req.root || "");
    }).then(function (result) {
      result.durationMs = Date.now() - t0;
      self.postMessage({ ok: true, result: result });
    }).catch(function (e) {
      postErr("语法检查失败: " + (e && (e.stack || e.message) || e));
    });
  };

  async function runCheck(files, root) {
    // 收集：按扩展名分派到不同队列。
    var keys = Object.keys(files || {}).sort();
    var esbQueue = [];   // { base, content, loader }
    var jsonFails = [];  // { base, error }
    var skipCount = 0;
    var totalFiles = keys.length;
    var supported = 0;

    keys.forEach(function (rel) {
      var base = rel.replace(/^\/+/, "");
      var ext = extOf(base);
      var loader = JS_LOADERS[ext];
      if (loader) {
        supported++;
        esbQueue.push({ base: base, content: files[rel], loader: loader });
      } else if (ext === "json") {
        supported++;
        try { JSON.parse(files[rel]); }
        catch (e) { jsonFails.push({ base: base, error: e instanceof Error ? e.message : String(e) }); }
      } else {
        skipCount++; // 不支持的语言（css/html/md/...）仅计数
      }
    });

    // 串行跑 esbuild transform（复用同一实例；transform 是异步，在 worker 线程不卡主线程）。
    var esbFails = [];
    var okFiles = 0;
    for (var i = 0; i < esbQueue.length; i++) {
      var c = esbQueue[i];
      var err = null;
      try {
        await esbuild.transform(c.content, { loader: c.loader, target: "es2018" });
        okFiles++;
      } catch (e) {
        var raw = (e && (e.message || String(e))) || "语法错误";
        var m = raw.match(/stdin:(\d+):(\d+):\s*(?:ERROR|WARNING):\s*([\s\S]*)/);
        err = m ? "第 " + m[1] + " 行第 " + m[2] + " 列: " + m[3].trim() : raw;
        esbFails.push({ base: c.base, error: err });
      }
    }

    var allFails = esbFails.concat(jsonFails.map(function (j) { return { base: j.base, error: j.error }; }));
    var errorFiles = allFails.map(function (f) { return f.base; });
    okFiles += esbQueue.length - esbFails.length;
    var allOk = allFails.length === 0;

    var diagnostics = allFails.map(function (f) { return "[" + f.base + " 错误] " + f.error; });
    var summary = (allOk ? "✓ 全部文件语法合法" : "发现语法错误") +
      "：共 " + totalFiles + " 个文件（支持 " + supported + "，跳过 " + skipCount + "），" +
      okFiles + " 正常，" + errorFiles.length + " 个含错误。";

    return {
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
  }
})();

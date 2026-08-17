/**
 * tsc-worker.js — check_types 的独立 Worker 线程脚本（静态资源，不经 next 打包）。
 *
 * 从 public/wasm/ 直接用相对路径 importScripts 加载 typescript.js（同目录，
 * 天然同源、无 Blob worker 的 CSP/绝对路径限制——初版 Blob worker + 绝对
 * importScripts 在浏览器报 "The string did not match the expected pattern"）。
 *
 * 主线程用 new Worker('/wasm/tsc-worker.js')（字符串路径，next 会原样复制
 * public/ → out/）。Worker 接收 { root, tsconfig, defaultOptions, files }，
 * 建内存 CompilerHost → ts.Program → PreEmit 诊断 → postMessage 返回。
 * 全程只读（writeFile no-op），绝不动 VFS。
 */
"use strict";

(function () {
  function postErr(msg) {
    try { self.postMessage({ ok: false, error: String(msg) }); }
    catch (_) { /* ignore */ }
  }

  // 相对路径：tsc-worker.js 与 typescript.js 同在 public/wasm/，同目录相对解析无 CSP 问题。
  try { self.importScripts("./typescript.js"); }
  catch (e) { postErr("加载 typescript.js 失败: " + (e && e.message || e)); return; }

  var ts = (typeof self !== "undefined" ? self : globalThis).ts;
  if (!ts) { postErr("typescript 引擎未就绪"); return; }

  self.onmessage = function (ev) {
    var req = ev.data || {};
    var t0 = Date.now();
    try {
      var result = runCheck(
        req.files || {},
        req.root || "",
        req.tsconfig || null,
        req.defaultOptions || {}
      );
      result.durationMs = Date.now() - t0;
      self.postMessage({ ok: true, result: result });
    } catch (e) {
      postErr("类型检查失败: " + (e && e.message || e));
    }
  };

  function normalize(p) {
    if (!p) return "/";
    var x = String(p).replace(/\\/g, "/");
    if (x.charAt(0) !== "/") x = "/" + x;
    return x;
  }
  function extKind(f) {
    if (/\.tsx$/.test(f)) return ts.ScriptKind.TSX;
    if (/\.ts$/.test(f)) return ts.ScriptKind.TS;
    if (/\.jsx$/.test(f)) return ts.ScriptKind.JSX;
    if (/\.js$/.test(f)) return ts.ScriptKind.JS;
    return ts.ScriptKind.TS;
  }
  function buildOptions(contents, tsconfigArg, defaultOptions) {
    var cfgPath = null;
    if (tsconfigArg) cfgPath = normalize(tsconfigArg);
    else if (contents["/tsconfig.json"] !== undefined) cfgPath = "/tsconfig.json";
    if (!cfgPath || contents[cfgPath] === undefined) return defaultOptions || {};
    try {
      var raw = JSON.parse(contents[cfgPath]);
      var parsed = ts.parseJsonConfigFileContent
        ? ts.parseJsonConfigFileContent(
            raw,
            { useCaseSensitiveFileNames: false,
              fileExists: function (f) { return contents[normalize(f)] !== undefined; },
              readFile: function (f) { return contents[normalize(f)]; },
              readDirectory: function () { return Object.keys(contents); },
              getCurrentDirectory: function () { return "/"; },
              realpath: function (f) { return normalize(f); } },
            "/", undefined, normalize(cfgPath)
          )
        : { options: {} };
      var opts = parsed.options || {};
      var merged = {};
      for (var k in (defaultOptions || {})) if (Object.prototype.hasOwnProperty.call(defaultOptions || {}, k)) merged[k] = defaultOptions[k];
      for (var k2 in opts) if (Object.prototype.hasOwnProperty.call(opts, k2)) merged[k2] = opts[k2];
      if (merged.skipLibCheck === undefined) merged.skipLibCheck = true;
      if (merged.noEmit === undefined) merged.noEmit = true;
      return merged;
    } catch (e) {
      return defaultOptions || {};
    }
  }

  function runCheck(files, root, tsconfigArg, defaultOptions) {
    var contents = {};
    for (var p in files) {
      if (Object.prototype.hasOwnProperty.call(files, p)) contents[normalize(p)] = files[p];
    }
    var rootFile = normalize(root || "");
    var rootFiles = [];
    if (contents[rootFile] !== undefined) {
      rootFiles = [rootFile];
    } else {
      var prefix = rootFile && rootFile !== "/" ? rootFile + "/" : "";
      for (var key in contents) {
        if (!Object.prototype.hasOwnProperty.call(contents, key)) continue;
        if (/\.tsx?$/.test(key) && (!prefix || key.indexOf(prefix) === 0)) rootFiles.push(key);
      }
    }
    if (rootFiles.length === 0) throw new Error("在指定范围内没有找到 .ts/.tsx 文件");

    var options = {
      noEmit: true,
      target: ts.ScriptTarget.ES2020,
      module: ts.ModuleKind.ESNext,
      jsx: ts.JsxEmit.ReactJSX,
      strict: true,
      skipLibCheck: true,
      noResolve: false
      // 不显式指定 lib：让 ts 按 target+module 自动选默认 lib 集合。
    };
    var fromCfg = buildOptions(contents, tsconfigArg, defaultOptions);
    for (var k in fromCfg) if (Object.prototype.hasOwnProperty.call(fromCfg, k)) options[k] = fromCfg[k];

    var host = ts.createCompilerHost(options);
    var origGetSourceFile = host.getSourceFile;
    var origReadFile = host.readFile;
    var origFileExists = host.fileExists;
    host.getSourceFile = function (fileName, langVer, onError, createNew) {
      var norm = normalize(fileName);
      if (contents[norm] !== undefined) {
        return ts.createSourceFile(norm, contents[norm], langVer, true, extKind(norm));
      }
      // 非工作区文件（内置 lib.d.ts、node_modules 类型）→ 交给 ts 默认实现，让内置 lib
      // 从 typescript.js 的虚拟 FS 加载，绝不应得 undefined。
      return origGetSourceFile.call(host, fileName, langVer, onError, createNew);
    };
    host.readFile = function (fileName) {
      var c = contents[normalize(fileName)];
      if (c !== undefined) return c;
      return origReadFile.call(host, fileName);
    };
    host.fileExists = function (fileName) {
      if (contents[normalize(fileName)] !== undefined) return true;
      return origFileExists.call(host, fileName);
    };
    host.directoryExists = function (dirName) {
      var d = normalize(dirName || "");
      if (d === "/" || d === "") return true;
      for (var key in contents) {
        if (Object.prototype.hasOwnProperty.call(contents, key) && key.indexOf(d + "/") === 0) return true;
      }
      return false;
    };
    host.getDirectories = function (dirName) {
      var d = normalize(dirName || "");
      var base = (d === "/" || d === "") ? "" : d + "/";
      var set = {};
      for (var key in contents) {
        if (!Object.prototype.hasOwnProperty.call(contents, key)) continue;
        if (base && key.indexOf(base) !== 0) continue;
        var rest = key.slice(base.length);
        var slash = rest.indexOf("/");
        if (slash > 0) set[rest.slice(0, slash)] = true;
      }
      return Object.keys(set);
    };
    host.writeFile = function () {};

    var program = ts.createProgram(rootFiles, options, host);
    var diagnostics = ts.getPreEmitDiagnostics(program);

    var lines = [];
    var errCount = 0;
    diagnostics.forEach(function (d) {
      var text = ts.flattenDiagnosticMessageText(d.messageText, "\n");
      var loc = "";
      if (d.file && d.start !== undefined) {
        var pos = d.file.getLineAndCharacterOfPosition(d.start);
        var fname = d.file.fileName || "?";
        var display = fname.replace(/^\//, "");
        loc = display + ":" + (pos.line + 1) + ":" + (pos.character + 1) + "  ";
      }
      var code = "TS" + d.code;
      var cat = d.category === ts.DiagnosticCategory.Error ? "错误" : "提示";
      lines.push((loc || "") + "[" + code + " " + cat + "] " + text);
      if (d.category === ts.DiagnosticCategory.Error) errCount++;
    });

    return { files: rootFiles.length, diagnostics: lines, errorCount: errCount, durationMs: 0 };
  }
})();

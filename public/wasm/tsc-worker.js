/**
 * tsc-worker.js — check_types 的独立 Worker 线程脚本（静态资源，不经 next 打包）。
 *
 * 从 public/wasm/ 直接用相对路径 importScripts 加载 typescript.js（同目录，
 * 天然同源、无 Blob worker 的 CSP/绝对路径限制——初版 Blob worker + 绝对
 * importScripts 在浏览器报 "The string did not match the expected pattern"）。
 *
 * 主线程用 new Worker('/wasm/tsc-worker.js')（字符串路径，next 会原样复制
 * public/ → out/）。Worker 接收 { id, root, tsconfig, defaultOptions, files }，
 * 建内存 CompilerHost → ts.Program → PreEmit 诊断 → postMessage 返回（回包带
 * id，宿主 worker-client 池化路由用；加载期致命错误不带 id）。
 * 全程只读（writeFile no-op），绝不动 VFS。
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

  // 相对路径：tsc-worker.js 与 typescript.js、tslib.js 同在 public/wasm/，同目录相对解析无 CSP 问题。
  try {
    self.importScripts("./typescript.js");
    self.importScripts("./tslib.js"); // self.__TSLIB__：内置 lib.*.d.ts 内容（Array/dom 等全局类型）
  }
  catch (e) { postErr("加载 TypeScript 引擎失败: " + (e && e.message || e)); return; }

  var ts = (typeof self !== "undefined" ? self : globalThis).ts;
  if (!ts) { postErr("typescript 引擎未就绪"); return; }
  var TSLIB = (typeof self !== "undefined" ? self : globalThis).__TSLIB__ || {};

  self.onmessage = function (ev) {
    var req = ev.data || {};
    var reqId = typeof req.id === "number" ? req.id : null;
    var t0 = Date.now();
    try {
      var result = runCheck(
        req.files || {},
        req.root || "",
        req.tsconfig || null,
        req.defaultOptions || {}
      );
      result.durationMs = Date.now() - t0;
      self.postMessage({ id: reqId, ok: true, result: result });
    } catch (e) {
      postErr("类型检查失败: " + (e && (e.stack || e.message) || e), reqId);
    }
  };  function normalize(p) {
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
    // 注入内置 lib.*.d.ts（Array/Promise/dom 等全局类型），key 形如 /lib/lib.es5.d.ts。
    for (var lp in TSLIB) {
      if (Object.prototype.hasOwnProperty.call(TSLIB, lp)) contents[normalize(lp)] = TSLIB[lp];
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

    // 自定义 CompilerSystem：不依赖 ts.sys（浏览器 worker 里 ts.sys 缺失，会导致
    // "system.useCaseSensitiveFileNames is not an object"）。把文件系统全部指向内存映射。
    var mySystem = {
      useCaseSensitiveFileNames: function () { return false; },
      getCurrentDirectory: function () { return "/"; },
      getExecutingFilePath: function () { return "/lib/typescript.js"; }, // 默认 lib 位置 → /lib/lib.*.d.ts
      newLine: function () { return "\n"; },
      fileExists: function (fileName) { return contents[normalize(fileName)] !== undefined; },
      readFile: function (fileName) { return contents[normalize(fileName)] !== undefined ? contents[normalize(fileName)] : undefined; },
      writeFile: function () {},
      directoryExists: function (dirName) {
        var d = normalize(dirName || "");
        if (d === "/" || d === "") return true;
        for (var key in contents) {
          if (Object.prototype.hasOwnProperty.call(contents, key) && key.indexOf(d + "/") === 0) return true;
        }
        return false;
      },
      getDirectories: function (dirName) {
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
      },
      readDirectory: function (rootDir, extensions, excludes, includes, depth) {
        // 返回 rootDir 下匹配 extensions 的文件（相对当前目录形式的路径）。
        var d = normalize(rootDir || "");
        var base = (d === "/" || d === "") ? "" : d + "/";
        var out = [];
        var re = extensions && extensions.length ? new RegExp("\\\\.(" + extensions.map(function (e) { return e.replace(/^\\./, ""); }).join("|") + ")$") : null;
        for (var key in contents) {
          if (!Object.prototype.hasOwnProperty.call(contents, key)) continue;
          if (base && key.indexOf(base) !== 0) continue;
          if (re && !re.test(key)) continue;
          out.push(key);
        }
        return out;
      },
      realpath: function (path) { return normalize(path); },
      getFileSize: function (p) { var c = contents[normalize(p)]; return c === undefined ? -1 : c.length; },
      getModifiedTime: function () { return Math.floor(Date.now() / 1000); },
      setModifiedTime: function () {},
      deleteFile: function () {},
      exit: function () {}
    };

    // 用 createCompilerHostWorker（接受第三参 system）——普通 ts.createCompilerHost
    // 只有 2 参，会丢弃 system 落到默认 sys（浏览器 worker 里 sys undefined）。
    var host = ts.createCompilerHostWorker(options, false, mySystem);
    var origGetSourceFile = host.getSourceFile;
    var origReadFile = host.readFile;
    var origFileExists = host.fileExists;
    host.getSourceFile = function (fileName, langVer, onError, createNew) {
      var norm = normalize(fileName);
      if (contents[norm] !== undefined) {
        return ts.createSourceFile(norm, contents[norm], langVer, true, extKind(norm));
      }
      // 非工作区文件（内置 lib.d.ts、node_modules 类型）→ 交给默认实现，让内置 lib
      // 从 typescript.js 的虚拟 FS 加载。
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
    host.writeFile = function () {};

    // 内置 lib.d.ts 的完整集合需要 ts.sys 级别的 lib 解析；若默认 host 因 system
    // 缺 lib 信息而拿不到 lib，fallback 到 ts.getDefaultLibFilePaths 机制无法用——
    // 这里显式确保 host 能拿到默认 lib 文件路径集合所需的方法（由 ts 内部提供）。
    if (host.getDefaultLibFileName) {
      try {
        var defaultLib = host.getDefaultLibFileName(options);
        // 确保 lib.*.d.ts 能从 typescript.js 内置虚拟 FS 读出：交给默认 getSourceFile。
        if (!host.fileExists(defaultLib)) {
          // 无 override 已够——ts 内部会用内置 lib FS。
        }
      } catch (e) { /* ignore */ }
    }

    var program = ts.createProgram(rootFiles, options, host);
    var diagnostics = ts.getPreEmitDiagnostics(program);

    // 环境噪声 TS 码：浏览器里没有 node_modules，第三方模块无法解析、泛型推断退化，
    // 会产生连锁假错误。这些降级为「提示」而非「错误」，避免淹没真实代码问题。
    var ENV_NOISE = {
      2307: true, // Cannot find module 'x'
      2792: true, // Cannot find module 'x' (did you mean 'y'?)
      7016: true, // Could not find declaration file for module
      2686: true, // 'x' refers to a value, but is being used as a type
      7006: true, // Parameter 'x' implicitly has an 'any' type
      7005: true, // Variable 'x' implicitly has an 'any' type
      7008: true, // Member 'x' implicitly has an 'any' type
      18046: true, // 'x' is of type 'unknown'
      2571: true, // Object is of type 'unknown'
      7015: true, // Property 'x' implicitly has an 'any' type (interface/alias)
      7023: true, // Property 'x' implicitly has type 'any' (variable)
      7007: true, // Narrowed destructuring implicit any
      2769: true, // No overload matches (泛型退化为 any/unknown)
      2580: true // Cannot find name 'process' 等 Node 全局（缺 @types/node）
    };
    // 2304 Cannot find name：只有命中已知 Node/浏览器全局名（缺 @types 环境下必然假阳性）
    // 才降噪；其余 Cannot find name 保留为错误（可能是真拼写错）。
    var NODE_GLOBAL_NAMES = /^(process|Buffer|global|__dirname|__filename|require|module|exports|console|setImmediate|clearImmediate|queueMicrotask|URL|URLSearchParams|TextEncoder|TextDecoder|fetch|AbortController|Performance|structuredClone)$/;
    // 归因到"缺依赖/module"的降噪码（用于缺依赖检测的统计口径）。
    var MODULE_MISS_CODES = { 2307: true, 2792: true, 7016: true, 2580: true };
    var lines = [];
    var errCount = 0;
    var noteCount = 0;
    var sawNoise = false;
    var moduleMissing = 0;
    diagnostics.forEach(function (d) {
      var codeNum = d.code;
      var text = ts.flattenDiagnosticMessageText(d.messageText, "\n");
      // 2304 → 命中 Node/浏览器全局名才降噪。
      var nameNoise = codeNum === 2304 && /^Cannot find name '([^']+)'/.test(text) &&
        NODE_GLOBAL_NAMES.test(text.replace(/^Cannot find name '([^']+)'.*/, "$1"));
      var isNoise = d.category === ts.DiagnosticCategory.Error && (!!ENV_NOISE[codeNum] || nameNoise);
      var loc = "";
      if (d.file && d.start !== undefined) {
        var pos = d.file.getLineAndCharacterOfPosition(d.start);
        var fname = d.file.fileName || "?";
        var display = fname.replace(/^\//, "");
        loc = display + ":" + (pos.line + 1) + ":" + (pos.character + 1) + "  ";
      }
      var code = "TS" + codeNum;
      var cat;
      if (isNoise) {
        cat = "提示"; noteCount++; sawNoise = true;
        if (MODULE_MISS_CODES[codeNum] || nameNoise) moduleMissing++;
      }
      else if (d.category === ts.DiagnosticCategory.Error) { cat = "错误"; errCount++; }
      else { cat = "提示"; }
      lines.push((loc || "") + "[" + code + " " + cat + "] " + text);
    });

    // 缺依赖检测：若 module/全局缺失类噪声占错误级诊断（真错误+module缺失）比例过高，
    // 判定项目依赖 node_modules、浏览器无法权威检查，host 据此降级输出。
    var errTotal = errCount + moduleMissing;
    var depMissing = moduleMissing > 0 && errTotal > 0 && moduleMissing / errTotal > 0.3;

    return {
      files: rootFiles.length,
      diagnostics: lines,
      errorCount: errCount,
      noteCount: noteCount,
      envNoise: sawNoise,
      moduleMissing: moduleMissing,
      depMissing: depMissing,
      durationMs: 0
    };
  }
})();

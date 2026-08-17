/**
 * tsc-worker-source.ts — check_types 的 Worker 线程源码。
 *
 * 用 Blob URL 内联 Worker（`new Worker(URL.createObjectURL(new Blob([source])))`），
 * 绕开 Next.js static export 对 `new Worker(new URL(..., import.meta.url))`
 * 的打包限制，与项目"外部资源走 public/wasm + importScripts"的模式一致。
 *
 * Worker 里通过 importScripts 加载 public/wasm/typescript.js（官方 TS 编译器，
 * UMD 包裹 → 挂到 self.ts），宿主只传一次文件映射 + root + options，
 * 在 Worker 内建内存 CompilerHost，构建 ts.Program，跑 PreEmit 诊断。
 *
 * 设计原则：
 *  - 全程只读：writeFile no-op，绝不动 VFS。
 *  - 跨文件类型检查：按 tsconfig 或默认选项收集全部相关 .ts/.tsx，Program 级诊断。
 *  - 输出归一化为 `${path}:${line}:${col} ${消息}`，可被 AI 直接消费。
 */

/** Worker 内部通过 importScripts 加载 typescript.js 的 absolute URL。
 *  在宿主侧用 wasmUrl() 拼好并注入，避免在 worker 里重复 basePath 逻辑。 */
export function tscWorkerSource(typescriptUrl: string): string {
  return `
(function () {
  "use strict";
  function postErr(msg) {
    try { self.postMessage({ ok: false, error: String(msg) }); }
    catch (_) { /* ignore */ }
  }
  try { self.importScripts(${JSON.stringify(typescriptUrl)}); }
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
    var x = String(p).replace(/\\\\/g, "/");
    if (x.charAt(0) !== "/") x = "/" + x;
    return x;
  }
  function extKind(f) {
    if (/\\.tsx$/.test(f)) return ts.ScriptKind.TSX;
    if (/\\.ts$/.test(f)) return ts.ScriptKind.TS;
    if (/\\.jsx$/.test(f)) return ts.ScriptKind.JSX;
    if (/\\.js$/.test(f)) return ts.ScriptKind.JS;
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
        if (/\\.tsx?$/.test(key) && (!prefix || key.indexOf(prefix) === 0)) rootFiles.push(key);
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
      // 不显式指定 lib：让 ts 按 target+module 自动选默认 lib 集合，
      // 避免显式 lib 列表触发额外的 lib.*.d.ts 路径解析。
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
      // 非工作区文件（含内置 lib.d.ts、node_modules 类型）→ 交给 ts 默认实现，
      // 让内置 lib 从 typescript.js 的虚拟 FS 加载，绝不应得 undefined。
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
      var text = ts.flattenDiagnosticMessageText(d.messageText, "\\n");
      var loc = "";
      if (d.file && d.start !== undefined) {
        var pos = d.file.getLineAndCharacterOfPosition(d.start);
        var fname = d.file.fileName || "?";
        var display = fname.replace(/^\\//, "");
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
`;
}

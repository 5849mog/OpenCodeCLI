import type { ToolResult } from "./types";
import { toolReadFile, toolWriteFile, toolEditFile, toolDeleteFile, toolListFiles, toolListDirs, toolCreateDir, toolMoveFile, toolAppendFile, toolInsertAt, toolUndoEdit, toolReadMultipleFiles, toolProjectStats } from "./file-ops";
import { toolSearchFiles, toolGlob, toolSearchSymbols, toolViewOutline } from "./search";
import { toolBash } from "./bash";
import { toolMultiEdit, toolApplyPatch } from "./patch";
import { toolUpdatePlan } from "./plan";
import { toolAskUserInput } from "./user-input";
import { toolWebSearch, toolFetchUrl } from "./web";
import { toolZipArchive, toolUnzipArchive } from "./zip";
import { toolParseYaml, toolParseCsv, toolQueryJson, toolMath } from "./data-tools";
import { listSkills, loadSkill, createSkill, removeSkill } from "../skills";
import { esbuildWasm } from "../wasm/esbuild";
import { gitEngine } from "../git";
import * as luaWasm from "../wasm/lua-wasm";
import * as jsWasm from "../wasm/js-wasm";
import { vfs } from "../vfs";

/** run_lua 工具：内存 Lua 计算 + 受限写回。
 *  - files：AI 显式指定读取的工作区文件（只传路径），dispatch 层读 VFS，
 *    经桥接层注入 MEMFS 只读副本供脚本 io.open 读取
 *  - script_file：指定工作区 .lua 脚本文件直接运行（脚本资产化）
 *  - outputs：写回白名单——脚本 io.open(path,'w') 写 MEMFS，求值后白名单内
 *    路径同步回 VFS；回传摘要而非全文；mutated → undo 可撤销；
 *    Plan 模式带 outputs 拦截（只读）
 *  - args：传给脚本的 argv（脚本读 arg[1..]） */
async function toolRunLua(args: Record<string, unknown>, readOnly = false): Promise<ToolResult> {
  // script 内联文本 与 script_file 二选一
  const scriptText = String(args.script ?? "");
  const scriptFile = args.script_file !== undefined ? String(args.script_file) : undefined;
  if (scriptText.trim() && scriptFile) {
    return { ok: false, output: "run_lua: script 与 script_file 只能二选一", tool: "run_lua", args };
  }
  let script = scriptText.trim();
  if (scriptFile) {
    const sc = vfs.readFileSync(scriptFile);
    if (sc === null) return { ok: false, output: `run_lua: 脚本文件不存在: ${scriptFile}`, tool: "run_lua", args };
    script = sc;
  }
  if (!script.trim()) return { ok: false, output: "run_lua: missing script", tool: "run_lua", args };
  const stdin = args.input !== undefined ? String(args.input) : undefined;

  // args：兼容 string 或 string[]
  const luaArgs = args.args !== undefined
    ? (Array.isArray(args.args) ? args.args.map((a) => String(a)) : [String(args.args)])
    : undefined;

  // outputs 白名单：去重、限数量、限工作区相对路径
  const outputs: string[] = [];
  const outputsArg = args.outputs;
  if (outputsArg !== undefined) {
    const list = Array.isArray(outputsArg) ? outputsArg.map((p) => String(p)) : [String(outputsArg)];
    const seen = new Set<string>();
    for (const p of list) {
      if (seen.has(p)) continue;
      seen.add(p);
      if (outputs.length >= luaWasm.MAX_INJECTED_FILES) {
        return { ok: false, output: `run_lua: outputs 超过上限 ${luaWasm.MAX_INJECTED_FILES}`, tool: "run_lua", args };
      }
      if (p.startsWith("/") || p.includes("..")) {
        return { ok: false, output: `run_lua: outputs 必须是工作区相对路径: ${p}`, tool: "run_lua", args };
      }
      outputs.push(p);
    }
  }

  // Plan 模式：带 outputs（写回）→ 拦截（run_lua 从纯计算变为可写工具）
  if (readOnly && outputs.length > 0) {
    return {
      ok: false,
      output:
        "[Plan mode] run_lua with outputs (file writes) is blocked in Plan mode. " +
        "In Plan mode you can only READ and ANALYZE — propose your plan in text, " +
        "and the user will switch to Bypass mode to let you execute it.",
      tool: "run_lua",
      args,
    };
  }

  // files：兼容 string 或 string[]；缺失/超限 fail-fast，不静默跳过（免得脚本算出错误结果）
  const files: Record<string, string> = {};
  const filesArg = args.files;
  if (filesArg !== undefined) {
    const paths = Array.isArray(filesArg) ? filesArg.map((p) => String(p)) : [String(filesArg)];
    const problems: string[] = [];
    const seen = new Set<string>();
    for (const p of paths) {
      if (seen.has(p)) continue; // 去重
      seen.add(p);
      if (Object.keys(files).length >= luaWasm.MAX_INJECTED_FILES) {
        problems.push(`文件数超过上限 ${luaWasm.MAX_INJECTED_FILES}`);
        break;
      }
      const content = vfs.readFileSync(p);
      if (content === null) { problems.push(`文件不存在: ${p}`); continue; }
      if (content.length > luaWasm.MAX_FILE_BYTES) {
        problems.push(`文件过大(>${luaWasm.MAX_FILE_BYTES.toLocaleString()} 字符): ${p}`);
        continue;
      }
      files[p] = content;
    }
    if (problems.length > 0) {
      return { ok: false, output: `run_lua: 无法读取指定文件 — ${problems.join("；")}`, tool: "run_lua", args };
    }
  }

  const result = await luaWasm.evaluate({
    script,
    stdin,
    files,
    args: luaArgs,
    outputs: outputs.length > 0 ? outputs : undefined,
  });

  // outputs 写回 VFS + 摘要（全文不进上下文，需要内容用 read_file）。
  // 声明了 outputs 就必走摘要格式：写回数 0 时也要列出「未产生」。
  // 但引擎错误（ok:false，如超限/脚本报错）必须优先透传，不能被摘要吞掉
  // （f9ff18e 回归：C4 超限报错被覆盖成「未写回任何文件」）。
  if (outputs.length > 0) {
    if (!result.ok) {
      return { ok: false, output: result.output, tool: "run_lua", args };
    }
    const writtenEntries = result.written ?? {};
    for (const [path, content] of Object.entries(writtenEntries)) {
      vfs.writeFileSync(path, content);
    }
    const lines = Object.entries(writtenEntries)
      .map(([p, c]) => `  - ${p} (${c.length.toLocaleString()} chars, ${c.split("\n").length} lines)`)
      .join("\n");
    const missing = outputs.filter((p) => !(p in writtenEntries));
    const missingNote = missing.length > 0 ? `\n  未产生: ${missing.join(", ")}` : "";
    const count = Object.keys(writtenEntries).length;
    return {
      ok: true,
      output: count > 0
        ? `✓ 已写回 ${count} 个文件（全文未回传，需要内容用 read_file 读取）：\n${lines}${missingNote}`
        : `⚠ 未写回任何文件（全文未回传）${missingNote}`,
      tool: "run_lua",
      args,
      mutated: count > 0,
    };
  }
  return { ok: result.ok, output: result.output, tool: "run_lua", args };
}

/** run_js 工具：内存 JavaScript 计算（QuickJS WASM）+ 受限写回。
 *  与 run_lua 同构，但输入编排不同（QuickJS 无 C 式 stdin）：
 *  - input → 注入 globalThis.__input（string）
 *  - files → 注入 globalThis.__files（{path: content} 只读副本）
 *  - args  → 注入 globalThis.__args（string[]）
 *  - 输出：脚本 return 值 + console.log 捕获；写 globalThis.__outputs 回传白名单
 *  - outputs：写回白名单，回传摘要；Plan 模式带 outputs 拦截；undo 可撤销 */
async function toolRunJs(args: Record<string, unknown>, readOnly = false): Promise<ToolResult> {
  // script 内联文本 与 script_file 二选一
  const scriptText = String(args.script ?? "");
  const scriptFile = args.script_file !== undefined ? String(args.script_file) : undefined;
  if (scriptText.trim() && scriptFile) {
    return { ok: false, output: "run_js: script 与 script_file 只能二选一", tool: "run_js", args };
  }
  let script = scriptText.trim();
  if (scriptFile) {
    const sc = vfs.readFileSync(scriptFile);
    if (sc === null) return { ok: false, output: `run_js: 脚本文件不存在: ${scriptFile}`, tool: "run_js", args };
    script = sc;
  }
  if (!script.trim()) return { ok: false, output: "run_js: missing script", tool: "run_js", args };
  const stdin = args.input !== undefined ? String(args.input) : undefined;

  // args：兼容 string 或 string[]
  const jsArgs = args.args !== undefined
    ? (Array.isArray(args.args) ? args.args.map((a) => String(a)) : [String(args.args)])
    : undefined;

  // outputs 白名单：去重、限数量、限工作区相对路径
  const outputs: string[] = [];
  const outputsArg = args.outputs;
  if (outputsArg !== undefined) {
    const list = Array.isArray(outputsArg) ? outputsArg.map((p) => String(p)) : [String(outputsArg)];
    const seen = new Set<string>();
    for (const p of list) {
      if (seen.has(p)) continue;
      seen.add(p);
      if (outputs.length >= jsWasm.MAX_INJECTED_FILES) {
        return { ok: false, output: `run_js: outputs 超过上限 ${jsWasm.MAX_INJECTED_FILES}`, tool: "run_js", args };
      }
      if (p.startsWith("/") || p.includes("..")) {
        return { ok: false, output: `run_js: outputs 必须是工作区相对路径: ${p}`, tool: "run_js", args };
      }
      outputs.push(p);
    }
  }

  // Plan 模式：带 outputs（写回）→ 拦截
  if (readOnly && outputs.length > 0) {
    return {
      ok: false,
      output:
        "[Plan mode] run_js with outputs (file writes) is blocked in Plan mode. " +
        "In Plan mode you can only READ and ANALYZE — propose your plan in text, " +
        "and the user will switch to Bypass mode to let you execute it.",
      tool: "run_js",
      args,
    };
  }

  // files：兼容 string 或 string[]；缺失/超限 fail-fast
  const files: Record<string, string> = {};
  const filesArg = args.files;
  if (filesArg !== undefined) {
    const paths = Array.isArray(filesArg) ? filesArg.map((p) => String(p)) : [String(filesArg)];
    const problems: string[] = [];
    const seen = new Set<string>();
    for (const p of paths) {
      if (seen.has(p)) continue; // 去重
      seen.add(p);
      if (Object.keys(files).length >= jsWasm.MAX_INJECTED_FILES) {
        problems.push(`文件数超过上限 ${jsWasm.MAX_INJECTED_FILES}`);
        break;
      }
      const content = vfs.readFileSync(p);
      if (content === null) { problems.push(`文件不存在: ${p}`); continue; }
      if (content.length > jsWasm.MAX_FILE_BYTES) {
        problems.push(`文件过大(>${jsWasm.MAX_FILE_BYTES.toLocaleString()} 字符): ${p}`);
        continue;
      }
      files[p] = content;
    }
    if (problems.length > 0) {
      return { ok: false, output: `run_js: 无法读取指定文件 — ${problems.join("；")}`, tool: "run_js", args };
    }
  }

  const result = await jsWasm.evaluate({
    script,
    stdin,
    files,
    args: jsArgs,
    outputs: outputs.length > 0 ? outputs : undefined,
  });

  // outputs 写回 VFS + 摘要。引擎错误优先透传（与 run_lua 一致）。
  if (outputs.length > 0) {
    if (!result.ok) {
      return { ok: false, output: result.output, tool: "run_js", args };
    }
    const writtenEntries = result.written ?? {};
    for (const [path, content] of Object.entries(writtenEntries)) {
      vfs.writeFileSync(path, content);
    }
    const lines = Object.entries(writtenEntries)
      .map(([p, c]) => `  - ${p} (${c.length.toLocaleString()} chars, ${c.split("\n").length} lines)`)
      .join("\n");
    const missing = outputs.filter((p) => !(p in writtenEntries));
    const missingNote = missing.length > 0 ? `\n  未产生: ${missing.join(", ")}` : "";
    const count = Object.keys(writtenEntries).length;
    return {
      ok: true,
      output: count > 0
        ? `✓ 已写回 ${count} 个文件（全文未回传，需要内容用 read_file 读取）：\n${lines}${missingNote}`
        : `⚠ 未写回任何文件（全文未回传）${missingNote}`,
      tool: "run_js",
      args,
      mutated: count > 0,
    };
  }
  return { ok: result.ok, output: result.output, tool: "run_js", args };
}

// ── check_syntax 多语言 / 多文件支持 ─────────────────────────────

/** 由路径扩展名推断语言；无扩展名或未知返回 undefined。 */
function extToLang(path: string): string | undefined {
  const base = path.split("/").pop() ?? "";
  const idx = base.lastIndexOf(".");
  const ext = (idx < 0 ? "" : base.slice(idx + 1)).toLowerCase();
  const map: Record<string, string> = {
    ts: "ts", tsx: "tsx", js: "js", jsx: "jsx", mjs: "js", cjs: "js",
    json: "json", lua: "lua", md: "markdown", markdown: "markdown",
    css: "css", html: "html", htm: "html", sql: "sql", py: "python",
    yaml: "yaml", yml: "yaml", toml: "toml", txt: "text",
    sh: "sh", bash: "bash", zsh: "zsh", csv: "csv",
  };
  return map[ext];
}

/** 暂不支持语法校验的语言（诚实反馈，避免假阳性）。 */
function isUnsupportedLang(lang: string): boolean {
  return [
    "css", "html", "sql", "python", "py", "markdown", "md", "text", "txt",
    "yaml", "yml", "toml", "sh", "bash", "zsh", "csv",
  ].includes(lang);
}

/** JSON 语法校验：返回 {ok, error?}，错误带 JSON 字符位置。 */
function checkJson(code: string): { ok: boolean; error?: string } {
  try {
    JSON.parse(code);
    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // V8 错误形如 `Unexpected token } in JSON at position 12`。
    const pos = msg.match(/in JSON at position (\d+)/);
    const m = pos ? pos[1] : "";
    return { ok: false, error: m ? `${msg}（字符 #${m}）` : msg };
  }
}

/** Lua 语法校验：复用 luaWasm 的编译错误（Lua 引擎的 syntax error 会进 result.output）。 */
async function checkLua(code: string): Promise<{ ok: boolean; error?: string }> {
  // 用 evaluate 触发 Lua 编译：语法错误在编译期抛出、不执行任何副作用。
  // lua-wasm 把 stderr 合并进 result.output；wasm 不可用时会回退到 JS 解释器。
  const result = await luaWasm.evaluate({ script: code });
  if (!result.ok) {
    // 尽量提取 lua 的报错行（形如 `<...>:1: 'end' expected`）。
    const m = result.output.match(/(\d+:\s*.+)/m);
    return { ok: false, error: (m && m[1]) || result.output || "Lua 编译失败" };
  }
  return { ok: true };
}

/**
 * 校验**单份**源码（按语言路由）。lang 为解析后的语言（显式或扩展名推断）。
 * path 用于报错回显（可空）。仅 ts/js 系漏过 lang 时由 esbuild 自动推断。
 */
async function checkSourceForLang(
  code: string,
  lang: string | undefined,
): Promise<{ ok: boolean; error?: string }> {
  const l = lang?.toLowerCase();
  if (l && isUnsupportedLang(l)) {
    return { ok: false, error: `暂不支持校验 ${l} 语言；请用对应运行工具（run_lua / run_sql / bash 等）自行验证` };
  }
  if (l === "json") return checkJson(code);
  if (l === "lua") return checkLua(code);
  // 缺省：esbuild 转译校验（js/ts/jsx/tsx；lang 可为空，由 esbuild 自动推断）。
  const err = await esbuildWasm.checkSyntax(code, l);
  return err ? { ok: false, error: err } : { ok: true };
}

export async function dispatchTool(
  name: string,
  args: Record<string, unknown>,
  opts?: { readOnly?: boolean },
): Promise<ToolResult> {
  try {
    switch (name) {
      case "read_file":
        return await toolReadFile(args);
      case "write_file":
        return await toolWriteFile(args);
      case "edit_file":
        return await toolEditFile(args);
      case "delete_file":
        return await toolDeleteFile(args);
      case "list_files":
        return await toolListFiles(args);
      case "list_dirs":
        return await toolListDirs(args);
      case "create_dir":
        return await toolCreateDir(args);
      case "move_file":
        return await toolMoveFile(args);
      case "search_files":
        return await toolSearchFiles(args);
      case "bash":
        return await toolBash(args, opts?.readOnly);
      case "multi_edit":
        return await toolMultiEdit(args);
      case "glob":
        return await toolGlob(args);
      case "search_symbols":
        return await toolSearchSymbols(args);
      case "update_plan":
        return await toolUpdatePlan(args);
      case "append_file":
        return await toolAppendFile(args);
      case "undo_edit":
        return await toolUndoEdit(args);
      case "apply_patch":
        return await toolApplyPatch(args);
      case "view_outline":
        return await toolViewOutline(args);
      case "insert_at":
        return await toolInsertAt(args);
      case "ask_user_input":
        return await toolAskUserInput(args);
      case "zip_archive":
        return await toolZipArchive(args);
      case "unzip_archive":
        return await toolUnzipArchive(args);
      case "run_lua":
        return await toolRunLua(args, opts?.readOnly ?? false);
      case "run_js":
        return await toolRunJs(args, opts?.readOnly ?? false);
      case "parse_yaml":
        return await toolParseYaml(args);
      case "parse_csv":
        return await toolParseCsv(args);
      case "query_json":
        return await toolQueryJson(args);
      case "math":
        return await toolMath(args);
      case "list_skills": {
        const skills = await listSkills();
        if (skills.length === 0) {
          return { ok: true, output: "(没有可用的 skill)", tool: "list_skills", args };
        }
        const lines = skills.map(
          (s) => `- ${s.name} ${s.source === "builtin" ? "(内置)" : "(自定义)"} — ${s.description}`,
        );
        return {
          ok: true,
          output: `可用 Skills（${skills.length} 个）：\n${lines.join("\n")}\n\n用 load_skill(name) 加载某个 skill 的完整指令。`,
          tool: "list_skills",
          args,
        };
      }
      case "load_skill": {
        const name = String(args.name ?? "").trim();
        if (!name) {
          return { ok: false, output: "load_skill: missing 'name' — 先用 list_skills 查看可用 skill", tool: "load_skill", args };
        }
        const skill = await loadSkill(name);
        if (!skill) {
          const available = (await listSkills()).map((s) => s.name).join(", ");
          return {
            ok: false,
            output: `load_skill: skill '${name}' 不存在。可用: ${available || "(无)"}`,
            tool: "load_skill",
            args,
          };
        }
        return {
          ok: true,
          output: `# Skill: ${skill.name} (${skill.source === "builtin" ? "内置" : "自定义"})\n\n${skill.content}`,
          tool: "load_skill",
          args,
        };
      }
      case "create_skill": {
        if (opts?.readOnly) {
          return {
            ok: false,
            output: "[Plan mode] create_skill (写 skills/ 目录) is blocked in Plan mode. 切到 Bypass 模式后才能创建 skill。",
            tool: "create_skill",
            args,
          };
        }
        const name = String(args.name ?? "").trim();
        const content = String(args.content ?? "");
        const res = await createSkill(name, content);
        return {
          ok: res.ok,
          output: res.ok
            ? `✓ 已创建 Skill "${res.name}"（skills/${res.name}/SKILL.md）。首行即描述，AI 可用 load_skill 加载。`
            : `create_skill 失败: ${res.error ?? "未知错误"}`,
          tool: "create_skill",
          args,
          mutated: res.ok,
        };
      }
      case "delete_skill": {
        if (opts?.readOnly) {
          return {
            ok: false,
            output: "[Plan mode] delete_skill (删 skills/ 目录) is blocked in Plan mode. 切到 Bypass 模式后才能删除 skill。",
            tool: "delete_skill",
            args,
          };
        }
        const name = String(args.name ?? "").trim();
        if (!name) {
          return { ok: false, output: "delete_skill: missing 'name'", tool: "delete_skill", args };
        }
        const exists = (await listSkills()).some((s) => s.name === name);
        if (!exists) {
          return { ok: false, output: `delete_skill: skill '${name}' 不存在`, tool: "delete_skill", args };
        }
        const res = await removeSkill(name);
        return {
          ok: true,
          output: res.ok
            ? `✓ 已删除 Skill "${name}"（${res.source === "builtin" ? "内置，已隐藏" : "自定义，目录已移除"}）。`
            : `delete_skill 失败: ${name}`,
          tool: "delete_skill",
          args,
          mutated: true,
        };
      }
      case "transpile": {
        const code = String(args.code ?? "");
        if (!code.trim()) return { ok: false, output: "transpile: missing 'code'", tool: "transpile", args };
        const sourcefile = args.sourcefile !== undefined ? String(args.sourcefile) : undefined;
        const loader = sourcefile
          ? sourcefile.split(".").pop()?.toLowerCase().replace(/^t/, "t")
          : undefined;
        const res = await esbuildWasm.transpile(code, loader);
        return {
          ok: res.ok,
          output: res.ok ? res.code ?? "(empty)" : `transpile 失败: ${res.error}`,
          tool: "transpile",
          args,
        };
      }
      case "check_syntax": {
        // 来源三选一：code（内联）| file（单文件）| files（多文件数组）。
        const p = args.file !== undefined ? String(args.file) : "";
        const batch = args.files;
        const hasBatch = Array.isArray(batch) && batch.length > 0;
        const hasCode = args.code !== undefined;
        const srcCount = (p ? 1 : 0) + (hasCode ? 1 : 0) + (hasBatch ? 1 : 0);
        if (srcCount > 1) {
          return { ok: false, output: "check_syntax: code / file / files 只能三选一", tool: "check_syntax", args };
        }

        const langExplicit = args.lang !== undefined ? String(args.lang).toLowerCase() : undefined;

        // ── 多文件批量：逐个按扩展名推断语言、逐一校验、汇总 ──
        if (hasBatch) {
          const maxFiles = 20;
          if (batch.length > maxFiles) {
            return { ok: false, output: `check_syntax: 单次最多 ${maxFiles} 个文件，收到 ${batch.length}`, tool: "check_syntax", args };
          }
          const lines: string[] = [];
          let allOk = true;
          for (const item of batch) {
            const fp = String(item);
            const content = vfs.readFileSync(fp);
            if (content === null) { lines.push(`  ✗ ${fp} — 文件不存在`); allOk = false; continue; }
            if (!content.trim()) { lines.push(`  ✓ ${fp} — 空文件`); continue; }
            const lang = langExplicit ?? extToLang(fp);
            const r = await checkSourceForLang(content, lang);
            lines.push(r.ok ? `  ✓ ${fp}` : `  ✗ ${fp} — ${r.error}`);
            if (!r.ok) allOk = false;
          }
          return {
            ok: allOk,
            output: `${allOk ? "✓ 全部文件语法合法" : "发现语法问题"}\n${lines.join("\n")}`,
            tool: "check_syntax",
            args,
          };
        }

        // ── 单文件 / 内联代码 ──
        let code: string | null;
        if (p) {
          code = vfs.readFileSync(p);
          if (code === null) {
            return { ok: false, output: `check_syntax: 文件不存在 — ${p}`, tool: "check_syntax", args };
          }
        } else {
          code = String(args.code ?? "");
        }
        if (!code.trim()) return { ok: false, output: p ? `check_syntax: 文件为空 — ${p}` : "check_syntax: missing 'code'", tool: "check_syntax", args };

        // 语言决定：显式 lang > 文件扩展名推断 > esbuild 源码特征。
        const lang = langExplicit ?? (p ? extToLang(p) : undefined);
        // 显式 lang 与文件扩展名矛盾时提示（避免用错语言产生假阴性）。
        if (p && langExplicit && extToLang(p) && langExplicit !== extToLang(p)) {
          return {
            ok: false,
            output: `check_syntax: lang='${langExplicit}' 与文件扩展名推断的 '${extToLang(p)}' 不一致（${p}）。请更正 lang 或检查路径。`,
            tool: "check_syntax",
            args,
          };
        }

        const r = await checkSourceForLang(code, lang);
        return {
          ok: r.ok,
          output: `${r.ok ? "✓ 语法合法" : `语法错误: ${r.error}`}${p ? `（${p}）` : ""}`,
          tool: "check_syntax",
          args,
        };
      }
      case "git_status": {
        const dir = "/repo";
        if (!(await gitEngine.isRepo(dir))) {
          return { ok: true, output: "尚未初始化 git 仓库。用 git_commit 可自动 init + add + commit 完成首次版本化。", tool: "git_status", args };
        }
        const branch = await gitEngine.currentBranch(dir);
        const status = await gitEngine.status(dir);
        const lines = status.map((s) => {
          const label = s.code === 2 || s.code === 3 ? "[新增]" : "[修改]";
          return `  ${label} ${s.path}`;
        });
        return {
          ok: true,
          output: `分支: ${branch}\n${status.length === 0 ? "  工作区干净，无未提交变更" : `待提交（${status.length} 个文件）:\n${lines.join("\n")}`}`,
          tool: "git_status",
          args,
        };
      }
      case "git_log": {
        const dir = "/repo";
        if (!(await gitEngine.isRepo(dir))) {
          return { ok: true, output: "尚无 git 仓库/提交。用 git_commit 创建首次提交。", tool: "git_log", args };
        }
        const log = await gitEngine.log(dir);
        if (log.length === 0) return { ok: true, output: "(无提交记录)", tool: "git_log", args };
        const lines = log.map((c) => `  ${c.oid}  ${c.date}  ${c.author}  ${c.message}`);
        return { ok: true, output: `提交历史（${log.length} 条）:\n${lines.join("\n")}`, tool: "git_log", args };
      }
      case "git_commit": {
        if (opts?.readOnly) {
          return {
            ok: false,
            output: "[Plan mode] git_commit (写 git 仓库) is blocked in Plan mode. 切到 Bypass 模式后才能提交。",
            tool: "git_commit",
            args,
          };
        }
        const message = String(args.message ?? "").trim();
        if (!message) return { ok: false, output: "git_commit: missing 'message'", tool: "git_commit", args };
        const dir = "/repo";
        try {
          await gitEngine.initIfNb(dir);
          await gitEngine.add(dir, ".");
          const oid = await gitEngine.commit(dir, message);
          return {
            ok: true,
            output: `✓ 已提交 ${oid}：${message}\n（git 仓库存独立 IndexedDB，与文件袋隔离）`,
            tool: "git_commit",
            args,
            mutated: true,
          };
        } catch (e) {
          return { ok: false, output: `git_commit 失败: ${e instanceof Error ? e.message : String(e)}`, tool: "git_commit", args };
        }
      }
      case "web_search":
        return await toolWebSearch(args);
      case "fetch_url":
        return await toolFetchUrl(args);
      case "read_multiple_files":
        return await toolReadMultipleFiles(args);
      case "project_stats":
        return await toolProjectStats(args);
      case "orchestrate_task":
        // orchestrate_task is handled as a special case in session.ts
        // (needs AiClientConfig). This fallback prevents unknown-tool errors
        // if dispatch is called directly.
        return {
          ok: false,
          output: "orchestrate_task must be handled by the session orchestrator (this is an internal routing note — the tool should work normally in the agent loop).",
          tool: "orchestrate_task",
          args,
        };
      default:
        return {
          ok: false,
          output: `Unknown tool: ${name}`,
          tool: name,
          args,
        };
    }
  } catch (e) {
    return {
      ok: false,
      output: `Error: ${e instanceof Error ? e.message : String(e)}`,
      tool: name,
      args,
    };
  }
}

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
import { listSkills, loadSkill } from "../skills";
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
        const skills = listSkills();
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
        const skill = loadSkill(name);
        if (!skill) {
          const available = listSkills().map((s) => s.name).join(", ");
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

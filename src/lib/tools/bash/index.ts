"use client";

/**
 * bash/index.ts — 浏览器沙箱 bash 工具入口。
 *
 * 职责：命令字符串 → 分段（&&/||/;）→ 管道（|）→ 重定向 → 单命令执行。
 * 单命令按族分发：commands-fs / commands-text / commands-misc（case 体逐字保留）。
 */
import { vfs } from "../../vfs";
import type { ToolResult } from "../types";
import { planReadOnlyMsg, resolvePath } from "./context";
import type { CaseResult, FamilyRunner } from "./context";
import { runFsCommands } from "./commands-fs";
import { runTextCommands } from "./commands-text";
import { runMiscCommands } from "./commands-misc";


/** Split a command string on &&, ||, and ; while respecting quotes and \;
 *  e.g. `echo abc | sed 's/a/X/; s/b/Y/'` → one segment (the ; is inside quotes)
 *       `echo a > f.txt && cat f.txt` → two segments
 *       `find . -exec wc {} \;` → one segment (\; is protected)
 */
function splitCommandSegments(cmd: string): Array<{ cmd: string; sep: "&&" | "||" | ";" | "none" }> {
  const segments: Array<{ cmd: string; sep: "&&" | "||" | ";" | "none" }> = [];
  let current = "";
  let inStr = false;
  let strChar = "";
  let i = 0;
  let lastSep: "&&" | "||" | ";" = ";";
  while (i < cmd.length) {
    const c = cmd[i];
    if (inStr) {
      current += c;
      if (c === strChar && cmd[i - 1] !== "\\") inStr = false;
      i++;
      continue;
    }
    if (c === '"' || c === "'") {
      inStr = true;
      strChar = c;
      current += c;
      i++;
      continue;
    }
    if (c === "\\" && cmd[i + 1] === ";") {
      current += "\\;";
      i += 2;
      continue;
    }
    if (c === "|" && cmd[i + 1] === "|") {
      if (current.trim()) segments.push({ cmd: current.trim(), sep: segments.length === 0 ? "none" : lastSep });
      current = "";
      lastSep = "||";
      i += 2;
      while (i < cmd.length && /\s/.test(cmd[i])) i++;
      continue;
    }
    if (c === "&" && cmd[i + 1] === "&") {
      if (current.trim()) segments.push({ cmd: current.trim(), sep: segments.length === 0 ? "none" : lastSep });
      current = "";
      lastSep = "&&";
      i += 2;
      while (i < cmd.length && /\s/.test(cmd[i])) i++;
      continue;
    }
    if (c === ";") {
      if (current.trim()) segments.push({ cmd: current.trim(), sep: segments.length === 0 ? "none" : lastSep });
      current = "";
      lastSep = ";";
      i++;
      while (i < cmd.length && /\s/.test(cmd[i])) i++;
      continue;
    }
    if (c === "\n") {
      if (current.trim()) segments.push({ cmd: current.trim(), sep: segments.length === 0 ? "none" : lastSep });
      current = "";
      lastSep = ";";
      i++;
      while (i < cmd.length && /\s/.test(cmd[i])) i++;
      continue;
    }
    current += c;
    i++;
  }
  if (current.trim()) segments.push({ cmd: current.trim(), sep: segments.length === 0 ? "none" : lastSep });
  return segments;
}

// --- for 循环轻量支持 ---
// 仅支持单层：`for VAR in $(CMD) / 静态列表; do BODY; done`（换行/裸 do 亦可）。
// 命令替换（$(find ...)/$(ls)）运行内部命令，输出按行展开为列表；
// 静态列表逐项替换 body 中的 $VAR / ${VAR} 后递归执行。
// 嵌套 for、glob 列表、条件分支不支持——明确报错引导 find -exec / xargs，而非死胡同。
type ForExpandResult =
  | { kind: "ok"; varName: string; body: string; list: string[] }
  | { kind: "error"; message: string }
  | null;

async function expandForLoop(command: string, readOnly: boolean): Promise<ForExpandResult> {
  const trimmed = command.trim();
  // 两种写法：`; do`（单行）与裸 `do`（换行/无分号）
  let m = trimmed.match(/^for\s+([A-Za-z_][A-Za-z0-9_]*)\s+in\s+(.+?)\s*;\s*do\s+([\s\S]+?)\s*;\s*done\s*$/);
  if (!m) m = trimmed.match(/^for\s+([A-Za-z_][A-Za-z0-9_]*)\s+in\s+(.+?)\s*do\s+([\s\S]+?)\s*done\s*$/);
  if (!m) return null;
  const varName = m[1];
  const listSrc = m[2].trim();
  const body = m[3].trim();
  if (!varName || !listSrc || !body) return null;
  if (/^for\s+[A-Za-z_]/.test(body)) {
    return { kind: "error", message: "bash: nested for loops not supported in sandbox. Use find -exec or xargs instead." };
  }
  let list: string[];
  const sub = listSrc.match(/^\$\(([\s\S]+)\)$/);
  if (sub) {
    const res = await runPipeline(sub[1].trim(), readOnly);
    if (!res.ok) return { kind: "error", message: `bash: for list command failed: ${res.output}` };
    list = res.output.split("\n").map((s) => s.trim()).filter(Boolean);
  } else {
    if (/[*?]/.test(listSrc)) {
      return { kind: "error", message: `bash: glob list in for is not expanded in sandbox. Use \`for f in $(find . -name "PATTERN")\` or \`for f in $(ls)\` instead.` };
    }
    list = listSrc.split(/\s+/).filter(Boolean);
  }
  return { kind: "ok", varName, body, list };
}

async function toolBash(args: Record<string, unknown>, readOnly = false): Promise<ToolResult> {
  const command = String(args.command ?? "").trim();
  if (!command) {
    return { ok: false, output: "Empty command", tool: "bash", args };
  }
  // for 循环：整体识别（do/done 跨分号与换行），逐项展开 body 后递归执行。
  // 允许前缀结合：`echo hi && for f in ...; do ...; done` / `cd dir; for ...` —
  // 前缀可含 && || ; 与换行，for 块整体取出；前缀按 `&&` 要求成功、`;`/换行无条件，
  // 然后再跑 for 块（前缀失败时 && 短路跳过 for）。
  const forMatch = command.match(/(^|[\n;]|\s&&|\s\|\|)\s*for\s+[A-Za-z_][A-Za-z0-9_]*\s+in\s+[\s\S]+\bdone\s*$/);
  if (forMatch) {
    const forStart = command.indexOf("for", forMatch.index ?? 0);
    const forCmd = command.slice(forStart).trim();
    const prefix = command.slice(0, forStart).trim();
    const forExp = await expandForLoop(forCmd, readOnly);
    if (forExp) {
      if (forExp.kind === "error") {
        return { ok: false, output: forExp.message, tool: "bash", args };
      }
      const outputs: string[] = [];
      let mutated = false;
      let allOk = true;
      const runForBody = async () => {
        for (const item of forExp!.list) {
          let bodyCmd = forExp!.body.replace(new RegExp(`\\$\\{${forExp!.varName}\\}`, "g"), item);
          bodyCmd = bodyCmd.replace(new RegExp(`\\$${forExp!.varName}\\b`, "g"), item);
          const res = await toolBash({ command: bodyCmd }, readOnly);
          if (res.mutated) mutated = true;
          if (res.output && res.output !== "(command completed with no output)") outputs.push(res.output);
          if (!res.ok) allOk = false;
        }
      };
      if (prefix) {
        // 前缀：最后一个分隔符与后续的 && || 语义。&& 前缀在 for 前 → 需成功才跑 for；
        // || 前缀 → 失败才跑 for；;或换行 → 无条件跑 for。
        const prefixMatch = prefix.match(/(\|\||&&|;|\n)\s*$/);
        const lastSep = prefixMatch ? prefixMatch[1] : ";";
        const execPrefix = await toolBash({ command: prefix }, readOnly);
        if (execPrefix.mutated) mutated = true;
        if (execPrefix.output && execPrefix.output !== "(command completed with no output)") outputs.push(execPrefix.output);
        const prefixOk = execPrefix.ok;
        outputLoop: {
          if (lastSep === "&&") { if (!prefixOk) { allOk = false; break outputLoop; } }
          else if (lastSep === "||") { if (prefixOk) { allOk = true; break outputLoop; } }
          // else: 默认运行 for
        }
        await runForBody();
        return {
          ok: allOk,
          output: outputs.join("\n") || "(command completed with no output)",
          tool: "bash",
          args,
          mutated,
        };
      }
      await runForBody();
      return {
        ok: allOk,
        output: outputs.join("\n") || "(command completed with no output)",
        tool: "bash",
        args,
        mutated,
      };
    }
  }
  const segments = splitCommandSegments(command);
  const outputs: string[] = [];
  let mutated = false;
  let lastOk = true;
  for (const seg of segments) {
    let shouldRun = false;
    switch (seg.sep) {
      case "none": shouldRun = true; break;
      case "&&":   shouldRun = lastOk; break;
      case "||":   shouldRun = !lastOk; break;
      case ";":    shouldRun = true; break;
    }
    if (!shouldRun) continue;
    const out = await runPipeline(seg.cmd, readOnly);
    if (out.mutated) mutated = true;
    if (out.output) outputs.push(out.output);
    lastOk = out.ok;
    if (!out.ok) {
      outputs.push(`(command failed: ${seg.cmd})`);
    }
  }
  return {
    ok: lastOk,
    output: outputs.join("\n") || "(command completed with no output)",
    tool: "bash",
    args,
    mutated,
  };
}

async function runPipeline(cmdLine: string, readOnly = false): Promise<{
  ok: boolean;
  output: string;
  mutated?: boolean;
}> {
  const tokens = tokenizeWithOperators(cmdLine);
  if (tokens.length === 0) return { ok: false, output: "Empty command" };

  interface Stage {
    cmdTokens: string[];
    inputRedirect?: string;
    outputRedirect?: { file: string; append: boolean };
  }
  const stages: Stage[] = [];
  let current: Stage = { cmdTokens: [] };
  let i = 0;
  while (i < tokens.length) {
    const tok = tokens[i];
    if (tok === "|") {
      stages.push(current);
      current = { cmdTokens: [] };
      i++;
    } else if (tok === ">" || tok === ">>") {
      const append = tok === ">>";
      const file = resolvePath(tokens[i + 1] ?? "");
      if (!file) return { ok: false, output: `${tok}: missing file` };
      current.outputRedirect = { file, append };
      i += 2;
    } else if (tok === "<") {
      const file = resolvePath(tokens[i + 1] ?? "");
      if (!file) return { ok: false, output: "<: missing file" };
      current.inputRedirect = file;
      i += 2;
    } else {
      current.cmdTokens.push(tok);
      i++;
    }
  }
  stages.push(current);

  let stdin: string | undefined;
  let lastOutput = "";
  let mutated = false;
  for (const stage of stages) {
    if (stage.cmdTokens.length === 0) {
      return { ok: false, output: "empty command in pipeline" };
    }
    let stageStdin = stdin;
    if (stage.inputRedirect) {
      const f = vfs.readFileSync(stage.inputRedirect);
      if (f === null) return { ok: false, output: `<: ${stage.inputRedirect}: not found` };
      stageStdin = f;
    }
    const result = await runOneShellCommandFromTokens(stage.cmdTokens, stageStdin, readOnly);
    if (result.mutated) mutated = true;
    if (!result.ok) {
      return { ok: false, output: result.output, mutated };
    }
    lastOutput = result.output;
    if (stage.outputRedirect) {
      if (readOnly) {
        return {
          ok: false,
          output: planReadOnlyMsg(`${stage.cmdTokens.join(" ")} ${stage.outputRedirect.append ? ">>" : ">"} ${stage.outputRedirect.file}`),
        };
      }
      const { file, append } = stage.outputRedirect;
      const existing = append ? (vfs.readFileSync(file) ?? "") : "";
      const newContent = existing + result.output + (result.output.endsWith("\n") ? "" : "\n");
      vfs.writeFileSync(file, newContent);
      lastOutput = "";
      mutated = true;
    }
    stdin = result.output;
  }
  return { ok: true, output: lastOutput, mutated };
}

function expandGlob(pattern: string): string[] {
  const regexStr = pattern
    .replace(/[.+^${}()|\\]/g, "\\$&")
    .replace(/\*/g, ".*")
    .replace(/\?/g, ".")
    .replace(/\[(.+?)\]/g, (_, chars) => `[${chars}]`);
  const re = new RegExp(`^${regexStr}$`);
  return vfs
    .listAllFilesSync("")
    .map((f) => f.path)
    .filter((p) => re.test(p))
    .sort();
}

function tokenizeWithOperators(cmd: string): string[] {
  const tokens: string[] = [];
  let i = 0;
  while (i < cmd.length) {
    while (i < cmd.length && /\s/.test(cmd[i])) i++;
    if (i >= cmd.length) break;
    if (cmd[i] === "2" && cmd[i + 1] === ">") {
      i += 2;
      if (cmd[i] === "&") { i += 2; }
      else {
        while (i < cmd.length && /\s/.test(cmd[i])) i++;
        while (i < cmd.length && !/\s/.test(cmd[i]) && cmd[i] !== "|" && cmd[i] !== ">") i++;
      }
      continue;
    }
    if (cmd[i] === "|") { tokens.push("|"); i++; continue; }
    if (cmd[i] === ">") {
      if (cmd[i + 1] === ">") { tokens.push(">>"); i += 2; }
      else { tokens.push(">"); i++; }
      continue;
    }
    if (cmd[i] === "<") { tokens.push("<"); i++; continue; }
    let token = "";
    if (cmd[i] === '"' || cmd[i] === "'") {
      const quote = cmd[i];
      i++;
      while (i < cmd.length && cmd[i] !== quote) {
        token += cmd[i];
        i++;
      }
      i++;
    } else {
      // Stop the word at a quote too: `-t' '` must tokenize as ["-t", " "],
      // not swallow the rest of the line as one unterminated-quoted token.
      while (i < cmd.length && !/\s/.test(cmd[i]) && cmd[i] !== "|" && cmd[i] !== ">" && cmd[i] !== "<" && cmd[i] !== '"' && cmd[i] !== "'") {
        token += cmd[i];
        i++;
      }
    }
    tokens.push(token);
  }
  return tokens;
}



async function runOneShellCommandFromTokens(tokens: string[], stdin?: string, readOnly = false): Promise<{
  ok: boolean;
  output: string;
  mutated?: boolean;
}> {
  if (tokens.length === 0) return { ok: false, output: "Empty command" };

  const expandedTokens: string[] = [tokens[0]];
  const cmdName = tokens[0]?.toLowerCase();
  // Plan mode: bash is READ-ONLY. Block every command that writes to the VFS
  // (the redirect write is gated separately in runPipeline). Read-only filters
  // like `sed` without -i, `sort`, `grep`, `cat`, `find` stay allowed.
  if (readOnly) {
    const writeCmds = ["mkdir", "rm", "rmdir", "touch", "cp", "mv", "tee"];
    if (writeCmds.includes(cmdName)) {
      return { ok: false, output: planReadOnlyMsg(tokens.join(" ")) };
    }
    if (cmdName === "sed" && tokens.some((t, idx) => idx > 0 && /^-i/.test(t))) {
      return { ok: false, output: planReadOnlyMsg(tokens.join(" ")) };
    }
  }
  const selfPatternCmds = ["find", "grep", "sed", "awk", "printf"];
  const skipGlob = selfPatternCmds.includes(cmdName);
  if (skipGlob) {
    // These commands handle their own patterns with -name, regex args, etc.
    for (let i = 1; i < tokens.length; i++) expandedTokens.push(tokens[i]);
  } else {
    for (let i = 1; i < tokens.length; i++) {
      const tok = tokens[i];
      if (tok.startsWith("-") || !/[*?\[]/.test(tok)) {
        expandedTokens.push(tok);
        continue;
      }
      const matches = expandGlob(tok);
      if (matches.length > 0) {
        expandedTokens.push(...matches);
      } else {
        expandedTokens.push(tok);
      }
    }
  }

  const program = expandedTokens[0];
  const rest = expandedTokens.slice(1);

  const resolveInput = (fileArg?: string): { content: string | null; source: string } => {
    if (stdin !== undefined) return { content: stdin, source: "stdin" };
    if (fileArg) {
      const c = vfs.readFileSync(fileArg);
      return { content: c, source: fileArg };
    }
    return { content: null, source: "none" };
  };

  const familyRunners: FamilyRunner[] = [runFsCommands, runTextCommands, runMiscCommands];
  for (const run of familyRunners) {
    const r: CaseResult = await run({ program, rest, stdin, readOnly, resolveInput, runOneShellCommandFromTokens });
    if (r) return r;
  }

    const known = ["ls", "cat", "head", "tail", "wc", "mkdir", "rm", "touch", "echo", "printf", "cp", "mv", "find", "grep", "sed", "sort", "uniq", "cut", "tr", "awk", "xargs", "pwd", "cd", "clear", "tree", "nl", "paste", "bc", "expr", "file", "stat", "diff", "tee", "env", "hostname", "whoami", "id", "uname", "date", "uptime", "rev", "fold", "yes", "basename", "dirname", "realpath", "readlink", "seq", "shuf", "shuffle", "head_dash", "strings", "base64", "column", "comm", "join", "which", "whereis", "noh", "true", "false", "test"];
    return {
      ok: false,
      output: `bash: ${program}: command not supported in browser sandbox. Available: ${known.join(", ")}. Supports | > >> < 2>/dev/null 2>&1`,
    };
}

export { toolBash };

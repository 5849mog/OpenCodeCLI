import { vfs, grepSync } from "../vfs";
import type { ToolResult } from "./types";
import * as bcWasm from "../wasm/bc-wasm";
import * as awkWasm from "../wasm/awk-wasm";
import * as sedWasm from "../wasm/sed-wasm";
import { bashPrintf } from "./printf";
import { globToRegex } from "./glob";
import { evalArithmetic } from "../math-eval";

/** [Plan mode] block message for a bash command that would modify the filesystem. */
function planReadOnlyMsg(cmd: string): string {
  return `[Plan mode] bash is read-only in Plan mode: '${cmd}' would modify the filesystem and was blocked. In Plan mode you can only READ and ANALYZE — propose your plan in text, and the user will switch to Bypass mode to let you execute it.`;
}

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

async function toolBash(args: Record<string, unknown>, readOnly = false): Promise<ToolResult> {
  const command = String(args.command ?? "").trim();
  if (!command) {
    return { ok: false, output: "Empty command", tool: "bash", args };
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
      const file = tokens[i + 1];
      if (!file) return { ok: false, output: `${tok}: missing file` };
      current.outputRedirect = { file, append };
      i += 2;
    } else if (tok === "<") {
      const file = tokens[i + 1];
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

async function runOneShellCommand(cmd: string, stdin?: string): Promise<{
  ok: boolean;
  output: string;
  mutated?: boolean;
}> {
  return runOneShellCommandFromTokens(tokenize(cmd), stdin);
}

function tokenize(cmd: string): string[] {
  const tokens: string[] = [];
  let i = 0;
  while (i < cmd.length) {
    while (i < cmd.length && /\s/.test(cmd[i])) i++;
    if (i >= cmd.length) break;
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
      // Stop the word at a quote too, so `-t' '` yields ["-t", " "] instead of
      // a single unterminated-quoted token that swallows the rest of the line.
      while (i < cmd.length && !/\s/.test(cmd[i]) && cmd[i] !== '"' && cmd[i] !== "'") {
        token += cmd[i];
        i++;
      }
    }
    tokens.push(token);
  }
  return tokens;
}

/** Split lines and strip trailing empty string from terminal \n. */
function splitLines(s: string): string[] {
  const l = s.split("\n");
  if (l.length > 1 && l[l.length - 1] === "") l.pop();
  return l;
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

  switch (program) {
    case "pwd":
      return { ok: true, output: "/" };
    case "cd":
      return { ok: true, output: "" };
    case "clear":
    case "cls":
      return { ok: true, output: "" };
    case "echo": {
      let restArgs = rest;
      const interpretEscapes = restArgs.includes("-e");
      if (interpretEscapes) restArgs = restArgs.filter((t) => t !== "-e");
      let text = restArgs.join(" ").replace(/^["']|["']$/g, "");
      if (interpretEscapes) {
        text = text
          .replace(/\\n/g, "\n")
          .replace(/\\t/g, "\t")
          .replace(/\\r/g, "\r")
          .replace(/\\\\/g, "\\");
      }
      return { ok: true, output: text };
    }
    case "printf": {
      // 解析：跳过未知 - 选项；-v var 消费并忽略（本模拟 bash 无变量系统）；
      // -- 后一个 token 无条件为格式；第一个非 - token 为格式串，其余为参数。
      let ri = 0;
      let fmt: string | undefined;
      while (ri < rest.length) {
        const t = rest[ri];
        if (t === "-v" && rest[ri + 1] !== undefined) { ri += 2; continue; }
        if (t === "--") {
          if (rest[ri + 1] !== undefined) { fmt = rest[ri + 1]; ri += 2; }
          break;
        }
        if (t.startsWith("-")) { ri++; continue; }
        fmt = t;
        ri++;
        break;
      }
      // 无格式 token 时：stdin 整段当格式（剥一个尾换行），否则报错
      if (fmt === undefined) {
        if (stdin !== undefined) fmt = stdin.replace(/\n$/, "");
        else return { ok: false, output: "printf: missing format" };
      }
      // 与真实 printf 一致：不自动追加尾换行，需显式 \n
      return { ok: true, output: bashPrintf(fmt, rest.slice(ri)) };
    }
    case "ls": {
      const allFlags = rest.filter((t) => t.startsWith("-")).join("");
      const longFormat = /l/.test(allFlags);
      const sortBySize = /S/.test(allFlags);
      const reverse = /r/.test(allFlags);
      const recursive = /R/.test(allFlags);
      const humanReadable = /h/.test(allFlags);
      const dir = rest.find((t) => !t.startsWith("-")) ?? "";

      const fmtSize = (bytes: number): string => {
        if (!humanReadable) return String(bytes).padStart(8);
        if (bytes < 1024) return String(bytes).padStart(5) + "B";
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1).padStart(5) + "K";
        return (bytes / (1024 * 1024)).toFixed(1).padStart(5) + "M";
      };

      if (recursive) {
        let files = vfs.listAllFilesSync(dir);
        if (sortBySize) {
          files = [...files].sort((a, b) => {
            const sa = (a.content ?? "").length;
            const sb = (b.content ?? "").length;
            return reverse ? sa - sb : sb - sa;
          });
        }
        if (longFormat) {
          const lines = files.map((f) => {
            const size = (f.content ?? "").length;
            const perms = "-rw-r--r--";
            const date = new Date(f.updatedAt).toLocaleDateString("en-US", { month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" });
            return `${perms}  1 developer developer ${fmtSize(size)} ${date} ${f.path}`;
          });
          return { ok: true, output: `total ${files.length}\n${lines.join("\n")}` };
        }
        return { ok: true, output: files.map((f) => "./" + f.path).join("\n") || "" };
      }

      let children = vfs.listSync(dir);
      if (children.length === 0 && dir) {
        const stat = vfs.statSync(dir);
        if (!stat) {
          return { ok: false, output: `ls: ${dir}: No such file or directory` };
        }
        if (stat.type === "file") {
          const size = (stat.content ?? "").length;
          if (longFormat) {
            const date = new Date(stat.updatedAt).toLocaleDateString("en-US", { month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" });
            return { ok: true, output: `-rw-r--r--  1 developer developer ${fmtSize(size)} ${date} ${dir}` };
          }
          return { ok: true, output: dir };
        }
        return { ok: true, output: "" };
      }
      if (children.length === 0) return { ok: true, output: "" };
      if (sortBySize) {
        children = [...children].sort((a, b) => {
          const sa = a.type === "file" ? (a.content ?? "").length : 0;
          const sb = b.type === "file" ? (b.content ?? "").length : 0;
          return reverse ? sa - sb : sb - sa;
        });
      }
      if (longFormat) {
        const lines = children.map((c) => {
          const name = c.path.split("/").pop() ?? c.path;
          const isDir = c.type === "dir";
          const size = isDir ? 0 : (c.content ?? "").length;
          const perms = isDir ? "drwxr-xr-x" : "-rw-r--r--";
          const date = new Date(c.updatedAt).toLocaleDateString("en-US", { month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" });
          return `${perms}  1 developer developer ${fmtSize(size)} ${date} ${name}${isDir ? "/" : ""}`;
        });
        return { ok: true, output: `total ${children.length}\n${lines.join("\n")}` };
      }
      return {
        ok: true,
        output: children
          .map((c) => {
            const name = c.path.split("/").pop() ?? c.path;
            return c.type === "dir" ? name + "/" : name;
          })
          .join("\n"),
      };
    }
    case "tree": {
      const dir = rest.find((t) => !t.startsWith("-")) ?? "";
      return { ok: true, output: vfs.treeSync(dir) || "(empty)" };
    }
    case "cat": {
      const fileArgs = rest.filter((t) => !t.startsWith("-"));
      let content: string | null;
      if (fileArgs.length > 0) {
        // 与真实 cat 一致：按参数顺序拼接全部文件，且给出文件时忽略管道 stdin。
        // 旧实现只用 rest.find() 取第一个文件，`cat a b | awk ...` 只会喂 a 的内容。
        const parts: string[] = [];
        for (const f of fileArgs) {
          const c = vfs.readFileSync(f);
          if (c === null) return { ok: false, output: `cat: ${f}: not found` };
          parts.push(c);
        }
        content = parts.join("");
      } else {
        content = resolveInput(undefined).content;
      }
      if (content === null) return { ok: false, output: `cat: (no input)` };
      if (rest.includes("-n")) {
        // cat -n: number each line, 6-digit right-aligned (like nl)
        return { ok: true, output: splitLines(content).map((l, i) => `${String(i + 1).padStart(6)}  ${l}`).join("\n") };
      }
      return { ok: true, output: content };
    }
    case "head": {
      const nFlag = rest.indexOf("-n");
      let n = 10;
      let fileIdx = rest.findIndex((t) => !t.startsWith("-"));
      if (nFlag >= 0 && rest[nFlag + 1]) {
        n = parseInt(rest[nFlag + 1], 10);
        fileIdx = rest.findIndex((t, i) => i > nFlag + 1 && !t.startsWith("-"));
      } else if (n === 10) {
        const numIdx = rest.findIndex((t) => /^-(\d+)$/.test(t));
        if (numIdx >= 0) {
          n = parseInt(rest[numIdx].slice(1), 10);
          fileIdx = rest.findIndex((t, i) => i !== numIdx && !t.startsWith("-"));
        }
      }
      const file = rest[fileIdx];
      const { content } = resolveInput(file);
      if (content === null) return { ok: false, output: "head: no input" };
      return { ok: true, output: splitLines(content).slice(0, n).join("\n") };
    }
    case "tail": {
      const nFlag = rest.indexOf("-n");
      let n = 10;
      let fileIdx = rest.findIndex((t) => !t.startsWith("-"));
      if (nFlag >= 0 && rest[nFlag + 1]) {
        n = parseInt(rest[nFlag + 1], 10);
        fileIdx = rest.findIndex((t, i) => i > nFlag + 1 && !t.startsWith("-"));
      } else if (n === 10) {
        const numIdx = rest.findIndex((t) => /^-(\d+)$/.test(t));
        if (numIdx >= 0) {
          n = parseInt(rest[numIdx].slice(1), 10);
          fileIdx = rest.findIndex((t, i) => i !== numIdx && !t.startsWith("-"));
        }
      }
      const file = rest[fileIdx];
      const { content } = resolveInput(file);
      if (content === null) return { ok: false, output: "tail: no input" };
      const lines = splitLines(content);
      return { ok: true, output: lines.slice(-n).join("\n") };
    }
    case "wc": {
      const flags = rest.filter((t) => t.startsWith("-")).join("");
      const files = rest.filter((t) => !t.startsWith("-"));
      const onlyLines = /l/.test(flags);
      const onlyWords = /w/.test(flags);
      const onlyChars = /c/.test(flags) || /m/.test(flags);

      if (files.length > 1 || (files.length === 1 && stdin === undefined)) {
        const results: string[] = [];
        let totalLines = 0, totalWords = 0, totalBytes = 0;
        for (const f of files) {
          const content = vfs.readFileSync(f);
          if (content === null) {
            results.push(`wc: ${f}: not found`);
            continue;
          }
          const lines = content === "" ? 0 : splitLines(content).length;
          const words = content === "" ? 0 : content.split(/\s+/).filter(Boolean).length;
          const bytes = content.length;
          totalLines += lines;
          totalWords += words;
          totalBytes += bytes;
          if (onlyLines) results.push(`${String(lines).padStart(8)} ${f}`);
          else if (onlyWords) results.push(`${String(words).padStart(8)} ${f}`);
          else if (onlyChars) results.push(`${String(bytes).padStart(8)} ${f}`);
          else results.push(`${String(lines).padStart(8)} ${String(words).padStart(8)} ${String(bytes).padStart(8)} ${f}`);
        }
        if (files.length > 1) {
          if (onlyLines) results.push(`${String(totalLines).padStart(8)} total`);
          else if (onlyWords) results.push(`${String(totalWords).padStart(8)} total`);
          else if (onlyChars) results.push(`${String(totalBytes).padStart(8)} total`);
          else results.push(`${String(totalLines).padStart(8)} ${String(totalWords).padStart(8)} ${String(totalBytes).padStart(8)} total`);
        }
        return { ok: true, output: results.join("\n") };
      }

      const { content } = resolveInput(files[0]);
      if (content === null) return { ok: false, output: "wc: no input" };
      const lines = content === "" ? 0 : splitLines(content).length;
      const words = content === "" ? 0 : content.split(/\s+/).filter(Boolean).length;
      const bytes = content.length;
      const suffix = stdin !== undefined ? "" : ` ${files[0] ?? ""}`;
      if (onlyLines) return { ok: true, output: `${lines}${suffix}` };
      if (onlyWords) return { ok: true, output: `${words}${suffix}` };
      if (onlyChars) return { ok: true, output: `${bytes}${suffix}` };
      return { ok: true, output: `${lines} ${words} ${bytes}${suffix}` };
    }
    case "mkdir": {
      const targets = rest.filter((t) => !t.startsWith("-"));
      if (targets.length === 0) return { ok: false, output: "mkdir: missing operand" };
      for (const t of targets) {
        try {
          vfs.mkdirSync(t);
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          return { ok: false, output: msg };
        }
      }
      return { ok: true, output: "", mutated: true };
    }
    case "rm": {
      const targets = rest.filter((t) => !t.startsWith("-"));
      if (targets.length === 0) return { ok: false, output: "rm: missing operand" };
      let total = 0;
      const missing: string[] = [];
      for (const t of targets) {
        const stat = vfs.statSync(t);
        if (!stat) { missing.push(t); continue; }
        vfs.delete(t);
        total++;
      }
      const parts = [`removed ${total} node(s)`];
      if (missing.length > 0) parts.push(`not found: ${missing.join(", ")}`);
      return { ok: missing.length === 0, output: parts.join("; "), mutated: total > 0 };
    }
    case "rmdir": {
      const targets = rest.filter((t) => !t.startsWith("-"));
      if (targets.length === 0) return { ok: false, output: "rmdir: missing operand" };
      for (const t of targets) {
        const node = vfs.statSync(t);
        if (!node) return { ok: false, output: `rmdir: ${t}: No such file or directory` };
        if (node.type !== "dir") return { ok: false, output: `rmdir: ${t}: Not a directory` };
        if (vfs.listSync(t).length > 0) return { ok: false, output: `rmdir: ${t}: Directory not empty` };
        vfs.delete(t); // fire-and-forget (matches rm's convention; cache update is synchronous-ish)
      }
      return { ok: true, output: "", mutated: true };
    }
    case "touch": {
      const targets = rest.filter((t) => !t.startsWith("-"));
      if (targets.length === 0) return { ok: false, output: "touch: missing operand" };
      for (const t of targets) {
        if (vfs.readFileSync(t) === null) vfs.writeFileSync(t, "");
      }
      return { ok: true, output: "", mutated: true };
    }
    case "cp": {
      const targets = rest.filter((t) => !t.startsWith("-"));
      if (targets.length < 2) return { ok: false, output: "cp: missing operand" };
      const [from, to] = targets;
      const content = vfs.readFileSync(from);
      if (content === null) return { ok: false, output: `cp: ${from}: not found` };
      vfs.writeFileSync(to, content);
      return { ok: true, output: "", mutated: true };
    }
    case "mv": {
      const targets = rest.filter((t) => !t.startsWith("-"));
      if (targets.length < 2) return { ok: false, output: "mv: missing operand" };
      const [from, to] = targets;
      vfs.renameSync(from, to);
      return { ok: true, output: "", mutated: true };
    }
    case "find": {
      const positional = rest.filter((t) => !t.startsWith("-") && t !== "{}" && !/\\+;/.test(t) && t !== ";");
      let root = positional[0] ?? "";
      if (root === ".") root = "";
      const typeIdx = rest.indexOf("-type");
      const typeFilter = typeIdx >= 0 ? rest[typeIdx + 1] : null;
      const nameIdx = rest.indexOf("-name");
      const inameIdx = rest.indexOf("-iname");
      const useIname = inameIdx >= 0;
      const pattern = useIname ? rest[inameIdx + 1] : nameIdx >= 0 ? rest[nameIdx + 1] : null;
      const execIdx = rest.indexOf("-exec");
      const execTokens = execIdx >= 0 ? rest.slice(execIdx + 1) : [];
      let execCmd: string[] = [];
      if (execIdx >= 0) {
        for (const t of execTokens) {
          if (/\\+;/.test(t) || t === ";") break;
          execCmd.push(t);
        }
      }
      // Candidate nodes: -type d → dirs; otherwise files (default output keeps
      // listing files only). Include the root itself so `find src -type d` shows src.
      let nodes = vfs
        .allSync()
        .filter((n) => !root || n.path === root || n.path.startsWith(root + "/"))
        .sort((a, b) => a.path.localeCompare(b.path));
      if (typeFilter === "d") {
        nodes = nodes.filter((n) => n.type === "dir");
      } else {
        nodes = nodes.filter((n) => n.type === "file");
      }
      // -name / -iname: EXACT glob against the basename — anchored, so `*.ts`
      // never substring-matches `mytsconfig.json`. matchDot:true mirrors real
      // find (a bare `*` matches hidden basenames).
      if (pattern) {
        const re = globToRegex(pattern, { matchDot: true });
        const nameRe = useIname ? new RegExp(re.source, "i") : re;
        nodes = nodes.filter((n) => nameRe.test(n.path.split("/").pop() ?? n.path));
      }
      if (execCmd.length > 0) {
        const results: string[] = [];
        let allOk = true;
        for (const n of nodes) {
          const fullPath = "./" + n.path;
          const cmdTokens = execCmd.map((t) => (t === "{}" ? fullPath : t));
          const r = await runOneShellCommandFromTokens(cmdTokens, undefined, readOnly);
          if (r.output) results.push(r.output);
          if (!r.ok) allOk = false;
        }
        // Propagate inner failures (incl. Plan-mode blocks) instead of always ok:true
        return { ok: allOk, output: results.join("\n") || "(command completed with no output)" };
      }
      const dirSuffix = typeFilter === "d" ? "/" : "";
      return {
        ok: true,
        output: nodes.map((n) => "./" + n.path + dirSuffix).join("\n") || "(none)",
      };
    }
    case "grep": {
      // Parse args respecting flag values (-C 3 consumes the 3)
      const flags: string[] = [];
      const positional: string[] = [];
      for (let ri = 0; ri < rest.length; ri++) {
        const t = rest[ri];
        if (t.startsWith("-")) {
          flags.push(t);
          if ((t === "-C" || t === "-A" || t === "-B") && ri + 1 < rest.length && !rest[ri + 1].startsWith("-")) {
            ri++; // skip the flag's value argument
          }
        } else {
          positional.push(t);
        }
      }
      const allFlags = flags.join("");
      if (positional.length === 0) {
        return { ok: false, output: "grep: missing pattern" };
      }
      const pattern = positional[0];
      const fileArg = positional[1];
      const caseSensitive = !/i/.test(allFlags);
      const onlyMatch = /o/.test(allFlags);
      const withLineNum = /n/.test(allFlags);
      const invert = /v/.test(allFlags);
      const countOnly = /c/.test(allFlags);
      const filesOnly = /l/.test(allFlags);
      const quiet = /q/.test(allFlags);
      const ctxC = /C/.test(allFlags);
      const ctxA = /A/.test(allFlags);
      const ctxB = /B/.test(allFlags);
      const hasCtx = ctxC || ctxA || ctxB;
      const isSingleFile = !!(fileArg && positional.length === 2); // only 1 file given

      let re: RegExp;
      try {
        re = new RegExp(pattern, caseSensitive ? "g" : "gi");
      } catch {
        return { ok: false, output: `grep: invalid pattern: ${pattern}` };
      }

      /** Return whether a line matches (respecting -v). */
      const matchLine = function (line: string): boolean {
        re.lastIndex = 0;
        return invert ? !re.test(line) : re.test(line);
      };

      /** Split content, strip trailing empty line from terminal trailing \n. */
      const splitLines = function (s: string): string[] {
        const l = s.split("\n");
        if (l.length > 1 && l[l.length - 1] === "") l.pop();
        return l;
      };

      /** Build prefix for a matched/context line. */
      const linePrefix = function (idx: number, sep: string, isStdin: boolean): string {
        if (isStdin) return withLineNum ? `${idx + 1}${sep} ` : "";
        return isSingleFile ? `${idx + 1}${sep} ` : `${fileArg}:${idx + 1}${sep} `;
      };

      /** Find all matching line indices. */
      const findHits = function (lines: string[]): number[] {
        const h: number[] = [];
        for (let i = 0; i < lines.length; i++) { if (matchLine(lines[i])) h.push(i); }
        return h;
      };

      /** Parse context value from rest (supports -C3 and -C 3). */
      const getCtxVal = function (flag: string): number {
        const idx = rest.indexOf(flag);
        if (idx >= 0 && idx + 1 < rest.length && !rest[idx + 1].startsWith("-")) return Math.max(0, parseInt(rest[idx + 1], 10) || 0);
        const combined = flags.find((t) => t.startsWith(flag) && t.length > flag.length);
        return combined ? Math.max(0, parseInt(combined.slice(flag.length), 10) || 0) : 0;
      };

      /** Format grep output with optional context lines. */
      const formatMatches = function (lines: string[], isStdin: boolean): string[] {
        const hits = findHits(lines);
        if (hits.length === 0) return [];

        if (countOnly) return [isSingleFile ? String(hits.length) : `${fileArg}:${hits.length}`];
        if (filesOnly) return [fileArg ?? "-"];
        if (quiet) return [];

        if (onlyMatch) {
          const out: string[] = [];
          for (const idx of hits) {
            re.lastIndex = 0;
            const matches = lines[idx].match(re);
            if (matches) {
              for (const m of matches) out.push(linePrefix(idx, ":", isStdin) + m);
            }
          }
          return out;
        }

        if (!hasCtx) {
          const out: string[] = [];
          for (const idx of hits) out.push(linePrefix(idx, ":", isStdin) + lines[idx]);
          return out;
        }

        // With context (-C, -A, -B)
        let afterCtx = 0, beforeCtx = 0;
        if (ctxC) { const v = getCtxVal("-C"); afterCtx = v; beforeCtx = v; }
        else { if (ctxA) afterCtx = getCtxVal("-A"); if (ctxB) beforeCtx = getCtxVal("-B"); }
        const out: string[] = [];
        let lastPrinted = -1;

        for (const idx of hits) {
          const start = Math.max(0, idx - beforeCtx);
          const end = Math.min(lines.length - 1, idx + afterCtx);
          if (lastPrinted >= 0 && start > lastPrinted + 1) out.push("--");
          for (let j = start; j <= end; j++) {
            if (j > lastPrinted) {
              const isHit = hits.includes(j);
              out.push(linePrefix(j, isHit ? ":" : "-", isStdin) + lines[j]);
              lastPrinted = j;
            }
          }
        }
        return out;
      };

      if (quiet) {
        if (stdin !== undefined || fileArg) {
          const s = stdin ?? vfs.readFileSync(fileArg!);
          if (s === null) return { ok: false, output: `grep: ${fileArg}: not found` };
          const lines = splitLines(s);
          for (let i = 0; i < lines.length; i++) { if (matchLine(lines[i])) return { ok: true, output: "" }; }
          return { ok: true, output: "(no matches)" };
        }
        const matches = grepSync(pattern, { regex: true, caseSensitive, max: 1 });
        return { ok: true, output: matches.length > 0 ? "" : "(no matches)" };
      }

      if (stdin !== undefined) {
        const lines = splitLines(stdin);
        const out = formatMatches(lines, true);
        return { ok: true, output: out.join("\n") || "" };
      }
      if (fileArg) {
        const content = vfs.readFileSync(fileArg);
        if (content === null) {
          // Check if it's a directory — do recursive search if so
          const stat = vfs.statSync(fileArg);
          if (stat && stat.type === "dir") {
            const matches = grepSync(pattern, { path: fileArg, regex: true, caseSensitive, max: 100 });
            if (matches.length === 0) return { ok: true, output: "" };
            const truncated = Boolean((matches as (typeof matches & { truncated?: boolean })).truncated);
            const truncNote = truncated ? `\n⚠️ grep: results TRUNCATED at 100 — there are MORE matches. Narrow the search.` : "";
            if (countOnly) return { ok: true, output: String(matches.length) };
            if (filesOnly) return { ok: true, output: matches.map((m) => m.path).filter((p, i, a) => a.indexOf(p) === i).join("\n") };
            return { ok: true, output: matches.map((m) => `${m.path}:${m.line}: ${m.text}`).join("\n") + truncNote };
          }
          return { ok: false, output: `grep: ${fileArg}: not found` };
        }
        const lines = splitLines(content);
        const out = formatMatches(lines, false);
        return { ok: true, output: out.join("\n") || "" };
      }
      // Workspace-wide search (no file arg)
      const matches = grepSync(pattern, { regex: true, caseSensitive, max: 100 });
      if (matches.length === 0) return { ok: true, output: "" };
      const truncated = Boolean((matches as (typeof matches & { truncated?: boolean })).truncated);
      const truncNote = truncated ? `\n⚠️ grep: results TRUNCATED at 100 — there are MORE matches. Narrow the search.` : "";
      if (countOnly) return { ok: true, output: String(matches.length) };
      if (filesOnly) return { ok: true, output: matches.map((m) => m.path).filter((p, i, a) => a.indexOf(p) === i).join("\n") };
      return {
        ok: true,
        output: matches.map((m) => `${m.path}:${m.line}: ${m.text}`).join("\n") + truncNote,
      };
    }
    case "sed": {
      // 原生 GNU sed 引擎（WebAssembly）。-i 原地写回 VFS 保留在 wrapper 层：
      // 不把 -i 传给引擎（MEMFS 里的改名写回碰不到 VFS），而是引擎输出后
      // 由这里 vfs.writeFileSync 写回（与旧 JS 实现一致）。
      const sedArgs: string[] = [];
      const positional: string[] = [];
      let inplace = false;
      let i = 0;
      while (i < rest.length) {
        const t = rest[i];
        // -i / -iSUFFIX / --in-place：wrapper 处理，不传引擎（-i.bak 备份在沙箱内不建）
        if (t === "-i" || (t.startsWith("-i") && t.length > 2) || t === "--in-place" || t.startsWith("--in-place")) {
          inplace = true; i += 1; continue;
        }
        if (t === "-e" && rest[i + 1] !== undefined) { sedArgs.push(t, rest[i + 1]); i += 2; continue; }
        if (t.startsWith("-e") && t.length > 2)      { sedArgs.push(t); i += 1; continue; }
        if (t === "-f" && rest[i + 1] !== undefined) { sedArgs.push(t, rest[i + 1]); i += 2; continue; }
        if (t.startsWith("-f") && t.length > 2)      { sedArgs.push(t); i += 1; continue; }
        if (t.startsWith("-")) { sedArgs.push(t); i += 1; continue; } // -E/-n/-r/-s/-z 等原样传引擎
        positional.push(t); i += 1;
      }

      // 脚本来源：-e/-f 已含脚本 → positional[0] 是数据文件；否则 positional[0] 是脚本。
      // 空字符串脚本（sed ''）合法 = no-op 原样输出，与旧 JS 及真实 sed 一致。
      const scriptFromFlag = sedArgs.some((a) => a === "-e" || a.startsWith("-e") || a === "-f" || a.startsWith("-f"));
      const script = scriptFromFlag ? "" : (positional[0] ?? "");
      if (positional.length === 0 && !scriptFromFlag) return { ok: false, output: "sed: missing script" };
      const file = scriptFromFlag ? positional[0] : positional[1];
      const { content, source } = resolveInput(file);
      if (content === null) return { ok: false, output: "sed: no input" };
      const fromStdin = source === "stdin";

      // files：数据文件 + -f 脚本文件 → MEMFS 内容表（argv 里的每个文件都要有内容）
      const files: Record<string, string> = {};
      if (file && !fromStdin) files[file] = content;

      // JS 降级入参：-e/-f 的脚本拼成一段（-f 读 VFS 脚本文件内容并注入 MEMFS）
      let fbScript = script;
      if (scriptFromFlag) {
        const parts: string[] = [];
        for (let k = 0; k < sedArgs.length; k++) {
          const a = sedArgs[k];
          if (a === "-e" && sedArgs[k + 1] !== undefined) { parts.push(sedArgs[k + 1]); k += 1; }
          else if (a.startsWith("-e") && a.length > 2) { parts.push(a.slice(2)); }
          else if (a === "-f" && sedArgs[k + 1] !== undefined) {
            const sc = vfs.readFileSync(sedArgs[k + 1]);
            if (sc === null) return { ok: false, output: `sed: can't read ${sedArgs[k + 1]}: No such file or directory` };
            files[sedArgs[k + 1]] = sc;
            parts.push(sc);
            k += 1;
          } else if (a.startsWith("-f") && a.length > 2) {
            const sf = a.slice(2);
            const sc = vfs.readFileSync(sf);
            if (sc === null) return { ok: false, output: `sed: can't read ${sf}: No such file or directory` };
            files[sf] = sc;
            parts.push(sc);
          }
        }
        fbScript = parts.join(";");
      }

      const result = await sedWasm.evaluate({
        argv: [
          ...sedArgs,
          ...(!scriptFromFlag && positional.length > 0 ? [script] : []),
          ...(file && !fromStdin ? [file] : []),
        ],
        files: Object.keys(files).length > 0 ? files : undefined,
        stdin: fromStdin ? content : undefined,
        fallback: { script: fbScript, content },
      });
      if (!result.ok) return { ok: false, output: result.output };
      if (inplace && file) {
        vfs.writeFileSync(file, result.output === "(no output)" ? "" : result.output);
        return { ok: true, output: "", mutated: true };
      }
      return { ok: true, output: result.output };
    }
    case "sort": {
      // The file is the LAST non-flag token — flags like -t DELIM or -k KEY
      // precede it, so a delimiter value (' ' after -t) must not be mistaken
      // for the file.
      let file: string | undefined;
      for (let i = rest.length - 1; i >= 0; i--) {
        if (!rest[i].startsWith("-")) { file = rest[i]; break; }
      }
      const { content } = resolveInput(file);
      if (content === null) return { ok: false, output: "sort: no input" };
      // splitLines drops the phantom record from a trailing \n, so a file
      // ending in newline doesn't sort a stray empty line to the top.
      const lines = content === "" ? [] : splitLines(content);
      const allFlags = rest.filter((t) => t.startsWith("-")).join("");
      const reverse = /r/.test(allFlags);
      const caseInsensitive = /f/.test(allFlags);
      const numeric = /n/.test(allFlags);
      const kMatch = rest.find((t) => t.startsWith("-k"));
      const keyField = kMatch ? parseInt(kMatch.slice(2), 10) - 1 : -1;
      const tIdx = rest.indexOf("-t");
      const delim = tIdx >= 0 ? rest[tIdx + 1] : /\s+/;
      const sorted = [...lines].sort((a, b) => {
        let ca = a, cb = b;
        if (keyField >= 0) {
          const af = a.split(delim).filter(Boolean);
          const bf = b.split(delim).filter(Boolean);
          ca = af[keyField] ?? "";
          cb = bf[keyField] ?? "";
        }
        if (caseInsensitive) { ca = ca.toLowerCase(); cb = cb.toLowerCase(); }
        if (numeric) {
          const na = parseFloat(ca), nb = parseFloat(cb);
          if (isNaN(na) && isNaN(nb)) return 0;
          if (isNaN(na)) return 1;
          if (isNaN(nb)) return -1;
          return na - nb;
        }
        return ca < cb ? -1 : ca > cb ? 1 : 0;
      });
      if (reverse) sorted.reverse();
      return { ok: true, output: sorted.join("\n") };
    }
    case "uniq": {
      const file = rest.find((t) => !t.startsWith("-"));
      const { content } = resolveInput(file);
      if (content === null) return { ok: false, output: "uniq: no input" };
      const count = rest.includes("-c");
      const lines = content.split("\n");
      const result: string[] = [];
      let prev: string | null = null;
      let cnt = 0;
      for (const line of lines) {
        if (line === prev) { cnt++; }
        else {
          if (prev !== null) result.push(count ? `${String(cnt).padStart(7)} ${prev}` : prev);
          prev = line;
          cnt = 1;
        }
      }
      if (prev !== null) result.push(count ? `${String(cnt).padStart(7)} ${prev}` : prev);
      return { ok: true, output: result.join("\n") };
    }
    case "cut": {
      // The file is the LAST non-flag token, so option VALUES (-d DELIM, -f N,
      // -c RANGE) are never mistaken for the file (e.g. `cut -d' ' -f1 file`).
      let file: string | undefined;
      for (let i = rest.length - 1; i >= 0; i--) {
        if (!rest[i].startsWith("-")) { file = rest[i]; break; }
      }
      const { content } = resolveInput(file);
      if (content === null) return { ok: false, output: "cut: no input" };

      // --- Fallback for combined forms like -d,, -f2, -c1-3 (no space) ---
      let dIdx = rest.indexOf("-d");
      let fIdx = rest.indexOf("-f");
      let cIdx = rest.indexOf("-c");

      // Combined -d, (with comma as delimiter, e.g. `-d,`)
      if (dIdx === -1) {
        const dToken = rest.find((t) => /^-d['"](.)['"]$/.test(t));
        if (dToken) {
          dIdx = rest.indexOf(dToken);
          rest[dIdx] = "-d";
          rest.splice(dIdx + 1, 0, (dToken.match(/^-d['"](.)['"]$/) as RegExpMatchArray)[1]);
        }
      }
      // Combined -f2 (no space)
      if (fIdx === -1) {
        const fToken = rest.find((t) => /^-f[\d,\-]/.test(t));
        if (fToken) {
          fIdx = rest.indexOf(fToken);
          rest[fIdx] = "-f";
          rest.splice(fIdx + 1, 0, fToken.slice(2));
        }
      }
      // Combined -d, (single char, no quotes, e.g. `-d,`)
      if (dIdx === -1) {
        const dToken = rest.find((t) => /^-d[^'"\s-]/.test(t) && t.length === 3);
        if (dToken) {
          dIdx = rest.indexOf(dToken);
          rest[dIdx] = "-d";
          rest.splice(dIdx + 1, 0, dToken[2]);
        }
      }
      // Combined -c1-3 (no space)
      if (cIdx === -1) {
        const cToken = rest.find((t) => /^-c[\d,\-]/.test(t));
        if (cToken) {
          cIdx = rest.indexOf(cToken);
          rest[cIdx] = "-c";
          rest.splice(cIdx + 1, 0, cToken.slice(2));
        }
      }

      dIdx = rest.indexOf("-d");
      fIdx = rest.indexOf("-f");
      cIdx = rest.indexOf("-c");

      // --- -d -f mode ---
      if (fIdx >= 0) {
        const delim = dIdx >= 0 ? rest[dIdx + 1] : "\t";
        const rawFields = rest[fIdx + 1];
        // Expand range syntax: "1-3,5" → [1, 2, 3, 5]
        const fieldNums: number[] = [];
        for (const part of rawFields.split(",")) {
          const rangeMatch = part.match(/^(\d+)-(\d+)$/);
          if (rangeMatch) {
            const start = parseInt(rangeMatch[1], 10);
            const end = parseInt(rangeMatch[2], 10);
            for (let n = start; n <= end; n++) fieldNums.push(n);
          } else {
            fieldNums.push(parseInt(part, 10));
          }
        }
        const fields = fieldNums.map((n) => n - 1);
        const lines = content.split("\n").map((line) =>
          line.split(delim).filter((_, i) => fields.includes(i)).join(delim),
        );
        return { ok: true, output: lines.join("\n") };
      }

      // --- -c mode ---
      if (cIdx >= 0) {
        const range = rest[cIdx + 1];
        let start = 0, end: number | undefined;
        const m = range.match(/^(\d+)?-(\d+)?$/);
        if (m) {
          start = m[1] ? parseInt(m[1], 10) - 1 : 0;
          end = m[2] ? parseInt(m[2], 10) : undefined;
        } else if (/^\d+$/.test(range)) {
          // Single number: -c 1 → column 1 only
          const n = parseInt(range, 10);
          start = n - 1;
          end = n;
        } else {
          return { ok: false, output: `cut: invalid range: ${range}` };
        }
        const lines = content.split("\n").map((line) => line.slice(start, end));
        return { ok: true, output: lines.join("\n") };
      }

      return { ok: false, output: "cut: use -d DELIM -f FIELDS or -c RANGE" };
    }
    case "tr": {
      const deleteMode = rest.includes("-d");
      const sets = rest.filter((t) => !t.startsWith("-"));
      const minSets = deleteMode ? 1 : 2;
      if (sets.length < minSets) return { ok: false, output: deleteMode ? "tr: -d needs SET1" : "tr: needs SET1 and SET2" };
      const set1 = sets[0];
      const set2 = deleteMode ? "" : sets[1];
      const file = sets[deleteMode ? 1 : 2];
      const { content } = resolveInput(file);
      if (content === null) return { ok: false, output: "tr: no input" };
      const unescape = (s: string) => s.replace(/\\t/g, "\t").replace(/\\n/g, "\n").replace(/\\\\/g, "\\");
      const expand = (s: string) => {
        s = unescape(s);
        const m = s.match(/^(.)-(.)$/);
        if (m) {
          const result: string[] = [];
          for (let c = m[1].charCodeAt(0); c <= m[2].charCodeAt(0); c++) result.push(String.fromCharCode(c));
          return result.join("");
        }
        return s;
      };
      const from = expand(set1);
      const to = expand(set2);
      const map: Record<string, string> = {};
      if (deleteMode) {
        // tr -d 'set': delete every char in set1
        for (const ch of from) map[ch] = "";
      } else {
        for (let i = 0; i < from.length; i++) map[from[i]] = to[i] ?? to[to.length - 1] ?? "";
      }
      const result = content.replace(/[\s\S]/g, (ch) => map[ch] ?? ch);
      return { ok: true, output: result };
    }
    case "nl": {
      const file = rest.find((t) => !t.startsWith("-"));
      const { content } = resolveInput(file);
      if (content === null) return { ok: false, output: "nl: no input" };
      const lines = content.split("\n");
      return { ok: true, output: lines.map((l, i) => `${String(i + 1).padStart(6)}  ${l}`).join("\n") };
    }
    case "file": {
      const file = rest.find((t) => !t.startsWith("-"));
      if (!file) return { ok: false, output: "file: missing file" };
      const stat = vfs.statSync(file);
      if (!stat) return { ok: false, output: `file: ${file}: not found` };
      if (stat.type === "dir") return { ok: true, output: `${file}: directory` };
      const content = stat.content ?? "";
      const ext = file.split(".").pop()?.toLowerCase() ?? "";
      const typeMap: Record<string, string> = {
        ts: "TypeScript source", tsx: "TypeScript JSX source", js: "JavaScript source", jsx: "JavaScript JSX source",
        py: "Python source", go: "Go source", rs: "Rust source", json: "JSON data", md: "Markdown document",
        html: "HTML document", css: "CSS source", yaml: "YAML data", sql: "SQL source", sh: "shell script",
      };
      const type = typeMap[ext] ?? "ASCII text";
      return { ok: true, output: `${file}: ${type} (${content.length} bytes, ${content.split("\n").length} lines)` };
    }
    case "stat": {
      const file = rest.find((t) => !t.startsWith("-"));
      if (!file) return { ok: false, output: "stat: missing file" };
      const node = vfs.statSync(file);
      if (!node) return { ok: false, output: `stat: ${file}: not found` };
      return {
        ok: true,
        output: `  File: ${file}\n  Type: ${node.type}\n  Size: ${node.type === "file" ? (node.content ?? "").length : 0} bytes\n  Modified: ${new Date(node.updatedAt).toISOString()}\n  Created: ${new Date(node.createdAt).toISOString()}`,
      };
    }
    case "diff": {
      const unified = rest.includes("-u");
      const files = rest.filter((t) => !t.startsWith("-"));
      if (files.length < 2) return { ok: false, output: "diff: needs two files" };
      const a = vfs.readFileSync(files[0]);
      const b = vfs.readFileSync(files[1]);
      if (a === null) return { ok: false, output: `diff: ${files[0]}: not found` };
      if (b === null) return { ok: false, output: `diff: ${files[1]}: not found` };

      const aLines = a.split("\n");
      const bLines = b.split("\n");

      if (!unified) {
        // Original simple line-by-line comparison
        const out: string[] = [];
        const max = Math.max(aLines.length, bLines.length);
        for (let i = 0; i < max; i++) {
          if (aLines[i] !== bLines[i]) {
            if (i < aLines.length) out.push(`< ${aLines[i]}`);
            if (i < bLines.length) out.push(`> ${bLines[i]}`);
          }
        }
        return { ok: true, output: out.length === 0 ? "Files are identical" : out.join("\n") };
      }

      // --- Unified diff ---
      const CTX = 3; // context lines per hunk
      const MIN_SEP = CTX * 2 + 1; // min equal lines to split hunks
      const out: string[] = [`--- ${files[0]}`, `+++ ${files[1]}`];
      const maxLen = Math.max(aLines.length, bLines.length);
      let i = 0;

      while (i < maxLen) {
        // Skip equal lines
        while (i < maxLen && aLines[i] === bLines[i]) i++;
        if (i >= maxLen) break;

        // Start of a change region
        const oldStart = Math.max(0, i - CTX);
        const newStart = Math.max(0, i - CTX);
        const hunk: string[] = [];

        // Context lines before
        for (let k = oldStart; k < i; k++) hunk.push(" " + aLines[k]);

        let eqRun = 0;
        while (i < maxLen && eqRun <= CTX) {
          if (aLines[i] !== bLines[i]) {
            eqRun = 0;
            if (i < aLines.length) hunk.push("-" + aLines[i]);
            if (i < bLines.length) hunk.push("+" + bLines[i]);
            i++;
          } else {
            eqRun++;
            if (eqRun <= CTX) {
              hunk.push(" " + aLines[i]);
              i++;
            }
          }
        }

        // If we stopped because of enough context (not end), back up
        if (eqRun > CTX) i -= eqRun - CTX;

        // Pop trailing context from hunk and compute counts
        while (hunk.length > 0 && hunk[hunk.length - 1][0] === " ") {
          // Keep the CTX context lines, trim the rest
          const ctxLines: string[] = [];
          for (let k = hunk.length - 1; k >= 0 && hunk[k][0] === " "; k--) {
            ctxLines.unshift(hunk[k]);
          }
          if (ctxLines.length > CTX) {
            hunk.splice(hunk.length - (ctxLines.length - CTX));
          }
          break;
        }

        const oldCount = hunk.filter((l) => l[0] !== "+").length;
        const newCount = hunk.filter((l) => l[0] !== "-").length;
        out.push(`@@ -${oldStart + 1},${oldCount} +${newStart + 1},${newCount} @@`);
        out.push(...hunk);
      }

      return { ok: true, output: out.length === 2 ? "Files are identical" : out.join("\n") };
    }
    case "tee": {
      const file = rest.find((t) => !t.startsWith("-"));
      if (!file) return { ok: false, output: "tee: missing file" };
      // Real tee writes its stdin to the file AND echoes it to stdout. When
      // piped (e.g. `echo hi | tee out`), stdin carries the text; without a
      // pipe, fall back to the trailing args as the text.
      if (stdin !== undefined) {
        vfs.writeFileSync(file, stdin);
        return { ok: true, output: stdin, mutated: true };
      }
      const text = rest.slice(rest.indexOf(file) + 1).join(" ");
      vfs.writeFileSync(file, text + "\n");
      return { ok: true, output: text, mutated: true };
    }
    case "env":
    case "printenv":
      return { ok: true, output: "PWD=/\nHOME=/\nSHELL=/bin/opencode-web\nLANG=en_US.UTF-8" };
    case "hostname":
      return { ok: true, output: "opencode-web-sandbox" };
    case "whoami":
    case "id":
      return { ok: true, output: "developer" };
    case "uname":
      if (rest.includes("-a")) return { ok: true, output: "OpenCode-Web sandbox 1.0.0 browser-only x86_64 GNU/Web" };
      return { ok: true, output: "OpenCode-Web" };
    case "date":
      if (rest.includes("-u")) return { ok: true, output: new Date().toUTCString() };
      return { ok: true, output: new Date().toString() };
    case "uptime":
      return { ok: true, output: "up (browser sandbox), load average: 0.00, 0.00, 0.00" };
    case "rev": {
      const file = rest.find((t) => !t.startsWith("-"));
      if (!file) return { ok: false, output: "rev: missing file" };
      const content = vfs.readFileSync(file);
      if (content === null) return { ok: false, output: `rev: ${file}: not found` };
      return { ok: true, output: content.split("\n").map((l) => l.split("").reverse().join("")).join("\n") };
    }
    case "fold": {
      const wIdx = rest.indexOf("-w");
      const width = wIdx >= 0 ? parseInt(rest[wIdx + 1], 10) : 80;
      const file = rest.find((t) => !t.startsWith("-") && !t.match(/^\d+$/));
      if (!file) return { ok: false, output: "fold: missing file" };
      const content = vfs.readFileSync(file);
      if (content === null) return { ok: false, output: `fold: ${file}: not found` };
      const lines = content.split("\n").flatMap((l) => {
        if (l.length <= width) return [l];
        const out: string[] = [];
        for (let i = 0; i < l.length; i += width) out.push(l.slice(i, i + width));
        return out;
      });
      return { ok: true, output: lines.join("\n") };
    }
    case "yes":
      return { ok: true, output: (rest[0] ?? "y").repeat(5).split("").map(() => rest[0] ?? "y").join("\n") };
    case "basename": {
      const p = rest.find((t) => !t.startsWith("-"));
      if (!p) return { ok: false, output: "basename: missing operand" };
      return { ok: true, output: p.split("/").pop() ?? p };
    }
    case "dirname": {
      const p = rest.find((t) => !t.startsWith("-"));
      if (!p) return { ok: false, output: "dirname: missing operand" };
      const idx = p.lastIndexOf("/");
      return { ok: true, output: idx < 0 ? "." : p.slice(0, idx) };
    }
    case "realpath":
    case "readlink": {
      const p = rest.find((t) => !t.startsWith("-"));
      if (!p) return { ok: false, output: `${program}: missing operand` };
      return { ok: true, output: "/" + p };
    }
    case "seq": {
      const nums = rest.filter((t) => /^-?\d+$/.test(t)).map((n) => parseInt(n, 10));
      let start = 1, step = 1, end = 1;
      if (nums.length === 1) { end = nums[0]; }
      else if (nums.length === 2) { start = nums[0]; end = nums[1]; }
      else if (nums.length === 3) { start = nums[0]; step = nums[1]; end = nums[2]; }
      const out: number[] = [];
      if (step > 0) for (let i = start; i <= end; i += step) out.push(i);
      else for (let i = start; i >= end; i += step) out.push(i);
      return { ok: true, output: out.join("\n") };
    }
    case "shuf":
    case "shuffle": {
      const file = rest.find((t) => !t.startsWith("-"));
      if (!file) return { ok: false, output: `${program}: missing file` };
      const content = vfs.readFileSync(file);
      if (content === null) return { ok: false, output: `${program}: ${file}: not found` };
      const lines = content.split("\n");
      for (let i = lines.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [lines[i], lines[j]] = [lines[j], lines[i]];
      }
      return { ok: true, output: lines.join("\n") };
    }
    case "head_dash":
    case "strings": {
      const minLen = 4;
      const file = rest.find((t) => !t.startsWith("-"));
      if (!file) return { ok: false, output: `${program}: missing file` };
      const content = vfs.readFileSync(file);
      if (content === null) return { ok: false, output: `${program}: ${file}: not found` };
      const matches = content.match(/[\x20-\x7E]{4,}/g);
      return { ok: true, output: matches ? matches.join("\n") : "" };
    }
    case "base64": {
      const decode = rest.includes("-d") || rest.includes("--decode");
      const file = rest.find((t) => !t.startsWith("-"));
      const { content } = resolveInput(file);
      if (content === null) return { ok: false, output: "base64: no input" };
      try {
        if (decode) {
          const clean = content.replace(/\s/g, "");
          const binary = atob(clean);
          const bytes = new Uint8Array(binary.length);
          for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
          const decoded = new TextDecoder("utf-8").decode(bytes);
          return { ok: true, output: decoded };
        } else {
          const bytes = new TextEncoder().encode(content);
          let binary = "";
          for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
          return { ok: true, output: btoa(binary) };
        }
      } catch {
        return { ok: false, output: `base64: invalid input` };
      }
    }
    case "awk": {
      // 重建原生 awk 的 argv：旗标置于 script 之前；降级完全收敛在 awkWasm.evaluate 内部。
      const awkArgs: string[] = [];
      const scriptArgs: string[] = [];
      let i = 0;
      while (i < rest.length) {
        const t = rest[i];
        if (t === "-F" && rest[i + 1] !== undefined) { awkArgs.push(`-F${rest[i + 1]}`); i += 2; continue; } // "-F" "," → "-F,"
        if (t.startsWith("-F") && t.length > 2)        { awkArgs.push(t); i += 1; continue; }                 // "-F," 附着（旧实现丢掉的写法）
        if (t === "-v" && rest[i + 1] !== undefined)   { awkArgs.push(t, rest[i + 1]); i += 2; continue; }     // "-v var=val"
        if (t.startsWith("-"))                         { awkArgs.push(t); i += 1; continue; }
        scriptArgs.push(t); i += 1;
      }

      if (scriptArgs.length === 0) return { ok: false, output: "awk: missing script" };
      const script = scriptArgs[0];
      const file = scriptArgs[1];
      const { content, source } = resolveInput(file);
      // 无输入：只有 BEGIN 块时传空 stdin（BEGIN 不需要输入），否则报错
      if (content === null) {
        if (script.includes("BEGIN")) return await awkWasm.evaluate({ script, args: awkArgs, stdin: "" });
        return { ok: false, output: "awk: no input" };
      }
      // 管道输入走 stdin 回调；文件参数写 MEMFS 同名文件（保 FILENAME/FNR）
      if (source === "stdin") return await awkWasm.evaluate({ script, args: awkArgs, stdin: content });
      return await awkWasm.evaluate({ script, args: awkArgs, files: { [file]: content } });
    }
    case "paste": {
      const sIdx = rest.indexOf("-s");
      const dIdx = rest.indexOf("-d");
      const serial = sIdx >= 0;
      const delim = dIdx >= 0 ? rest[dIdx + 1] : "\t";
      const files = rest.filter((t) => !t.startsWith("-") && t !== (dIdx >= 0 ? rest[dIdx + 1] : ""));
      if (serial) {
        const file = files[0];
        const { content } = resolveInput(file);
        if (content === null) return { ok: false, output: `paste: ${file ?? "(no input)"}: not found` };
        return { ok: true, output: content.split("\n").join(delim) };
      }
      if (files.length >= 2) {
        const contents = files.map((f) => vfs.readFileSync(f));
        const missing = contents.findIndex((c) => c === null);
        if (missing >= 0) return { ok: false, output: `paste: ${files[missing]}: not found` };
        const allLines = contents.map((c) => c!.split("\n"));
        const maxLines = Math.max(...allLines.map((l) => l.length));
        const out: string[] = [];
        for (let i = 0; i < maxLines; i++) {
          out.push(allLines.map((lines) => lines[i] ?? "").join(delim));
        }
        return { ok: true, output: out.join("\n") };
      }
      return { ok: false, output: "paste: missing operands" };
    }
    case "bc":
    case "expr": {
      if (program === "bc") {
        // --- Native bc via WebAssembly (with JS fallback) ---
        // Extract flags (-l for math lib) from tokens
        const flags = rest.filter(t => t.startsWith("-"));
        // Rest is the expression; if piped stdin, use that instead
        const args = rest.filter(t => !t.startsWith("-"));
        const calcExpr = (stdin ? args.join(" ") || stdin.trim() : args.join(" ")).trim();

        if (!calcExpr) return { ok: false, output: "bc: no expression provided" };

        // Try WebAssembly bc, fallback to legacy JS evaluator
        try {
          const result = await bcWasm.evaluate(calcExpr, {
            stdin: stdin ?? undefined,
            useMathLib: flags.includes("-l"),
          });
          return result;
        } catch (_e) {
          // Wasm evaluation threw — this shouldn't happen since bcWasm has
          // its own internal fallback, but just in case:
          return { ok: false, output: "bc: evaluation failed" };
        }
      }

      // --- expr command: simple integer expression evaluator ---
      const calcExpr = rest.join(" ").trim();
      if (!calcExpr) return { ok: false, output: "expr: missing expression" };

      try {
        // 安全解析器（无 eval）：只接受数字、+ - * / % ^、括号
        const result = evalArithmetic(calcExpr);
        return { ok: true, output: String(result) };
      } catch {
        return { ok: false, output: "expr: expression evaluation failed" };
      }
    }
    case "xargs": {
      if (stdin === undefined) return { ok: false, output: "xargs: needs stdin (pipe)" };
      let maxArgs = Infinity;
      let replaceStr = "";
      const xargsCmdTokens: string[] = [];
      let ri = 0;
      while (ri < rest.length) {
        const t = rest[ri];
        if (t === "-n" || t === "--max-args") {
          maxArgs = parseInt(rest[ri + 1], 10) || 1;
          ri += 2;
        } else if (t === "-I" || t === "--replace") {
          replaceStr = rest[ri + 1] || "{}";
          ri += 2;
        } else if (t === "-0" || t === "--null") {
          ri++;
        } else {
          xargsCmdTokens.push(t);
          ri++;
        }
      }
      if (xargsCmdTokens.length === 0) return { ok: false, output: "xargs: missing command" };
      const items = stdin.split(/\s+/).filter(Boolean);
      const results: string[] = [];
      if (replaceStr) {
        for (const item of items) {
          const args = xargsCmdTokens.map((t) => t.replace(replaceStr, item));
          const r = await runOneShellCommandFromTokens(args, undefined, readOnly);
          if (r.output) results.push(r.output);
        }
      } else {
        for (let bi = 0; bi < items.length; bi += maxArgs) {
          const batch = items.slice(bi, bi + maxArgs);
          const r = await runOneShellCommandFromTokens([...xargsCmdTokens, ...batch], undefined, readOnly);
          if (r.output) results.push(r.output);
        }
      }
      return { ok: true, output: results.join("\n") };
    }
    case "column": {
      const tIdx = rest.indexOf("-t");
      const sIdx = rest.indexOf("-s");
      const sep = sIdx >= 0 ? rest[sIdx + 1] : /\s+/;
      const file = rest.find((t) => !t.startsWith("-") && t !== (sIdx >= 0 ? rest[sIdx + 1] : ""));
      const { content } = resolveInput(file);
      if (content === null) return { ok: false, output: "column: no input" };
      if (tIdx < 0) return { ok: true, output: content };
      const lines = content.split("\n").map((l) => l.split(sep));
      const colCount = Math.max(...lines.map((l) => l.length));
      const widths: number[] = [];
      for (let c = 0; c < colCount; c++) {
        widths[c] = Math.max(...lines.map((l) => (l[c] ?? "").length));
      }
      const out = lines.map((l) =>
        l.map((cell, i) => (cell ?? "").padEnd(widths[i])).join("  "),
      );
      return { ok: true, output: out.join("\n") };
    }
    case "comm": {
      const files = rest.filter((t) => !t.startsWith("-"));
      if (files.length < 2) return { ok: false, output: "comm: needs 2 files" };
      const a = vfs.readFileSync(files[0]);
      const b = vfs.readFileSync(files[1]);
      if (a === null) return { ok: false, output: `comm: ${files[0]}: not found` };
      if (b === null) return { ok: false, output: `comm: ${files[1]}: not found` };
      const aSet = new Set(a.split("\n"));
      const bSet = new Set(b.split("\n"));
      const onlyA = a.split("\n").filter((l) => !bSet.has(l));
      const onlyB = b.split("\n").filter((l) => !aSet.has(l));
      const both = a.split("\n").filter((l) => bSet.has(l));
      const out: string[] = [];
      for (const l of onlyA) out.push(`${l}`);
      for (const l of onlyB) out.push(`\t${l}`);
      for (const l of both) out.push(`\t\t${l}`);
      return { ok: true, output: out.join("\n") };
    }
    case "join": {
      const files = rest.filter((t) => !t.startsWith("-"));
      if (files.length < 2) return { ok: false, output: "join: needs 2 files" };
      const a = vfs.readFileSync(files[0]);
      const b = vfs.readFileSync(files[1]);
      if (a === null) return { ok: false, output: `join: ${files[0]}: not found` };
      if (b === null) return { ok: false, output: `join: ${files[1]}: not found` };
      const aLines = a.split("\n").filter(Boolean);
      const bLines = b.split("\n").filter(Boolean);
      const joinField = rest.indexOf("-j") >= 0 ? parseInt(rest[rest.indexOf("-j") + 1], 10) - 1 : 0;
      const aMap = new Map<string, string[]>();
      for (const line of aLines) {
        const fields = line.split(/\s+/);
        const key = fields[joinField] ?? fields[0];
        if (!aMap.has(key)) aMap.set(key, []);
        aMap.get(key)!.push(line);
      }
      const out: string[] = [];
      for (const line of bLines) {
        const bFields = line.split(/\s+/);
        const key = bFields[joinField] ?? bFields[0];
        const aLines = aMap.get(key);
        if (aLines) {
          for (const al of aLines) out.push(`${al} ${line}`);
        }
      }
      return { ok: true, output: out.join("\n") };
    }
    case "which":
    case "whereis": {
      const cmd = rest.find((t) => !t.startsWith("-"));
      if (!cmd) return { ok: false, output: `${program}: missing command` };
      const knownCmds = ["ls", "cat", "head", "tail", "wc", "mkdir", "rm", "rmdir", "touch", "echo", "printf", "cp", "mv", "find", "grep", "sed", "sort", "uniq", "cut", "tr", "awk", "xargs", "pwd", "cd", "tree", "nl", "paste", "bc", "expr", "file", "stat", "diff", "tee", "env", "hostname", "whoami", "id", "uname", "date", "uptime", "rev", "fold", "yes", "basename", "dirname", "realpath", "readlink", "seq", "shuf", "strings", "base64", "column", "comm", "join", "which", "whereis", "true", "false", "test"];
      return { ok: true, output: knownCmds.includes(cmd) ? `/bin/${cmd}` : "" };
    }
    case "noh":
    case "true":
      return { ok: true, output: "" };
    case "false":
      return { ok: false, output: "" };
    case "test": {
      const fFlag = rest.indexOf("-f");
      const dFlag = rest.indexOf("-d");
      const sFlag = rest.indexOf("-s");
      const eFlag = rest.indexOf("-e");
      const notFlag = rest.indexOf("!");
      const isNot = notFlag >= 0;
      if (fFlag >= 0) {
        const path = rest[fFlag + 1];
        const stat = vfs.readFileSync(path) !== null;
        return { ok: isNot ? !stat : stat, output: "" };
      }
      if (dFlag >= 0) {
        const path = rest[dFlag + 1];
        const stat = vfs.statSync(path);
        const ok = stat !== null && stat.type === "dir";
        return { ok: isNot ? !ok : ok, output: "" };
      }
      if (sFlag >= 0 || eFlag >= 0) {
        const path = rest[(sFlag >= 0 ? sFlag : eFlag) + 1];
        const stat = vfs.readFileSync(path) !== null;
        return { ok: isNot ? !stat : stat, output: "" };
      }
      if (rest.length === 1 && rest[0] === "!") return { ok: false, output: "" };
      return { ok: true, output: "" };
    }
    case "[": {
      return { ok: true, output: "" };
    }
    default: {
      const known = ["ls", "cat", "head", "tail", "wc", "mkdir", "rm", "touch", "echo", "printf", "cp", "mv", "find", "grep", "sed", "sort", "uniq", "cut", "tr", "awk", "xargs", "pwd", "cd", "clear", "tree", "nl", "paste", "bc", "expr", "file", "stat", "diff", "tee", "env", "hostname", "whoami", "id", "uname", "date", "uptime", "rev", "fold", "yes", "basename", "dirname", "realpath", "readlink", "seq", "shuf", "shuffle", "head_dash", "strings", "base64", "column", "comm", "join", "which", "whereis", "noh", "true", "false", "test"];
      return {
        ok: false,
        output: `bash: ${program}: command not supported in browser sandbox. Available: ${known.join(", ")}. Supports | > >> < 2>/dev/null 2>&1`,
      };
    }
  }
}

export { toolBash };

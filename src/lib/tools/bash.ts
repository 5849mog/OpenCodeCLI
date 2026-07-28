import { vfs, grepSync } from "../vfs";
import type { ToolResult } from "./types";
import { runAwk, splitAwkActions } from "./awk";

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

async function toolBash(args: Record<string, unknown>): Promise<ToolResult> {
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
    const out = runPipeline(seg.cmd);
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

function runPipeline(cmdLine: string): {
  ok: boolean;
  output: string;
  mutated?: boolean;
} {
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
    const result = runOneShellCommandFromTokens(stage.cmdTokens, stageStdin);
    if (result.mutated) mutated = true;
    if (!result.ok) {
      return { ok: false, output: result.output, mutated };
    }
    lastOutput = result.output;
    if (stage.outputRedirect) {
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
      while (i < cmd.length && !/\s/.test(cmd[i]) && cmd[i] !== "|" && cmd[i] !== ">" && cmd[i] !== "<") {
        token += cmd[i];
        i++;
      }
    }
    tokens.push(token);
  }
  return tokens;
}

function runOneShellCommand(cmd: string, stdin?: string): {
  ok: boolean;
  output: string;
  mutated?: boolean;
} {
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
      while (i < cmd.length && !/\s/.test(cmd[i])) {
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

function runOneShellCommandFromTokens(tokens: string[], stdin?: string): {
  ok: boolean;
  output: string;
  mutated?: boolean;
} {
  if (tokens.length === 0) return { ok: false, output: "Empty command" };

  const expandedTokens: string[] = [tokens[0]];
  const cmdName = tokens[0]?.toLowerCase();
  const selfPatternCmds = ["find", "grep", "sed"];
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
      const fileArg = rest.find((t) => !t.startsWith("-"));
      const { content } = resolveInput(fileArg);
      if (content === null) return { ok: false, output: `cat: ${fileArg ?? "(no input)"}: not found` };
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
      const namePattern = nameIdx >= 0 ? rest[nameIdx + 1] : null;
      const execIdx = rest.indexOf("-exec");
      const execTokens = execIdx >= 0 ? rest.slice(execIdx + 1) : [];
      let execCmd: string[] = [];
      if (execIdx >= 0) {
        for (const t of execTokens) {
          if (/\\+;/.test(t) || t === ";") break;
          execCmd.push(t);
        }
      }
      let files = vfs.listAllFilesSync(root);
      const allNodes = vfs.allSync().filter((n) => {
        if (root && !n.path.startsWith(root + "/") && n.path !== root) return false;
        return true;
      });
      if (typeFilter === "d") {
        const dirs = allNodes.filter((n) => n.type === "dir").map((n) => n);
        return {
          ok: true,
          output: dirs.map((d) => "./" + d.path + "/").join("\n") || "(none)",
        };
      }
      if (namePattern) {
        const re = new RegExp(namePattern.replace(/\*/g, ".*").replace(/\?/g, "."));
        files = files.filter((f) => re.test(f.path.split("/").pop() ?? f.path));
      }
      if (execCmd.length > 0) {
        const results: string[] = [];
        for (const f of files) {
          const fullPath = "./" + f.path;
          const cmdTokens = execCmd.map((t) => (t === "{}" ? fullPath : t));
          const r = runOneShellCommandFromTokens(cmdTokens);
          if (r.output) results.push(r.output);
        }
        return { ok: true, output: results.join("\n") || "(command completed with no output)" };
      }
      return {
        ok: true,
        output: files.map((f) => "./" + f.path).join("\n") || "(none)",
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
            if (countOnly) return { ok: true, output: String(matches.length) };
            if (filesOnly) return { ok: true, output: matches.map((m) => m.path).filter((p, i, a) => a.indexOf(p) === i).join("\n") };
            return { ok: true, output: matches.map((m) => `${m.path}:${m.line}: ${m.text}`).join("\n") };
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
      if (countOnly) return { ok: true, output: String(matches.length) };
      if (filesOnly) return { ok: true, output: matches.map((m) => m.path).filter((p, i, a) => a.indexOf(p) === i).join("\n") };
      return {
        ok: true,
        output: matches.map((m) => `${m.path}:${m.line}: ${m.text}`).join("\n"),
      };
    }
    case "sed": {
      const inplace = rest.includes("-i");
      const scriptIdx = rest.findIndex((t) => !t.startsWith("-"));
      if (scriptIdx < 0) return { ok: false, output: "sed: missing script" };
      const script = rest[scriptIdx];
      const file = rest.slice(scriptIdx + 1).find((t) => !t.startsWith("-"));
      const { content } = resolveInput(file);
      if (content === null) return { ok: false, output: "sed: no input" };

      /** Apply a substitution to specific lines of a text. */
      const sedSubstOnLines = function (
        text: string, pattern: string, replacement: string, flags: string,
        lineFilter: (line: string, idx: number) => boolean,
      ): string {
        const re = new RegExp(pattern, flags.includes("g") ? flags : flags + "g");
        const lines = text.split("\n");
        for (let i = 0; i < lines.length; i++) {
          if (lineFilter(lines[i], i)) lines[i] = lines[i].replace(re, replacement);
        }
        return lines.join("\n");
      }

      const commands = splitAwkActions(script);
      let result = content;

      for (const cmd of commands) {
        // --- Addressed s/// ---
        // Line range: N,Ms/old/new/g
        let m = cmd.match(/^(\d+)\s*,\s*(\d+)s(.)([\s\S]+?)\3([\s\S]*?)\3([gim]*)$/);
        if (m) {
          const s = parseInt(m[1], 10), e = parseInt(m[2], 10);
          try {
            result = sedSubstOnLines(result, m[4], m[5], m[6], (_, i) => i + 1 >= s && i + 1 <= e);
          } catch {
            return { ok: false, output: `sed: invalid regex: ${m[4]}` };
          }
          continue;
        }
        // Single line: Ns/old/new/g
        m = cmd.match(/^(\d+)s(.)([\s\S]+?)\2([\s\S]*?)\2([gim]*)$/);
        if (m) {
          const n = parseInt(m[1], 10);
          try {
            result = sedSubstOnLines(result, m[3], m[4], m[5], (_, i) => i + 1 === n);
          } catch {
            return { ok: false, output: `sed: invalid regex: ${m[3]}` };
          }
          continue;
        }
        // Last line: $s/old/new/g
        m = cmd.match(/^\$s(.)([\s\S]+?)\1([\s\S]*?)\1([gim]*)$/);
        if (m) {
          try {
            const re = new RegExp(m[2], m[4].includes("g") ? m[4] : m[4] + "g");
            const lines = result.split("\n");
            if (lines.length > 0) lines[lines.length - 1] = lines[lines.length - 1].replace(re, m[3]);
            result = lines.join("\n");
          } catch {
            return { ok: false, output: `sed: invalid regex: ${m[2]}` };
          }
          continue;
        }
        // Pattern match: /pat/s/old/new/g
        m = cmd.match(/^\/(.+?)\/s(.)([\s\S]+?)\2([\s\S]*?)\2([gim]*)$/);
        if (m) {
          try {
            const lineRe = new RegExp(m[1]);
            result = sedSubstOnLines(result, m[3], m[4], m[5], (l) => lineRe.test(l));
          } catch {
            return { ok: false, output: `sed: invalid regex: ${m[3]}` };
          }
          continue;
        }

        // --- No-address s/// (existing) ---
        const subMatch = cmd.match(/^s(.)([\s\S]+?)\1([\s\S]*?)\1([gim]*)$/);
        if (subMatch) {
          const [, , pattern, replacement, flags] = subMatch;
          try {
            const re = new RegExp(pattern, flags.includes("g") ? flags : flags + "g");
            result = result.replace(re, replacement);
          } catch {
            return { ok: false, output: `sed: invalid regex: ${pattern}` };
          }
          continue;
        }

        // --- d (delete) — already supports N, N,M, /pattern/ ---
        const delMatch = cmd.match(/^(.+?)d$/);
        if (delMatch) {
          const addr = delMatch[1];
          const lines = result.split("\n");
          if (addr.match(/^\d+$/)) {
            const n = parseInt(addr, 10);
            if (n >= 1 && n <= lines.length) lines.splice(n - 1, 1);
            result = lines.join("\n");
          } else if (addr.match(/^\d+,\d+$/)) {
            const [start, end] = addr.split(",").map((n) => parseInt(n, 10));
            lines.splice(start - 1, end - start + 1);
            result = lines.join("\n");
          } else if (addr.startsWith("/") && addr.endsWith("/")) {
            const patternStr = addr.slice(1, -1);
            try {
              const re = new RegExp(patternStr);
              result = lines.filter((l) => !re.test(l)).join("\n");
            } catch {
              return { ok: false, output: `sed: invalid pattern: ${patternStr}` };
            }
          } else {
            return { ok: false, output: `sed: unsupported delete address: ${addr}` };
          }
          continue;
        }

        // --- p (print) — supports N, N,M, /pattern/ ---
        const printMatch = cmd.match(/^(.+?)p$/);
        if (printMatch && !cmd.startsWith("s")) {
          const addr = printMatch[1];
          const lines = result.split("\n");
          if (addr.match(/^\d+$/)) {
            const n = parseInt(addr, 10);
            if (n >= 1 && n <= lines.length) result = lines[n - 1];
            else result = "";
          } else if (addr.match(/^\d+,\d+$/)) {
            const [start, end] = addr.split(",").map((n) => parseInt(n, 10));
            result = lines.slice(start - 1, end).join("\n");
          } else if (addr.startsWith("/") && addr.endsWith("/")) {
            try {
              const re = new RegExp(addr.slice(1, -1));
              result = lines.filter((l) => re.test(l)).join("\n");
            } catch {
              return { ok: false, output: `sed: invalid pattern` };
            }
          }
          continue;
        }

        // --- q (quit) ---
        if (cmd === "q") {
          const lines = result.split("\n");
          result = lines.length > 0 ? lines[0] : "";
          break;
        }
        m = cmd.match(/^(\d+)q$/);
        if (m) {
          const n = parseInt(m[1], 10);
          const lines = result.split("\n");
          result = lines.slice(0, n).join("\n");
          break;
        }
        m = cmd.match(/^\/(.+?)\/q$/);
        if (m) {
          try {
            const re = new RegExp(m[1]);
            const lines = result.split("\n");
            const idx = lines.findIndex((l) => re.test(l));
            result = idx >= 0 ? lines.slice(0, idx + 1).join("\n") : result;
          } catch {
            return { ok: false, output: `sed: invalid pattern: ${m[1]}` };
          }
          break;
        }

        // --- a (append) ---
        m = cmd.match(/^(?:(\d+)|(?:\/(.+?)\/))?a\s+(.+)$/);
        if (m) {
          const text = m[3].replace(/^["']|["']$/g, "");
          const lines = result.split("\n");
          if (m[1]) {
            const n = parseInt(m[1], 10);
            if (n >= 1 && n <= lines.length) lines.splice(n, 0, text);
          } else if (m[2] !== undefined) {
            try {
              const re = new RegExp(m[2]);
              for (let i = lines.length - 1; i >= 0; i--) {
                if (re.test(lines[i])) lines.splice(i + 1, 0, text);
              }
            } catch {
              return { ok: false, output: `sed: invalid pattern: ${m[2]}` };
            }
          } else {
            lines.splice(lines.length, 0, text);
          }
          result = lines.join("\n");
          continue;
        }

        // --- i (insert) ---
        m = cmd.match(/^(?:(\d+)|(?:\/(.+?)\/))?i\s+(.+)$/);
        if (m) {
          const text = m[3].replace(/^["']|["']$/g, "");
          const lines = result.split("\n");
          if (m[1]) {
            const n = parseInt(m[1], 10);
            if (n >= 1 && n <= lines.length) lines.splice(n - 1, 0, text);
          } else if (m[2] !== undefined) {
            try {
              const re = new RegExp(m[2]);
              for (let i = lines.length - 1; i >= 0; i--) {
                if (re.test(lines[i])) lines.splice(i, 0, text);
              }
            } catch {
              return { ok: false, output: `sed: invalid pattern: ${m[2]}` };
            }
          } else {
            lines.splice(0, 0, text);
          }
          result = lines.join("\n");
          continue;
        }

        // --- c (change) ---
        m = cmd.match(/^(?:(\d+)|(?:\/(.+?)\/))?c\s+(.+)$/);
        if (m) {
          const text = m[3].replace(/^["']|["']$/g, "");
          const lines = result.split("\n");
          if (m[1]) {
            const n = parseInt(m[1], 10);
            if (n >= 1 && n <= lines.length) { lines[n - 1] = text; }
          } else if (m[2] !== undefined) {
            try {
              const re = new RegExp(m[2]);
              for (let i = 0; i < lines.length; i++) {
                if (re.test(lines[i])) lines[i] = text;
              }
            } catch {
              return { ok: false, output: `sed: invalid pattern: ${m[2]}` };
            }
          } else {
            result = text;
          }
          result = lines.join("\n");
          continue;
        }

        return { ok: false, output: `sed: unsupported command: ${cmd}. Supported: s/old/new/g, [addr]s/old/new/g, [addr]q, [addr]a text, [addr]i text, [addr]c text, Nd, N,Md, /pattern/d, /pattern/p` };
      }

      if (inplace && file) {
        vfs.writeFileSync(file, result);
        return { ok: true, output: "", mutated: true };
      }
      return { ok: true, output: result };
    }
    case "sort": {
      const file = rest.find((t) => !t.startsWith("-"));
      const { content } = resolveInput(file);
      if (content === null) return { ok: false, output: "sort: no input" };
      const lines = content === "" ? [] : content.split("\n");
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
      const file = rest.find((t) => !t.startsWith("-") && !t.includes(",") && !t.match(/^\d/) && t !== "-d" && t !== "-f" && t !== "-c");
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
      const sets = rest.filter((t) => !t.startsWith("-"));
      if (sets.length < 2) return { ok: false, output: "tr: needs SET1 and SET2" };
      const set1 = sets[0], set2 = sets[1];
      const file = sets[2];
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
      for (let i = 0; i < from.length; i++) map[from[i]] = to[i] ?? to[to.length - 1] ?? "";
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
      let fieldSep: RegExp | string = /\s+/;
      const fIdx = rest.indexOf("-F");
      if (fIdx >= 0 && rest[fIdx + 1]) fieldSep = rest[fIdx + 1];

      const scriptArgs: string[] = [];
      let skipNext = false;
      for (let i = 0; i < rest.length; i++) {
        if (skipNext) { skipNext = false; continue; }
        if (rest[i] === "-F") { skipNext = true; continue; }
        if (rest[i].startsWith("-")) continue;
        scriptArgs.push(rest[i]);
      }
      if (scriptArgs.length === 0) return { ok: false, output: "awk: missing script" };
      const script = scriptArgs[0];
      const file = scriptArgs[1];
      const { content } = resolveInput(file);
      // If no input but script has BEGIN block, pass empty string (BEGIN doesn't need input)
      if (content === null) {
        if (script.includes("BEGIN")) return { ok: true, output: runAwk(script, "", fieldSep) };
        return { ok: false, output: "awk: no input" };
      }

      return { ok: true, output: runAwk(script, content, fieldSep) };
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
      let calcExpr: string;
      let calcScale = 0;
      if (program === "bc" && stdin) {
        // bc with piped stdin: filter out flags like -l so we read from stdin
        const args = rest.filter(t => !t.startsWith("-"));
        calcExpr = args.join(" ").trim() || stdin.trim();
      } else {
        calcExpr = rest.join(" ").trim();
      }
      if (!calcExpr) return { ok: false, output: `${program}: missing expression` };

      if (program === "bc") {
        // Extract scale=N
        const sm = calcExpr.match(/\bscale\s*=\s*(\d+)\b/);
        if (sm) { calcScale = parseInt(sm[1], 10); calcExpr = calcExpr.replace(/\bscale\s*=\s*\d+\s*[;,]\s*/g, ""); }

        // Convert bc syntax → JavaScript equivalents:
        //   ^ (exponentiation) → **
        //   sqrt(x) → Math.sqrt(x)
        //   s(x), c(x), a(x), l(x), e(x) → Math.sin, Math.cos, etc.
        //   pi → Math.PI
        //   length(x) → number of integer digits
        //   ibase/obase → stripped (not supported)
        calcExpr = calcExpr
          .replace(/\^/g, "**")
          .replace(/\bsqrt\s*\(/g, "Math.sqrt(")
          .replace(/(?<!\w)s\s*\(/g, "Math.sin(")
          .replace(/(?<!\w)c\s*\(/g, "Math.cos(")
          .replace(/(?<!\w)a\s*\(/g, "Math.atan(")
          .replace(/(?<!\w)l\s*\(/g, "Math.log(")
          .replace(/(?<!\w)e\s*\(/g, "Math.exp(")
          .replace(/\bpi\b/gi, "Math.PI")
          .replace(/\b(length|ibase|obase)\s*[=\(\s]/gi, "");
      }

      // Sanitize: allow numbers, operators, parens, decimals, Math.xxx
      const sanitized = calcExpr.replace(/[^0-9+\-*/().%\sa-zA-Z.]/g, "");
      if (!sanitized.trim()) return { ok: false, output: `${program}: missing expression` };
      try {
        const result = Function(`"use strict"; return (${sanitized})`)();
        if (program === "bc" && calcScale > 0) {
          return { ok: true, output: (result as number).toFixed(calcScale) };
        }
        return { ok: true, output: String(result) };
      } catch {
        return { ok: false, output: `${program}: expression evaluation failed` };
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
          const r = runOneShellCommandFromTokens(args);
          if (r.output) results.push(r.output);
        }
      } else {
        for (let bi = 0; bi < items.length; bi += maxArgs) {
          const batch = items.slice(bi, bi + maxArgs);
          const r = runOneShellCommandFromTokens([...xargsCmdTokens, ...batch]);
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
      const knownCmds = ["ls", "cat", "head", "tail", "wc", "mkdir", "rm", "touch", "echo", "cp", "mv", "find", "grep", "sed", "sort", "uniq", "cut", "tr", "awk", "xargs", "pwd", "cd", "tree", "nl", "paste", "bc", "expr", "file", "stat", "diff", "tee", "env", "hostname", "whoami", "id", "uname", "date", "uptime", "rev", "fold", "yes", "basename", "dirname", "realpath", "readlink", "seq", "shuf", "strings", "base64", "column", "comm", "join", "which", "whereis", "true", "false", "test"];
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
      const known = ["ls", "cat", "head", "tail", "wc", "mkdir", "rm", "touch", "echo", "cp", "mv", "find", "grep", "sed", "sort", "uniq", "cut", "tr", "awk", "xargs", "pwd", "cd", "clear", "tree", "nl", "paste", "bc", "expr", "file", "stat", "diff", "tee", "env", "hostname", "whoami", "id", "uname", "date", "uptime", "rev", "fold", "yes", "basename", "dirname", "realpath", "readlink", "seq", "shuf", "shuffle", "head_dash", "strings", "base64", "column", "comm", "join", "which", "whereis", "noh", "true", "false", "test"];
      return {
        ok: false,
        output: `bash: ${program}: command not supported in browser sandbox. Available: ${known.join(", ")}. Supports | > >> < 2>/dev/null 2>&1`,
      };
    }
  }
}

export { toolBash };

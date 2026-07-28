import { vfs, grepSync } from "../vfs";
import type { ToolResult } from "./types";

async function toolSearchFiles(
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const pattern = String(args.pattern ?? "");
  const path = String(args.path ?? "");
  const regex = Boolean(args.regex);
  const caseSensitive = Boolean(args.case_sensitive);
  const afterLines = args.after !== undefined ? parseInt(String(args.after), 10) : (args.context !== undefined ? parseInt(String(args.context), 10) : 0);
  const beforeLines = args.before !== undefined ? parseInt(String(args.before), 10) : (args.context !== undefined ? parseInt(String(args.context), 10) : 0);
  const matches = grepSync(pattern, { path, regex, caseSensitive, max: 100 });
  if (matches.length === 0) {
    return {
      ok: true,
      output: "No matches found.",
      tool: "search_files",
      args,
    };
  }
  if (afterLines > 0 || beforeLines > 0) {
    const byFile = new Map<string, typeof matches>();
    for (const m of matches) {
      if (!byFile.has(m.path)) byFile.set(m.path, []);
      byFile.get(m.path)!.push(m);
    }
    const out: string[] = [];
    for (const [filePath, fileMatches] of byFile) {
      const content = vfs.readFileSync(filePath);
      if (content === null) continue;
      const allLines = content.split("\n");
      out.push(`── ${filePath} ──`);
      for (const m of fileMatches) {
        const start = Math.max(0, m.line - 1 - beforeLines);
        const end = Math.min(allLines.length, m.line + afterLines);
        for (let i = start; i < end; i++) {
          const lineNum = i + 1;
          const marker = lineNum === m.line ? ">" : " ";
          out.push(`${filePath}:${lineNum}${marker} ${allLines[i]}`);
        }
        out.push("");
      }
    }
    return {
      ok: true,
      output: `Found ${matches.length} match(es) with ${beforeLines} before / ${afterLines} after context:\n${out.join("\n")}`,
      tool: "search_files",
      args,
    };
  }
  const lines = matches.map(
    (m) => `${m.path}:${m.line}:${m.column}: ${m.text}`,
  );
  return {
    ok: true,
    output: `Found ${matches.length} match(es):\n${lines.join("\n")}`,
    tool: "search_files",
    args,
  };
}

/** Convert a glob pattern to a RegExp. Supports * ** ? and {a,b} alternation. */
function globToRegex(pattern: string): RegExp {
  let re = "";
  let i = 0;
  while (i < pattern.length) {
    const c = pattern[i];
    if (c === "*") {
      if (pattern[i + 1] === "*") {
        i += 2;
        if (pattern[i] === "/") i++;
        re += ".*";
      } else {
        i++;
        re += "[^/]*";
      }
    } else if (c === "?") {
      re += "[^/]";
      i++;
    } else if (c === "{") {
      const end = pattern.indexOf("}", i);
      if (end < 0) {
        re += "\\{";
        i++;
      } else {
        const inner = pattern.slice(i + 1, end);
        re += "(" + inner.split(",").join("|") + ")";
        i = end + 1;
      }
    } else if ("\\^$.|+()[]".includes(c)) {
      re += "\\" + c;
      i++;
    } else {
      re += c;
      i++;
    }
  }
  return new RegExp("^" + re + "$");
}

async function toolGlob(args: Record<string, unknown>): Promise<ToolResult> {
  const pattern = String(args.pattern ?? "");
  const basePath = String(args.path ?? "");
  if (!pattern) {
    return { ok: false, output: "No pattern provided.", tool: "glob", args };
  }
  const regex = globToRegex(pattern);
  const files = vfs.listAllFilesSync(basePath);
  const matches = files
    .filter((f) => regex.test(f.path))
    .map((f) => f.path)
    .sort();
  if (matches.length === 0) {
    return {
      ok: true,
      output: `No files matched pattern: ${pattern}`,
      tool: "glob",
      args,
    };
  }
  return {
    ok: true,
    output: `${matches.length} file(s) matched ${pattern}:\n${matches.join("\n")}`,
    tool: "glob",
    args,
  };
}

async function toolSearchSymbols(
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const pattern = String(args.pattern ?? "");
  const path = String(args.path ?? "");
  const caseSensitive = Boolean(args.case_sensitive);
  if (!pattern) {
    return {
      ok: false,
      output: "No pattern provided.",
      tool: "search_symbols",
      args,
    };
  }
  let re: RegExp;
  try {
    re = new RegExp(pattern, caseSensitive ? "" : "i");
  } catch {
    return {
      ok: false,
      output: `Invalid regex: ${pattern}`,
      tool: "search_symbols",
      args,
    };
  }
  const defKeywords =
    /(function|class|interface|type|const|let|var|def|public|private|protected|static|async|export|enum|struct|impl|fn)\b/;
  const files = vfs.listAllFilesSync(path);
  const matches: Array<{ path: string; line: number; text: string }> = [];
  for (const file of files) {
    const content = file.content ?? "";
    const lines = content.split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (re.test(lines[i]) && defKeywords.test(lines[i])) {
        matches.push({ path: file.path, line: i + 1, text: lines[i].trim() });
        if (matches.length >= 100) break;
      }
    }
    if (matches.length >= 100) break;
  }
  if (matches.length === 0) {
    return {
      ok: true,
      output: `No symbol definitions matched: ${pattern}`,
      tool: "search_symbols",
      args,
    };
  }
  const lines = matches.map(
    (m) => `${m.path}:${m.line}: ${m.text}`,
  );
  return {
    ok: true,
    output: `Found ${matches.length} symbol definition(s):\n${lines.join("\n")}`,
    tool: "search_symbols",
    args,
  };
}

async function toolViewOutline(args: Record<string, unknown>): Promise<ToolResult> {
  const path = String(args.path ?? "");
  if (!path) {
    return { ok: false, output: "view_outline requires a 'path' argument.", tool: "view_outline", args };
  }
  const content = vfs.readFileSync(path);
  if (content === null) {
    return { ok: false, output: `File not found: ${path}`, tool: "view_outline", args };
  }
  const lines = content.split("\n");
  const symbols: Array<{ line: number; type: string; name: string }> = [];

  const patterns: Array<{ re: RegExp; type: string; nameGroup: number }> = [
    { re: /^\s*(?:export\s+)?(?:async\s+)?function\s+(\w+)/, type: "function", nameGroup: 1 },
    { re: /^\s*(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?\(?/, type: "const", nameGroup: 1 },
    { re: /^\s*(?:export\s+)?(?:abstract\s+)?class\s+(\w+)/, type: "class", nameGroup: 1 },
    { re: /^\s*(?:export\s+)?interface\s+(\w+)/, type: "interface", nameGroup: 1 },
    { re: /^\s*(?:export\s+)?type\s+(\w+)/, type: "type", nameGroup: 1 },
    { re: /^\s+(?:public|private|protected|static|async|get|set|\s)*(\w+)\s*\(/, type: "method", nameGroup: 1 },
    { re: /^\s*export\s+default\s+(?:async\s+)?function\s+(\w+)/, type: "function", nameGroup: 1 },
    { re: /^\s*(?:async\s+)?def\s+(\w+)/, type: "def", nameGroup: 1 },
    { re: /^\s*class\s+(\w+)/, type: "class", nameGroup: 1 },
    { re: /^\s*func\s+(?:\([^)]*\)\s+)?(\w+)/, type: "func", nameGroup: 1 },
    { re: /^\s*type\s+(\w+)\s+/, type: "type", nameGroup: 1 },
    { re: /^\s*(?:pub\s+)?fn\s+(\w+)/, type: "fn", nameGroup: 1 },
    { re: /^\s*(?:pub\s+)?struct\s+(\w+)/, type: "struct", nameGroup: 1 },
    { re: /^\s*(?:pub\s+)?enum\s+(\w+)/, type: "enum", nameGroup: 1 },
    { re: /^\s*impl\s+(\w+)/, type: "impl", nameGroup: 1 },
    { re: /^\s*(?:public|private|protected|static|\s)*(?:class|interface)\s+(\w+)/, type: "class", nameGroup: 1 },
  ];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*(\/\/|#|\/\*|\*|\/\*\*)/.test(line) || !line.trim()) continue;
    for (const { re, type, nameGroup } of patterns) {
      const m = line.match(re);
      if (m && m[nameGroup]) {
        const name = m[nameGroup];
        if (symbols.some((s) => s.line === i + 1)) continue;
        symbols.push({ line: i + 1, type, name });
        break;
      }
    }
  }

  if (symbols.length === 0) {
    return {
      ok: true,
      output: `No symbols found in ${path} (${lines.length} lines). The file may use a language not supported by the outline parser.`,
      tool: "view_outline",
      args,
    };
  }

  const output = symbols
    .map((s) => `${String(s.line).padStart(4)}  ${s.type.padEnd(10)} ${s.name}`)
    .join("\n");
  return {
    ok: true,
    output: `${path} (${symbols.length} symbols, ${lines.length} lines):\n${output}`,
    tool: "view_outline",
    args,
  };
}

export {
  toolSearchFiles,
  toolGlob,
  toolSearchSymbols,
  toolViewOutline,
};

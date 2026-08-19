import { vfs, basename, normalizePath } from "../vfs";
import { globToRegex } from "./glob";
import type { ToolResult } from "./types";

function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0;
  let count = 0;
  let idx = 0;
  while ((idx = haystack.indexOf(needle, idx)) !== -1) {
    count++;
    idx += needle.length;
  }
  return count;
}

async function toolReadFile(args: Record<string, unknown>): Promise<ToolResult> {
  const path = String(args.path ?? "");
  if (!path) {
    return {
      ok: false,
      output: "read_file requires a 'path' argument.",
      tool: "read_file",
      args,
    };
  }
  const offset = args.offset !== undefined ? parseInt(String(args.offset), 10) : undefined;
  const limit = args.limit !== undefined ? parseInt(String(args.limit), 10) : undefined;
  const lineNumbers = args.lineNumbers === true;
  const content = await vfs.readFile(path);
  if (content === null) {
    const stat = vfs.statSync(path);
    if (stat && stat.type === "dir") {
      return {
        ok: false,
        output: `Path is a directory, not a file: ${path}. Use list_files or list_dirs to inspect directories.`,
        tool: "read_file",
        args,
      };
    }
    const fileName = basename(path);
    const allFiles = vfs.listAllFilesSync();
    const candidates = allFiles
      .filter((n) => n.type === "file" && basename(n.path) === fileName)
      .map((n) => n.path)
      .slice(0, 10);
    let hint = "";
    if (candidates.length === 1) {
      hint = `\n\nDid you mean: "${candidates[0]}"?`;
    } else if (candidates.length > 1) {
      hint = `\n\nDid you mean one of?\n  ${candidates.join("\n  ")}`;
    } else {
      const rootChildren = vfs.listSync("");
      const rootDirs = rootChildren
        .filter((n) => n.type === "dir")
        .map((n) => `${n.path}/`);
      if (rootDirs.length > 0) {
        hint = `\n\nTop-level directories: ${rootDirs.join(", ")}\nTry prefixing the file path with the correct directory.`;
      }
    }
    return {
      ok: false,
      output: `File not found: ${path}${hint}`,
      tool: "read_file",
      args,
    };
  }
  const totalLines = content.split("\n").length;
  const totalChars = content.length;

  let output = content;
  const warned: string[] = [];

  if (totalLines > 500 || totalChars > 15_000) {
    const estTokens = Math.ceil(totalChars / 4);
    warned.push(`[File size: ${totalLines} lines, ${totalChars.toLocaleString()} chars, ~${estTokens.toLocaleString()} tokens. Consider using offset/limit, head/tail, grep, or view_outline if you only need part of this file.]`);
  }

  const effectiveLimit = limit ?? (totalLines > 1500 ? 1500 : undefined);
  if (offset !== undefined || effectiveLimit !== undefined) {
    const lines = content.split("\n");
    const start = offset !== undefined ? Math.max(0, offset - 1) : 0;
    const end = effectiveLimit !== undefined ? start + effectiveLimit : lines.length;
    const sliced = lines.slice(start, end);
    output = sliced.join("\n");
    if (end < lines.length) {
      warned.push(`Showing lines ${start + 1}-${Math.min(end, lines.length)} of ${lines.length}. Use offset=${end + 1} to read the next page.`);
    }
  }

  // lineNumbers=true prefixes every line with its 1-based number (e.g. " 42 | const x = 1").
  // This gives the model GROUND-TRUTH line numbers for reports — no guessing.
  if (lineNumbers) {
    const startLine = offset !== undefined ? Math.max(0, offset - 1) : 0;
    output = output
      .split("\n")
      .map((l, i) => `${String(startLine + i + 1).padStart(4)} | ${l}`)
      .join("\n");
  }

  const prefix = warned.length > 0 ? warned.join(" ") + "\n\n" : "";
  return {
    ok: true,
    output: prefix + output,
    tool: "read_file",
    args,
  };
}

async function toolWriteFile(args: Record<string, unknown>): Promise<ToolResult> {
  const path = String(args.path ?? "");
  if (!path) {
    return {
      ok: false,
      output: "write_file requires a 'path' argument.",
      tool: "write_file",
      args,
    };
  }
  const content = String(args.content ?? "");
  const existed = vfs.readFileSync(path);
  const before = existed ?? "";
  await vfs.writeFile(path, content);
  const verb = existed === null ? "Created" : "Overwrote";
  return {
    ok: true,
    output: `${verb} ${path} (${content.length} bytes, ${content.split("\n").length} lines)`,
    diff: { path, before, after: content },
    tool: "write_file",
    args,
    mutated: true,
  };
}

async function toolEditFile(args: Record<string, unknown>): Promise<ToolResult> {
  const path = String(args.path ?? "");
  if (!path) {
    return {
      ok: false,
      output: "edit_file requires a 'path' argument.",
      tool: "edit_file",
      args,
    };
  }
  const oldString = String(args.old_string ?? "");
  const newString = String(args.new_string ?? "");
  if (oldString === newString) {
    return {
      ok: false,
      output: "old_string and new_string are identical — nothing to change. If you want to replace, provide a different new_string.",
      tool: "edit_file",
      args,
    };
  }
  const replaceAll = Boolean(args.replace_all);
  const existing = vfs.readFileSync(path);
  if (existing === null) {
    return {
      ok: false,
      output: `File not found: ${path}. Use write_file to create it first.`,
      tool: "edit_file",
      args,
    };
  }
  try {
    const result = await vfs.editFile(path, oldString, newString, replaceAll);
    return {
      ok: true,
      output: `Edited ${path}: ${result.replacements} replacement(s)`,
      diff: { path, before: result.before, after: result.after },
      tool: "edit_file",
      args,
      mutated: true,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("not found") && !replaceAll) {
      const occurrences = countOccurrences(existing, oldString);
      return {
        ok: false,
        output: `Could not edit ${path}: ${msg}. (The exact string was not found. Check indentation, whitespace, and line endings. The file has ${existing.split("\n").length} lines.)`,
        tool: "edit_file",
        args,
      };
    }
    if (msg.includes("not unique")) {
      const occurrences = countOccurrences(existing, oldString);
      return {
        ok: false,
        output: `Could not edit ${path}: old_string appears ${occurrences} time(s). Include more surrounding context to make it unique, or set replace_all=true to replace all.`,
        tool: "edit_file",
        args,
      };
    }
    return {
      ok: false,
      output: `Could not edit ${path}: ${msg}`,
      tool: "edit_file",
      args,
    };
  }
}

async function toolDeleteFile(args: Record<string, unknown>): Promise<ToolResult> {
  const path = String(args.path ?? "");
  if (!path) {
    return {
      ok: false,
      output: "delete_file requires a 'path' argument.",
      tool: "delete_file",
      args,
    };
  }
  if (path === "/" || path === "" || path === ".") {
    return {
      ok: false,
      output: "Refusing to delete the workspace root. Use the 'Clear workspace' button in the UI instead.",
      tool: "delete_file",
      args,
    };
  }
  const stat = vfs.statSync(path);
  if (!stat) {
    return {
      ok: false,
      output: `Path not found: ${path} (nothing to delete).`,
      tool: "delete_file",
      args,
    };
  }
  const count = await vfs.delete(path);
  const what = stat.type === "dir" ? "directory" : "file";
  return {
    ok: true,
    output: `Deleted ${what} ${path} (${count} node${count !== 1 ? "s" : ""} removed)`,
    tool: "delete_file",
    args,
    mutated: true,
  };
}

async function toolListFiles(args: Record<string, unknown>): Promise<ToolResult> {
  const path = String(args.path ?? "");
  if (path) {
    const stat = vfs.statSync(path);
    if (!stat) {
      return {
        ok: false,
        output: `Path not found: ${path}`,
        tool: "list_files",
        args,
      };
    }
    if (stat.type === "file") {
      return {
        ok: false,
        output: `Not a directory: ${path} (it is a file). Pass an empty path or a directory path.`,
        tool: "list_files",
        args,
      };
    }
  }
  const children = await vfs.list(path);
  if (children.length === 0) {
    return {
      ok: true,
      output: path ? `(empty directory: ${path})` : `(empty workspace)`,
      tool: "list_files",
      args,
    };
  }
  const lines = children.map((c) => {
    const name = c.path.split("/").pop() ?? c.path;
    const type = c.type === "dir" ? "dir " : "file";
    const size = c.type === "file" ? ` (${(c.content ?? "").length}B)` : "";
    return `${type}  ${name}${size}`;
  });
  return {
    ok: true,
    output: `${children.length} item(s) in ${path || "/"}:\n${lines.join("\n")}`,
    tool: "list_files",
    args,
  };
}

async function toolListDirs(args: Record<string, unknown>): Promise<ToolResult> {
  const path = String(args.path ?? "");
  if (path) {
    const stat = vfs.statSync(path);
    if (!stat) {
      return {
        ok: false,
        output: `Path not found: ${path}`,
        tool: "list_dirs",
        args,
      };
    }
    if (stat.type === "file") {
      return {
        ok: false,
        output: `Not a directory: ${path}`,
        tool: "list_dirs",
        args,
      };
    }
  }
  const tree = vfs.treeSync(path);
  return {
    ok: true,
    output: tree || "(empty workspace)",
    tool: "list_dirs",
    args,
  };
}

async function toolCreateDir(args: Record<string, unknown>): Promise<ToolResult> {
  const path = String(args.path ?? "");
  if (!path) {
    return {
      ok: false,
      output: "create_dir requires a 'path' argument.",
      tool: "create_dir",
      args,
    };
  }
  const existing = vfs.statSync(path);
  if (existing) {
    return {
      ok: true,
      output: `Directory already exists: ${path}`,
      tool: "create_dir",
      args,
    };
  }
  await vfs.mkdir(path);
  return {
    ok: true,
    output: `Created directory ${path}`,
    tool: "create_dir",
    args,
    mutated: true,
  };
}

async function toolMoveFile(args: Record<string, unknown>): Promise<ToolResult> {
  const from = String(args.from ?? "");
  const to = String(args.to ?? "");
  if (!from || !to) {
    return {
      ok: false,
      output: "move_file requires 'from' and 'to' arguments.",
      tool: "move_file",
      args,
    };
  }
  if (from === to) {
    return {
      ok: false,
      output: "from and to are the same path — nothing to move.",
      tool: "move_file",
      args,
    };
  }
  const fromStat = vfs.statSync(from);
  if (!fromStat) {
    return {
      ok: false,
      output: `Source not found: ${from}`,
      tool: "move_file",
      args,
    };
  }
  const toStat = vfs.statSync(to);
  if (toStat) {
    return {
      ok: false,
      output: `Destination already exists: ${to}. delete_file it first if you want to overwrite.`,
      tool: "move_file",
      args,
    };
  }
  await vfs.rename(from, to);
  return {
    ok: true,
    output: `Moved ${fromStat.type} ${from} -> ${to}`,
    tool: "move_file",
    args,
    mutated: true,
  };
}

async function toolBatchRename(args: Record<string, unknown>): Promise<ToolResult> {
  const pattern = String(args.pattern ?? "");
  const basePath = String(args.path ?? "");
  const find = String(args.find ?? "");
  const replace = String(args.replace ?? "");
  const dryRun = args.dry_run === undefined ? true : Boolean(args.dry_run);
  const caseSensitive = Boolean(args.case_sensitive);

  if (!pattern || !find) {
    return {
      ok: false,
      output: "batch_rename requires 'pattern', 'find', and 'replace' arguments.",
      tool: "batch_rename",
      args,
    };
  }
  if (basePath && normalizePath(basePath) && !vfs.statSync(basePath)) {
    return {
      ok: false,
      output: `Path not found: ${basePath}. Check the path or pass '' to scope the whole workspace.`,
      tool: "batch_rename",
      args,
    };
  }

  let regex: RegExp;
  try {
    regex = globToRegex(pattern);
    if (!caseSensitive) regex = new RegExp(regex.source, "i");
  } catch {
    return { ok: false, output: `Invalid glob pattern: ${pattern}`, tool: "batch_rename", args };
  }

  // 复用 glob 工具的同款匹配语义：相对 basePath 匹配以便裸 pattern（如 "*.ts"）在目录内生效。
  const files = vfs.listAllFilesSync(basePath);
  const matches = files.filter((f) => {
    if (f.type !== "file") return false; // 只重命名文件，目录走 move_file
    if (!basePath) return regex.test(f.path);
    const rel = f.path.startsWith(basePath + "/") ? f.path.slice(basePath.length + 1) : f.path;
    return regex.test(rel);
  });

  if (matches.length === 0) {
    return {
      ok: true,
      output: `No files matched pattern: ${pattern}`,
      tool: "batch_rename",
      args,
    };
  }

  // find → replace 全路径替换，计算每个源的目标路径。
  const plan: { from: string; to: string }[] = [];
  for (const f of matches) {
    const to = f.path.split(find).join(replace);
    if (to === f.path) continue; // 没有变化的跳过
    plan.push({ from: f.path, to });
  }
  if (plan.length === 0) {
    return {
      ok: true,
      output: `${matches.length} file(s) matched, but none would change with find=${JSON.stringify(find)} → replace=${JSON.stringify(replace)}.`,
      tool: "batch_rename",
      args,
    };
  }

  // 冲突检测：多个源映射到同一目标 → 报错拒绝（避免静默覆盖）。
  const byTarget = new Map<string, string>();
  for (const p of plan) {
    if (byTarget.has(p.to)) {
      return {
        ok: false,
        output: `batch_rename would map both ${byTarget.get(p.to)} and ${p.from} to the same target ${p.to}. Narrow the pattern or 'find' so each source maps to a unique target.`,
        tool: "batch_rename",
        args,
      };
    }
    byTarget.set(p.to, p.from);
  }

  const preview = plan.map((p) => `${p.from} -> ${p.to}`).join("\n");
  if (dryRun) {
    return {
      ok: true,
      output: `[dry-run] Would rename ${plan.length} file(s):\n${preview}\n\nSet dry_run=false to apply.`,
      tool: "batch_rename",
      args,
    };
  }

  // 执行：跳过 target 已存在（statSync 非空）的项，其余逐个 rename。
  const done: string[] = [];
  const skipped: string[] = [];
  for (const p of plan) {
    if (vfs.statSync(p.to)) {
      skipped.push(`${p.from} -> ${p.to} (target exists)`);
      continue;
    }
    await vfs.rename(p.from, p.to);
    done.push(`${p.from} -> ${p.to}`);
  }
  const lines: string[] = [];
  if (done.length) lines.push(`Renamed ${done.length} file(s):\n${done.join("\n")}`);
  if (skipped.length) lines.push(`Skipped ${skipped.length} file(s):\n${skipped.join("\n")}`);
  return {
    ok: true,
    output: lines.join("\n\n") || "(command completed with no output)",
    tool: "batch_rename",
    args,
    mutated: done.length > 0,
  };
}

async function toolAppendFile(args: Record<string, unknown>): Promise<ToolResult> {
  const path = String(args.path ?? "");
  if (!path) {
    return {
      ok: false,
      output: "append_file requires a 'path' argument.",
      tool: "append_file",
      args,
    };
  }
  const content = String(args.content ?? "");
  const existing = vfs.readFileSync(path) ?? "";
  const newContent = existing + content;
  await vfs.writeFile(path, newContent);
  return {
    ok: true,
    output: `Appended ${content.length} characters to ${path}`,
    diff: { path, before: existing, after: newContent },
    tool: "append_file",
    args,
    mutated: true,
  };
}

async function toolInsertAt(args: Record<string, unknown>): Promise<ToolResult> {
  const path = String(args.path ?? "");
  if (!path) {
    return {
      ok: false,
      output: "insert_at requires a 'path' argument.",
      tool: "insert_at",
      args,
    };
  }
  const line = parseInt(String(args.line ?? "0"), 10);
  if (line < 1) {
    return {
      ok: false,
      output: "insert_at requires a positive 'line' number (1-indexed).",
      tool: "insert_at",
      args,
    };
  }
  const content = String(args.content ?? "");
  const existing = vfs.readFileSync(path) ?? "";
  const lines = existing.split("\n");
  const insertIdx = Math.min(line - 1, lines.length);
  lines.splice(insertIdx, 0, content);
  const newContent = lines.join("\n");
  await vfs.writeFile(path, newContent);
  return {
    ok: true,
    output: `Inserted ${content.length} characters at line ${line} in ${path}`,
    diff: { path, before: existing, after: newContent },
    tool: "insert_at",
    args,
    mutated: true,
  };
}

async function toolUndoEdit(args: Record<string, unknown>): Promise<ToolResult> {
  const snapshot = vfs.peekSnapshot();
  if (!snapshot) {
    return {
      ok: false,
      output: "Nothing to undo — no previous snapshot available.",
      tool: "undo_edit",
      args,
    };
  }
  await vfs.restoreLastSnapshot();
  return {
    ok: true,
    output: `Undone: ${snapshot.label}`,
    tool: "undo_edit",
    args,
    mutated: true,
  };
}

// ---------------------------------------------------------------------------
// read_multiple_files — batch read files
// ---------------------------------------------------------------------------

async function toolReadMultipleFiles(args: Record<string, unknown>): Promise<ToolResult> {
  const raw = args.paths;
  if (!Array.isArray(raw) || raw.length === 0) {
    return {
      ok: false,
      output: "read_multiple_files requires a non-empty 'paths' array.",
      tool: "read_multiple_files",
      args,
    };
  }
  const maxFiles = 20;
  if (raw.length > maxFiles) {
    return {
      ok: false,
      output: `Too many files. Maximum ${maxFiles} files per call, got ${raw.length}.`,
      tool: "read_multiple_files",
      args,
    };
  }

  const parts: string[] = [];
  const errors: string[] = [];
  let totalChars = 0;
  const maxTotal = 500_000;

  for (const item of raw) {
    const path = String(item);
    const content = vfs.readFileSync(path);
    if (content === null) {
      errors.push(`NOT FOUND: ${path}`);
      continue;
    }
    totalChars += content.length;
    if (totalChars > maxTotal) {
      errors.push(`TRUNCATED: ${path} (total output exceeds ${maxTotal.toLocaleString()} chars, remaining files skipped)`);
      break;
    }
    parts.push(`=== ${path} ===\n${content}`);
  }

  let output = parts.join("\n\n");
  if (errors.length > 0) {
    output += `\n\n--- Issues ---\n${errors.join("\n")}`;
  }
  return { ok: true, output, tool: "read_multiple_files", args };
}

// ---------------------------------------------------------------------------
// project_stats — workspace statistics
// ---------------------------------------------------------------------------

async function toolProjectStats(args: Record<string, unknown>): Promise<ToolResult> {
  const scopePath = args.path ? String(args.path).trim() : "";
  const all = vfs.allSync();
  const files = all.filter((n) => n.type === "file" && (!scopePath || n.path.startsWith(scopePath)));
  const dirs = all.filter((n) => n.type === "dir" && (!scopePath || n.path.startsWith(scopePath)));

  if (files.length === 0) {
    return {
      ok: true,
      output: `📊 项目统计：\n文件 0，目录 ${dirs.length}。文件袋为空。`,
      tool: "project_stats",
      args,
    };
  }

  type ExtInfo = { count: number; lines: number; chars: number };
  const extMap = new Map<string, ExtInfo>();
  let totalLines = 0;
  let totalChars = 0;
  let todoCount = 0;
  let fixmeCount = 0;

  const details: { path: string; lines: number; chars: number; updatedAt: number }[] = [];

  for (const f of files) {
    const content = f.content ?? "";
    const lines = content === "" ? 0 : content.split("\n").length;
    const chars = content.length;
    const ext = f.path.includes(".") ? f.path.split(".").pop()!.toLowerCase() : "(no ext)";

    const info = extMap.get(ext) ?? { count: 0, lines: 0, chars: 0 };
    info.count++;
    info.lines += lines;
    info.chars += chars;
    extMap.set(ext, info);

    totalLines += lines;
    totalChars += chars;
    todoCount += countOccurrences(content, "TODO");
    fixmeCount += countOccurrences(content, "FIXME") + countOccurrences(content, "HACK");
    details.push({ path: f.path, lines, chars, updatedAt: f.updatedAt });
  }

  // Format extension breakdown
  const extRows = [...extMap.entries()]
    .sort((a, b) => b[1].count - a[1].count)
    .map(([ext, info]) => `  ${ext.padEnd(14)} ${String(info.count).padStart(4)} 个  ${String(info.lines).padStart(7)} 行  ${String(info.chars).padStart(8)} 字符`);

  // Top 10 largest
  const largest = [...details].sort((a, b) => b.chars - a.chars).slice(0, 10);
  const largestRows = largest.map((f, i) =>
    `  ${i + 1}. ${f.path.padEnd(40)} ${String(f.lines).padStart(5)} 行  ${String(f.chars).padStart(7)} 字符`);

  // Top 5 most recently modified
  const recent = [...details].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 5);
  const recentRows = recent.map((f) =>
    `  ${f.path.padEnd(40)} ${new Date(f.updatedAt).toLocaleString()}`);

  const output = [
    `📊 项目概览`,
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
    `文件数:    ${files.length}`,
    `目录数:    ${dirs.length}`,
    `总代码行:  ${totalLines.toLocaleString()}`,
    `总字符数:  ${totalChars.toLocaleString()}`,
    ``,
    scopePath ? `(限定路径: ${scopePath})` : ``,
    `📁 文件类型分布`,
    ...extRows,
    ``,
    `📌 待办标记`,
    `  TODO:  ${todoCount}`,
    `  FIXME: ${fixmeCount}`,
    ``,
    `📏 最大文件 Top 10`,
    ...largestRows,
    ``,
    `🕐 最近修改 Top 5`,
    ...recentRows,
  ].filter(Boolean).join("\n");

  return { ok: true, output, tool: "project_stats", args };
}

export {
  toolReadFile,
  toolWriteFile,
  toolEditFile,
  toolDeleteFile,
  toolListFiles,
  toolListDirs,
  toolCreateDir,
  toolMoveFile,
  toolBatchRename,
  toolAppendFile,
  toolInsertAt,
  toolUndoEdit,
  toolReadMultipleFiles,
  toolProjectStats,
};

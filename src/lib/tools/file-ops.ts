import { vfs, basename } from "../vfs";
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

export {
  toolReadFile,
  toolWriteFile,
  toolEditFile,
  toolDeleteFile,
  toolListFiles,
  toolListDirs,
  toolCreateDir,
  toolMoveFile,
  toolAppendFile,
  toolInsertAt,
  toolUndoEdit,
};

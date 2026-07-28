import { vfs } from "../vfs";
import type { ToolResult } from "./types";

async function toolMultiEdit(args: Record<string, unknown>): Promise<ToolResult> {
  const edits = Array.isArray(args.edits) ? args.edits : [];
  if (edits.length === 0) {
    return {
      ok: false,
      output: "No edits provided.",
      tool: "multi_edit",
      args,
    };
  }
  const results: Array<{
    path: string;
    ok: boolean;
    error?: string;
    replacements?: number;
    diff?: { path: string; before: string; after: string };
  }> = [];
  const diffs: Array<{ path: string; before: string; after: string }> = [];
  let totalOk = 0;
  let totalFail = 0;

  for (let i = 0; i < edits.length; i++) {
    const edit = edits[i] as Record<string, unknown>;
    const path = String(edit.path ?? "");
    const oldString = String(edit.old_string ?? "");
    const newString = String(edit.new_string ?? "");
    const replaceAll = Boolean(edit.replace_all);
    try {
      const before = vfs.readFileSync(path) ?? "";
      const result = await vfs.editFile(path, oldString, newString, replaceAll);
      results.push({
        path,
        ok: true,
        replacements: result.replacements,
        diff: { path, before: result.before, after: result.after },
      });
      diffs.push({ path, before: result.before, after: result.after });
      totalOk++;
    } catch (e) {
      results.push({
        path,
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      });
      totalFail++;
    }
  }

  const summary = results
    .map((r, i) => {
      if (r.ok) {
        return `${i + 1}. ✓ ${r.path}: ${r.replacements} replacement(s)`;
      }
      return `${i + 1}. ✗ ${r.path}: ${r.error}`;
    })
    .join("\n");

  const lastDiff = diffs.length > 0 ? diffs[diffs.length - 1] : undefined;

  let header: string;
  if (totalFail === 0) {
    header = `multi_edit: all ${totalOk} edit(s) succeeded.`;
  } else if (totalOk === 0) {
    header = `multi_edit: all ${totalFail} edit(s) failed. No files were changed.`;
  } else {
    header = `multi_edit: PARTIAL SUCCESS — ${totalOk} succeeded, ${totalFail} failed. Note: successful edits were applied and are NOT rolled back. The failed edits listed below were not applied.`;
  }

  return {
    ok: totalFail === 0,
    output: `${header}\n\n${summary}`,
    diff: lastDiff,
    tool: "multi_edit",
    args,
    mutated: totalOk > 0,
  };
}

async function toolApplyPatch(args: Record<string, unknown>): Promise<ToolResult> {
  const patchText = String(args.patch ?? "");
  if (!patchText.trim()) {
    return { ok: false, output: "Empty patch.", tool: "apply_patch", args };
  }

  type PatchLine = { kind: "context" | "remove" | "add"; text: string };
  interface FileOp {
    type: "update" | "add" | "delete";
    path: string;
    lines: PatchLine[];
  }
  const ops: FileOp[] = [];
  let currentOp: FileOp | null = null;
  let inPatch = false;

  const patchLines = patchText.split("\n");
  for (let i = 0; i < patchLines.length; i++) {
    const line = patchLines[i];
    if (line.startsWith("*** Begin Patch")) {
      inPatch = true;
      continue;
    }
    if (line.startsWith("*** End Patch")) break;
    if (!inPatch) continue;
    if (line.startsWith("*** Update File: ")) {
      currentOp = { type: "update", path: line.slice(17).trim(), lines: [] };
      ops.push(currentOp);
    } else if (line.startsWith("*** Add File: ")) {
      currentOp = { type: "add", path: line.slice(14).trim(), lines: [] };
      ops.push(currentOp);
    } else if (line.startsWith("*** Delete File: ")) {
      currentOp = { type: "delete", path: line.slice(17).trim(), lines: [] };
      ops.push(currentOp);
    } else if (line.startsWith("@@")) {
      continue;
    } else if (line.startsWith("+")) {
      if (currentOp) currentOp.lines.push({ kind: "add", text: line.slice(1) });
    } else if (line.startsWith("-")) {
      if (currentOp) currentOp.lines.push({ kind: "remove", text: line.slice(1) });
    } else if (line.startsWith(" ")) {
      if (currentOp) currentOp.lines.push({ kind: "context", text: line.slice(1) });
    } else if (line === "") {
      if (currentOp && currentOp.type !== "delete") {
        currentOp.lines.push({ kind: "context", text: "" });
      }
    }
  }

  if (ops.length === 0) {
    return { ok: false, output: "No file operations found in patch. Use *** Update File: / *** Add File: / *** Delete File: directives.", tool: "apply_patch", args };
  }

  interface PlannedChange {
    path: string;
    before: string;
    after: string;
    type: "update" | "add" | "delete";
  }
  const planned: PlannedChange[] = [];
  const errors: string[] = [];

  for (const op of ops) {
    if (op.type === "delete") {
      const existing = vfs.readFileSync(op.path);
      if (existing === null) {
        errors.push(`Delete failed: ${op.path} not found`);
        continue;
      }
      planned.push({ path: op.path, before: existing, after: "", type: "delete" });
      continue;
    }
    if (op.type === "add") {
      if (vfs.readFileSync(op.path) !== null) {
        errors.push(`Add failed: ${op.path} already exists`);
        continue;
      }
      const content = op.lines.map((l) => l.text).join("\n");
      planned.push({ path: op.path, before: "", after: content, type: "add" });
      continue;
    }
    const existing = vfs.readFileSync(op.path);
    if (existing === null) {
      errors.push(`Update failed: ${op.path} not found`);
      continue;
    }
    try {
      const result = applyOrderedPatch(existing, op.lines);
      planned.push({ path: op.path, before: existing, after: result, type: "update" });
    } catch (e) {
      errors.push(`${op.path}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  if (errors.length > 0) {
    return {
      ok: false,
      output: `Patch failed (atomic — no changes applied):\n${errors.join("\n")}`,
      tool: "apply_patch",
      args,
    };
  }

  const applied: string[] = [];
  let lastDiff: { path: string; before: string; after: string } | undefined;
  for (const change of planned) {
    if (change.type === "delete") {
      await vfs.delete(change.path);
      applied.push(`deleted ${change.path}`);
    } else {
      await vfs.writeFile(change.path, change.after);
      applied.push(`${change.type === "add" ? "added" : "updated"} ${change.path}`);
      lastDiff = { path: change.path, before: change.before, after: change.after };
    }
  }

  return {
    ok: true,
    output: `Patch applied: ${applied.length} file(s) changed.\n${applied.map((a) => `  • ${a}`).join("\n")}`,
    diff: lastDiff,
    tool: "apply_patch",
    args,
    mutated: true,
  };
}

function applyOrderedPatch(content: string, patchLines: Array<{ kind: string; text: string }>): string {
  const fileLines = content.split("\n");
  const result: string[] = [];
  let fileIdx = 0;
  let patchedStart = -1;

  for (let patchIdx = 0; patchIdx < patchLines.length; patchIdx++) {
    const pl = patchLines[patchIdx];
    if (pl.kind === "add") {
      if (patchedStart === -1) patchedStart = fileIdx;
      result.push(pl.text);
      continue;
    }
    const matchIdx = findLineFrom(fileLines, pl.text, fileIdx);
    if (matchIdx < 0) {
      throw new Error(
        `${pl.kind === "context" ? "Context" : "Remove"} line "${pl.text}" not found from line ${fileIdx + 1} onward.`,
      );
    }
    if (patchedStart === -1) {
      patchedStart = matchIdx;
      for (let i = fileIdx; i < matchIdx; i++) result.push(fileLines[i]);
    } else {
      for (let i = fileIdx; i < matchIdx; i++) result.push(fileLines[i]);
    }
    if (pl.kind === "context") {
      result.push(fileLines[matchIdx]);
    }
    fileIdx = matchIdx + 1;
  }
  if (patchedStart === -1) return content;
  while (fileIdx < fileLines.length) {
    result.push(fileLines[fileIdx]);
    fileIdx++;
  }
  return result.join("\n");
}

function findLineFrom(lines: string[], text: string, from: number): number {
  for (let i = from; i < lines.length; i++) {
    if (lines[i] === text) return i;
  }
  return -1;
}

export { toolMultiEdit, toolApplyPatch };

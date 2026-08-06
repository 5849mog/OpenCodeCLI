import type { ToolResult } from "./types";
import { toolReadFile, toolWriteFile, toolEditFile, toolDeleteFile, toolListFiles, toolListDirs, toolCreateDir, toolMoveFile, toolAppendFile, toolInsertAt, toolUndoEdit, toolReadMultipleFiles, toolProjectStats } from "./file-ops";
import { toolSearchFiles, toolGlob, toolSearchSymbols, toolViewOutline } from "./search";
import { toolBash } from "./bash";
import { toolMultiEdit, toolApplyPatch } from "./patch";
import { toolUpdatePlan } from "./plan";
import { toolAskUserInput } from "./user-input";
import { toolWebSearch, toolFetchUrl } from "./web";
import { toolZipArchive, toolUnzipArchive } from "./zip";

export async function dispatchTool(
  name: string,
  args: Record<string, unknown>,
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
        return await toolBash(args);
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

/**
 * zip.ts — AI 工具的 zip 打包 / 解压能力（JSZip）
 *
 * 核心约束（用户最高优先级）：**输出只回短摘要**。文件内容 / base64 / 原始字节
 * 绝不进入工具返回的 output，否则会灌爆 AI 上下文与 token 消耗。
 *
 * 三条"工具→UI"桥（仿 ask_user_input，工具不碰 DOM）：
 *   - zip_archive    → useSession.setPendingDownload（组件触发浏览器下载）
 *   - unzip_archive  → useSession.setPendingZipRequest（组件弹文件选择，解压后以 user 消息回流）
 *   - 上传自动解压    → file-bag.tsx 的 handleFiles 调 extractZipFile
 */

import JSZip from "jszip";
import { vfs, normalizePath, joinPath } from "../vfs";
import { useSession } from "@/store/session";
import { uuid } from "@/lib/utils";
import type { ToolResult } from "./types";

/** Token/资源上限：所有解压/打包输出都是短摘要，绝不返回内容。 */
export const ZIP_LIMITS = {
  MAX_UNZIP_ENTRIES: 300,           // 解压条目上限，超了 stop + 注明
  MAX_ENTRY_SIZE: 5 * 1024 * 1024,  // 单条目 uncompressed 超限 → 占位符（不读内容）
  MAX_TOTAL_BYTES: 50 * 1024 * 1024,// 累计解压字节超限 → 当前条仍写后 stop
  RESULT_LIST_LIMIT: 20,            // 摘要里列出的文件名个数上限
  RESULT_SUMMARY_CHARS: 400,        // 摘要最终硬截断长度
  MAX_ARCHIVE_FILES: 1000,          // 打包文件数软上限（超了摘要里警告）
  MAX_ARCHIVE_BYTES: 200 * 1024 * 1024, // 打包总字符数软上限（只警告不阻止）
} as const;

export interface ExtractOptions {
  maxEntries?: number;
  maxEntrySize?: number;
  maxTotalBytes?: number;
  resultListLimit?: number;
  resultSummaryChars?: number;
  /** 解压目标前缀目录（如嵌套 zip 解到其父目录）。默认 "" = 工作区根。 */
  prefix?: string;
}

export interface ExtractResult {
  ok: boolean;
  /** zip 内所有条目数（含目录） */
  totalEntries: number;
  /** 实际写入 VFS 的文件数（含占位符） */
  written: number;
  /** 跳过条目数（zip-slip / 上限） */
  skipped: number;
  binaryPlaceholders: number;
  /** 实际写入内容的总字符数（≈字节，启发式） */
  totalBytes: number;
  /** 前 resultListLimit 个写入路径 */
  fileNames: string[];
  skippedNotes: string[];
  truncated: boolean;
}

/** zip-slip 防护：剥 `.`，`\` → `/`；**任何含 `..` 的条目直接拒绝**（返回 null → 跳过）。空 → null。 */
export function sanitizeZipPath(raw: string): string | null {
  const parts = raw.replace(/\\/g, "/").split("/");
  const safe: string[] = [];
  for (const seg of parts) {
    if (!seg || seg === ".") continue;
    if (seg === "..") return null; // 拒绝含 .. 的条目，绝不让路径逃逸 VFS 根
    safe.push(seg);
  }
  const p = normalizePath(safe.join("/"));
  return p || null;
}

/** JSZip 3.x 公开类型不含 uncompressedSize（在 _data 上）。取不到返回 -1（读后兜底）。 */
function entrySize(entry: JSZip.JSZipObject): number {
  const d = (entry as unknown as { _data?: { uncompressedSize?: number } })._data;
  return typeof d?.uncompressedSize === "number" ? d.uncompressedSize : -1;
}

function truncateSummary(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max - 3) + "...";
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

const binaryPlaceholder = (name: string, size: number) =>
  `[Binary file: ${name}, ${formatBytes(size)} — binary content not shown]`;
const largePlaceholder = (name: string, size: number) =>
  `[Binary file: ${name}, ${formatBytes(size)} — too large to display inline]`;

/** 共享解压核心：JSZip 解压 → 净化/上限/二进制判定 → 批量写 VFS。调用方负责快照与 bump。 */
export async function extractZipFile(file: Blob | File, opts: ExtractOptions = {}): Promise<ExtractResult> {
  const maxEntries = opts.maxEntries ?? ZIP_LIMITS.MAX_UNZIP_ENTRIES;
  const maxEntrySize = opts.maxEntrySize ?? ZIP_LIMITS.MAX_ENTRY_SIZE;
  const maxTotalBytes = opts.maxTotalBytes ?? ZIP_LIMITS.MAX_TOTAL_BYTES;
  const resultListLimit = opts.resultListLimit ?? ZIP_LIMITS.RESULT_LIST_LIMIT;
  const prefix = opts.prefix ?? "";

  const zip = await JSZip.loadAsync(await file.arrayBuffer());

  const res: ExtractResult = {
    ok: true,
    totalEntries: 0,
    written: 0,
    skipped: 0,
    binaryPlaceholders: 0,
    totalBytes: 0,
    fileNames: [],
    skippedNotes: [],
    truncated: false,
  };
  const toImport: Array<{ path: string; content: string }> = [];
  const entries = Object.values(zip.files);

  for (const entry of entries) {
    res.totalEntries++;
    if (entry.dir) continue;
    if (res.written + res.skipped >= maxEntries) {
      res.truncated = true;
      res.skippedNotes.push("达到条目上限，停止解压");
      break;
    }
    const safePath = sanitizeZipPath(entry.name);
    if (!safePath) {
      res.skipped++;
      res.skippedNotes.push(`跳过非法路径: ${entry.name}`);
      continue;
    }
    const finalPath = joinPath(prefix, safePath);
    const size = entrySize(entry);

    let content: string;
    if (size > maxEntrySize) {
      content = largePlaceholder(entry.name, size);
      res.binaryPlaceholders++;
    } else {
      const raw = await entry.async("string");
      if (raw.includes("�")) {
        content = binaryPlaceholder(entry.name, size >= 0 ? size : raw.length);
        res.binaryPlaceholders++;
      } else if (size === -1 && raw.length > maxEntrySize) {
        content = largePlaceholder(entry.name, raw.length);
        res.binaryPlaceholders++;
      } else {
        content = raw;
      }
    }
    res.totalBytes += content.length;
    if (res.totalBytes > maxTotalBytes) {
      res.truncated = true;
      res.skippedNotes.push("达到解压总量上限，停止");
    }
    toImport.push({ path: finalPath, content });
    if (res.fileNames.length < resultListLimit) res.fileNames.push(finalPath);
    res.written++;
    if (res.truncated) break;
  }

  if (toImport.length > 0) await vfs.importFiles(toImport);
  return res;
}

/** 解压结果 → 短摘要（硬截断）。绝不包含文件内容。 */
export function summarizeExtractResult(res: ExtractResult, maxChars?: number): string {
  const cap = maxChars ?? ZIP_LIMITS.RESULT_SUMMARY_CHARS;
  const lines: string[] = [
    `解压完成：写入 ${res.written} 个文件（共 ${formatBytes(res.totalBytes)}），跳过 ${res.skipped} 项，${res.binaryPlaceholders} 个二进制/超大占位。`,
  ];
  if (res.fileNames.length > 0) {
    lines.push(`文件列表（前 ${res.fileNames.length} 个）：`);
    for (const f of res.fileNames) lines.push(`- ${f}`);
  }
  if (res.skippedNotes.length > 0) {
    lines.push("注意：" + res.skippedNotes.slice(0, 5).join("；"));
  }
  if (res.truncated) lines.push("⚠️ 达到上限，解压被截断。");
  return truncateSummary(lines.join("\n"), cap);
}

/** 打包选定的文件/目录 → 真实 .zip → 经 store 桥触发浏览器下载。只回短摘要。 */
export async function toolZipArchive(args: Record<string, unknown>): Promise<ToolResult> {
  const tool = "zip_archive";
  const rawPaths = Array.isArray(args.paths) ? args.paths.map(String) : [];
  if (rawPaths.length === 0) {
    return {
      ok: false,
      output: "zip_archive requires a non-empty 'paths' array (relative paths to files or directories).",
      tool,
      args,
    };
  }

  // 目录递归展开 + 去重 + missing 收集
  const files: Array<{ path: string; content: string }> = [];
  const seen = new Set<string>();
  const missing: string[] = [];
  for (const raw of rawPaths) {
    const norm = normalizePath(String(raw));
    const stat = vfs.statSync(norm);
    if (!stat) {
      missing.push(String(raw));
      continue;
    }
    if (stat.type === "dir") {
      for (const f of vfs.listAllFilesSync(norm)) {
        if (seen.has(f.path)) continue;
        seen.add(f.path);
        files.push({ path: f.path, content: f.content ?? "" });
      }
    } else {
      if (seen.has(norm)) continue;
      seen.add(norm);
      files.push({ path: norm, content: stat.content ?? "" });
    }
  }

  if (files.length === 0) {
    return {
      ok: false,
      output: `zip_archive: no files found to package.${missing.length ? ` Missing: ${missing.join(", ")}` : ""}`,
      tool,
      args,
    };
  }

  const zip = new JSZip();
  let totalChars = 0;
  for (const f of files) {
    zip.file(f.path, f.content);
    totalChars += f.content.length;
  }

  const warnings: string[] = [];
  if (files.length > ZIP_LIMITS.MAX_ARCHIVE_FILES) {
    warnings.push(`文件数超软上限（${ZIP_LIMITS.MAX_ARCHIVE_FILES}）`);
  }
  if (totalChars > ZIP_LIMITS.MAX_ARCHIVE_BYTES) {
    warnings.push(`总大小超软上限（${formatBytes(ZIP_LIMITS.MAX_ARCHIVE_BYTES)}）`);
  }

  const name = sanitizeFilename(args.name);
  const blob = await zip.generateAsync({ type: "blob" });
  useSession.getState().setPendingDownload({ blob, filename: name });

  const names = files.slice(0, ZIP_LIMITS.RESULT_LIST_LIMIT).map((f) => f.path);
  const lines = [
    `已打包 ${files.length} 个文件（共 ${formatBytes(totalChars)}）为 ${name}，已触发浏览器下载。`,
    names.length > 0 ? `文件列表（前 ${names.length} 个）：\n${names.map((n) => `- ${n}`).join("\n")}` : "",
    missing.length > 0 ? `未找到路径：${missing.join(", ")}` : "",
    warnings.length > 0 ? `⚠️ ${warnings.join("；")}` : "",
  ].filter(Boolean);

  return {
    ok: true,
    output: truncateSummary(lines.join("\n"), ZIP_LIMITS.RESULT_SUMMARY_CHARS),
    tool,
    args,
  };
}

/** 请求用户选一个 .zip 文件；真实解压由组件在选完后执行，结果以 user 消息回流。 */
export async function toolUnzipArchive(args: Record<string, unknown>): Promise<ToolResult> {
  const tool = "unzip_archive";
  const store = useSession.getState();
  if (store.pendingZipRequest !== null) {
    return {
      ok: false,
      output: "已有一个待处理的 zip 文件选择，请等待用户先完成当前选择。",
      tool,
      args,
    };
  }
  const requestId = uuid().slice(0, 8);
  useSession.getState().setPendingZipRequest({ requestId });
  return {
    ok: true,
    output: `[等待用户选择 zip 文件] 已打开文件选择器（request_id: ${requestId}），用户选定后解压结果会以用户消息返回。`,
    tool,
    args,
  };
}

function sanitizeFilename(raw: unknown): string {
  let name = typeof raw === "string" && raw.trim() ? raw.trim() : `opencode-workspace-${Date.now()}.zip`;
  name = name.replace(/[\\/:*?"<>|]/g, "-");
  if (!/\.zip$/i.test(name)) name += ".zip";
  return name;
}

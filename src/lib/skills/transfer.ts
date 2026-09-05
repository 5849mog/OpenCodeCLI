/**
 * skills/transfer.ts — Skill 的专业分发格式：.zip 文件夹包 + 目录上传。
 *
 * 一个 skill 包 = 一个（或多个）skill 文件夹的 zip：
 *   pdf-skill.zip
 *   └── pdf/
 *       ├── SKILL.md
 *       ├── scripts/fill_form.py
 *       └── references/api.md
 *
 * 兼容两种 zip 布局：
 *  - 每个含 SKILL.md 的目录 = 一个 skill（anthropic/skills 仓库布局）
 *  - SKILL.md 直接在 zip 根（单 skill 包）
 *
 * 导出反向操作：skill 文件夹 → <name>/… 的真实 zip 下载。
 * 上传目录（webkitdirectory）会先在内存里组装成 zip 再走同一条导入路径。
 */

import JSZip from "jszip";
import {
  createSkill,
  validateSkillName,
  parseSkillMarkdown,
  type ImportedSkill,
  type SkillFile,
} from "./index";

/** 导入时的单文件/总量上限（文本按字符计，二进制按解码字节计）。 */
const TRANSFER_LIMITS = {
  MAX_TEXT_CHARS: 256 * 1024,
  MAX_BINARY_BYTES: 512 * 1024,
  MAX_ENTRIES: 400,
} as const;

/** zip 条目路径净化：`\` → `/`、剥 `.`、拒绝 `..`（防 zip-slip）。空 → null。 */
function sanitizeEntryPath(raw: string): string | null {
  const parts = raw.replace(/\\/g, "/").split("/");
  const safe: string[] = [];
  for (const seg of parts) {
    if (!seg || seg === ".") continue;
    if (seg === "..") return null;
    safe.push(seg);
  }
  const p = safe.join("/");
  return p || null;
}

/** 判断 zip 文本内容是否其实是二进制（UTF-8 解码出现替换符）。 */
function looksBinary(s: string): boolean {
  return s.includes("\uFFFD");
}

interface ParsedEntry {
  /** 净化后的 zip 内路径，如 "pdf/references/api.md"。 */
  path: string;
  text: string | null;
  base64: string | null;
  size: number;
}

/** 解 zip → 净化后的条目列表（含上限）。 */
async function readZipEntries(file: Blob): Promise<ParsedEntry[]> {
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const out: ParsedEntry[] = [];
  for (const entry of Object.values(zip.files)) {
    if (entry.dir) continue;
    if (out.length >= TRANSFER_LIMITS.MAX_ENTRIES) break;
    const safe = sanitizeEntryPath(entry.name);
    if (!safe) continue;
    const raw = await entry.async("string");
    if (looksBinary(raw)) {
      const d = (entry as unknown as { _data?: { uncompressedSize?: number } })._data;
      const size = typeof d?.uncompressedSize === "number" ? d.uncompressedSize : raw.length;
      if (size > TRANSFER_LIMITS.MAX_BINARY_BYTES) continue; // 超限二进制跳过
      out.push({ path: safe, text: null, base64: await entry.async("base64"), size });
    } else if (raw.length > TRANSFER_LIMITS.MAX_TEXT_CHARS) {
      continue; // 超限文本跳过
    } else {
      out.push({ path: safe, text: raw, base64: null, size: raw.length });
    }
  }
  return out;
}

export interface SkillImportReport {
  results: ImportedSkill[];
  /** 不属于任何 skill 文件夹而跳过的条目。 */
  skippedFiles: string[];
}

/** 从任意目录树条目中定位所有 skill 根（含 SKILL.md 的目录）。 */
function locateSkillRoots(entries: ParsedEntry[]): { rootPrefix: string; dirName: string }[] {
  const roots: { rootPrefix: string; dirName: string }[] = [];
  for (const e of entries) {
    if (!/^(?:.*\/)?SKILL\.md$/i.test(e.path)) continue;
    const idx = e.path.lastIndexOf("/");
    const rootPrefix = idx === -1 ? "" : e.path.slice(0, idx + 1);
    const rest = e.path.slice(0, Math.max(idx, 0));
    const dirName = rest ? rest.split("/").pop()! : "";
    roots.push({ rootPrefix, dirName });
  }
  // 深路径优先：嵌套 skill 根各自独立成包
  roots.sort((a, b) => b.rootPrefix.length - a.rootPrefix.length);
  return roots;
}

/** 统一导入入口：输入目录树条目（zip 或内存组装），找到每个 skill 文件夹并导入。 */
async function importFromEntries(entries: ParsedEntry[]): Promise<SkillImportReport> {
  const results: ImportedSkill[] = [];
  const skippedFiles: string[] = [];
  const roots = locateSkillRoots(entries);
  if (roots.length === 0) {
    return {
      results: [{ name: "(zip)", status: "invalid", error: "包内没有找到任何 SKILL.md — 不是有效的 skill 包" }],
      skippedFiles: entries.slice(0, 10).map((e) => e.path),
    };
  }
  const covered = new Set<string>();
  for (const { rootPrefix, dirName } of roots) {
    // 更深的嵌套 skill 根归它自己的包，不并入外层
    const deeper = roots
      .filter((r) => r.rootPrefix.length > rootPrefix.length && r.rootPrefix.startsWith(rootPrefix))
      .map((r) => r.rootPrefix);
    const files: Record<string, SkillFile> = {};
    for (const e of entries) {
      if (!e.path.startsWith(rootPrefix)) continue;
      if (e.path === rootPrefix + "SKILL.md") continue;
      if (deeper.some((dp) => e.path.startsWith(dp))) continue;
      const rel = e.path.slice(rootPrefix.length);
      files[rel] = e.text !== null ? { encoding: "text", content: e.text } : { encoding: "base64", content: e.base64! };
      covered.add(e.path);
    }
    const skmdEntry = entries.find((e) => e.path === rootPrefix + "SKILL.md");
    covered.add(rootPrefix + "SKILL.md");
    const skmd = skmdEntry?.text ?? "";
    const parsed = parseSkillMarkdown(skmd);
    // 包名：frontmatter.name > 文件夹名 > 报错
    let name = parsed.frontmatter && typeof parsed.frontmatter.name === "string" ? parsed.frontmatter.name.trim() : "";
    if (!name) name = dirName;
    const err = validateSkillName(name);
    if (err) {
      results.push({ name: name || dirName || "(未命名)", status: "invalid", error: err });
      continue;
    }
    const supportFiles: Record<string, string> = {};
    for (const [p, f] of Object.entries(files)) {
      if (f.encoding === "text") supportFiles[p] = f.content;
    }
    const res = await createSkill(name, skmd, { files: supportFiles, dependencies: parsed.dependencies });
    results.push(
      res.ok
        ? { name, status: "added", fileCount: Object.keys(files).length + 1, dependencies: parsed.dependencies }
        : { name, status: "invalid", error: res.error },
    );
  }
  for (const e of entries) {
    if (!covered.has(e.path)) skippedFiles.push(e.path);
  }
  return { results, skippedFiles: skippedFiles.slice(0, 10) };
}

/** 导入一个 skill .zip 包（单 skill 或多 skill 仓库布局均可）。 */
export async function importSkillsFromZip(file: Blob): Promise<SkillImportReport> {
  const entries = await readZipEntries(file);
  return importFromEntries(entries);
}

/**
 * 导入用户以「选择文件夹」方式上传的目录。
 * 先在内存组装成 zip（相对路径 = webkitRelativePath），再走同一条导入管线。
 */
export async function importSkillsFromDirectory(
  files: { relPath: string; file: File }[],
): Promise<SkillImportReport> {
  const zip = new JSZip();
  for (const { relPath, file: f } of files) {
    zip.file(relPath, await f.arrayBuffer());
  }
  const blob = await zip.generateAsync({ type: "blob" });
  return importSkillsFromZip(blob);
}

/** 导出一个 skill 为 .zip 文件夹包（<name>/SKILL.md + 支撑文件），返回 blob 供下载。 */
export async function exportSkillZip(
  name: string,
  files: Record<string, SkillFile>,
): Promise<{ blob: Blob; filename: string }> {
  const zip = new JSZip();
  const folder = zip.folder(name) ?? zip;
  for (const [relPath, f] of Object.entries(files)) {
    folder.file(relPath, f.content, f.encoding === "base64" ? { base64: true } : undefined);
  }
  const blob = await zip.generateAsync({ type: "blob" });
  return { blob, filename: `${name}-skill.zip` };
}

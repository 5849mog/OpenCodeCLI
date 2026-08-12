/**
 * file-icon.tsx — 按文件扩展名返回对应的 lucide 文件图标。
 *
 * 形状区分文件类型、颜色统一（由调用方传 text-* 类控制，遵循 currentColor）。
 * 纯 lucide、零新增依赖；named import 保证 tree-shake，只打包用到的图标。
 *
 * 用法：
 *   const Icon = getFileIcon(path, "h-3.5 w-3.5 shrink-0");
 *   <Icon className="text-[#8B7355] dark:text-[#E8A87C]" />
 */

import {
  File,
  FileArchive,
  FileAudio2,
  FileCode2,
  FileCog2,
  FileDiff,
  FileImage,
  FileJson2,
  FileSpreadsheet,
  FileTerminal,
  FileText,
  FileType2,
  FileVideo2,
  type LucideIcon,
} from "lucide-react";

/** 从路径取小写扩展名（与 file-bag 的 detectLanguage 同款逻辑）。 */
function extOf(path: string): string {
  return path.split(".").pop()?.toLowerCase() ?? "";
}

/** 代码类扩展名 → FileCode2 */
const CODE_EXTS = new Set([
  "js", "mjs", "cjs", "jsx", "ts", "tsx",
  "py", "rs", "go", "java", "c", "cpp", "h", "hpp",
  "css", "scss", "sass", "less", "sql", "html", "htm",
  "php", "rb", "swift", "kt", "cs", "vue", "svelte",
]);

const EXT_ICON: Record<string, LucideIcon> = {
  json: FileJson2,
  md: FileText,
  markdown: FileText,
  txt: FileText,
  log: FileText,
  csv: FileSpreadsheet,
  xlsx: FileSpreadsheet,
  xls: FileSpreadsheet,
  zip: FileArchive,
  tar: FileArchive,
  gz: FileArchive,
  "7z": FileArchive,
  rar: FileArchive,
  png: FileImage,
  jpg: FileImage,
  jpeg: FileImage,
  gif: FileImage,
  webp: FileImage,
  ico: FileImage,
  bmp: FileImage,
  svg: FileImage,
  mp3: FileAudio2,
  wav: FileAudio2,
  ogg: FileAudio2,
  flac: FileAudio2,
  mp4: FileVideo2,
  mov: FileVideo2,
  webm: FileVideo2,
  avi: FileVideo2,
  sh: FileTerminal,
  bash: FileTerminal,
  zsh: FileTerminal,
  fish: FileTerminal,
  env: FileCog2,
  conf: FileCog2,
  config: FileCog2,
  yml: FileType2,
  yaml: FileType2,
  toml: FileType2,
  diff: FileDiff,
  patch: FileDiff,
};

/** 根据路径返回对应的文件图标组件（无扩展名/未知 → 通用 File）。 */
export function getFileIcon(path: string): LucideIcon {
  const ext = extOf(path);
  // 特殊：无扩展名但像 Makefile/Dockerfile 之类——按完整文件名兜底常见无扩展文件
  if (!ext) {
    const base = path.split("/").pop() ?? path;
    if (/^(makefile|dockerfile|procfile|gemfile|rakefile)$/i.test(base)) return FileCog2;
    if (/^\.env/.test(base) || base === "env") return FileCog2;
    return File;
  }
  if (CODE_EXTS.has(ext)) return FileCode2;
  return EXT_ICON[ext] ?? File;
}

/** 渲染文件类型图标：按 path 选形状，className 控制尺寸与颜色。 */
export function FileTypeIcon({
  path,
  className,
}: {
  path: string;
  className?: string;
}) {
  const Icon = getFileIcon(path);
  return <Icon className={className} />;
}

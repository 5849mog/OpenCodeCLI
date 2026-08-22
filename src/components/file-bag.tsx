"use client";

/**
 * FileBag — the virtual workspace panel.
 *
 * - Top toolbar: upload files / folders, create new file, download zip,
 *   clear workspace, refresh.
 * - File tree (left): expandable directories, click to open file.
 * - Editor (right): code editor with syntax highlighting + save / download
 *   file / delete file.
 */

import { useEffect, useState, useRef, useMemo } from "react";
import {
  Upload,
  FolderUp,
  FilePlus,
  Download,
  Trash2,
  RefreshCw,
  Save,
  FolderPlus,
  Folder,
  FolderOpen,
  ChevronRight,
  ChevronDown,
  X,
  Search,
  ClipboardList,
  Menu,
  PanelLeft,
  Bot,
  ScrollText,
} from "lucide-react";
import JSZip from "jszip";
import { FileTypeIcon } from "@/lib/file-icon";
import { vfs, normalizePath, parentPath, basename, onVfsEvent, type VfsNode } from "@/lib/vfs";
import { extractZipFile } from "@/lib/tools/zip";
import { useVfsView } from "@/store/vfs-view";
import { useSession } from "@/store/session";
import { PlanPanel } from "@/components/plan-panel";
import { SubagentPanel, buildRuns } from "@/components/subagent-panel";
import { AuditPanel } from "@/components/audit-panel";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { motion } from "framer-motion";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export function FileBag() {
  const hydrated = useVfsView((s) => s.hydrated);
  const version = useVfsView((s) => s.version);
  const init = useVfsView((s) => s.init);

  useEffect(() => {
    init();
  }, [init]);

  if (!hydrated) {
    return (
      <div className="flex h-full items-center justify-center bg-[#FFFFFF] text-[#8B8884] dark:bg-background dark:text-zinc-500">
        <div className="animate-pulse text-[length:var(--font-size-ui-sm)]">loading 文件袋…</div>
      </div>
    );
  }

  return <FileBagInner />;
}

/** Read a File/Blob as a data: URL (base64). Used to store images in the VFS
 *  (which is string-backed) so they can be rendered inline and read back. */
function fileToDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("FileReader failed"));
    reader.readAsDataURL(file);
  });
}

function FileBagInner() {
  const activeTab = useVfsView((s) => s.activeTab);
  const openTab = useVfsView((s) => s.openTab);
  const setActiveTab = useVfsView((s) => s.setActiveTab);
  const bump = useVfsView((s) => s.bump);
  const rightPanelTab = useVfsView((s) => s.rightPanelTab);
  const setRightPanelTab = useVfsView((s) => s.setRightPanelTab);
  const vfsVersion = useVfsView((s) => s.version);
  const sessionEvents = useSession((s) => s.events);
  // 子智能体角标：计算当前 runs 数量 + 是否有运行中。
  const subagentRuns = useMemo(() => buildRuns(sessionEvents), [sessionEvents]);
  const subagentCount = subagentRuns.length;
  const subagentRunning = subagentRuns.some((r) => r.running);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const [newFileModal, setNewFileModal] = useState(false);
  const [treeCollapsed, setTreeCollapsed] = useState(false);

  const handleUploadClick = () => fileInputRef.current?.click();
  const handleFolderUploadClick = () => folderInputRef.current?.click();

  const handleFiles = async (files: FileList | null, prefix = "") => {
    if (!files || files.length === 0) return;
    const toImport: Array<{ path: string; content: string }> = [];
    let zipImported = 0;
    const zipNotes: string[] = [];
    for (const file of Array.from(files)) {
      // For folder uploads via webkitdirectory, file.webkitRelativePath is set
      const rel = (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
      const path = normalizePath(prefix + "/" + rel);
      // 新增：.zip 文件自动解压进文件袋（此前会被 file.text() 读成乱码）
      if (/\.zip$/i.test(file.name)) {
        try {
          const res = await extractZipFile(file, { prefix: parentPath(path) });
          zipImported += res.written;
          if (res.skipped > 0) zipNotes.push(`${file.name}: 跳过 ${res.skipped} 项`);
          if (res.truncated) zipNotes.push(`${file.name}: 达到解压上限`);
        } catch (e) {
          zipNotes.push(`${file.name}: 解压失败 ${e instanceof Error ? e.message : String(e)}`);
        }
        continue;
      }
      // Skip binary files > 5MB
      if (file.size > 5 * 1024 * 1024) {
        // Store as placeholder
        toImport.push({
          path,
          content: `[Binary file: ${file.name}, ${file.size} bytes — too large to display inline]`,
        });
        continue;
      }
      // Images: store as a data: URL string so the workspace editor can render
      // them inline (<img src>) and tools can read them back as base64.
      if (/\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(file.name)) {
        try {
          const dataUrl = await fileToDataUrl(file);
          toImport.push({ path, content: dataUrl });
          continue;
        } catch {
          // fall through to text read below
        }
      }
      try {
        const text = await file.text();
        toImport.push({ path, content: text });
      } catch {
        toImport.push({
          path,
          content: `[Could not read file: ${file.name}]`,
        });
      }
    }
    const n = await vfs.importFiles(toImport);
    bump();
    toast.success(
      zipImported > 0
        ? `Imported ${n} file(s); 其中 zip 解压 ${zipImported} 个文件${zipNotes.length ? `（${zipNotes.slice(0, 3).join("; ")}）` : ""}`
        : `Imported ${n} file(s) into the 文件袋`,
    );
  };

  const handleDownloadZip = async () => {
    const all = vfs.allSync().filter((n) => n.type === "file");
    if (all.length === 0) {
      toast.error("文件袋 is empty");
      return;
    }
    const zip = new JSZip();
    for (const node of all) {
      zip.file(node.path, node.content ?? "");
    }
    const blob = await zip.generateAsync({ type: "blob" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `opencode-web-workspace-${Date.now()}.zip`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast.success(`Downloaded ${all.length} files as zip`);
  };

  const handleClear = async () => {
    if (!confirm("Clear the entire 文件袋? This cannot be undone.")) return;
    await vfs.clear();
    bump();
    setActiveTab(null);
    toast.success("文件袋 cleared");
  };

  return (
    <div className="flex h-full flex-col bg-[#FFFFFF] text-[#2D2B27] dark:bg-background dark:text-zinc-100">
      {/* Toolbar + tabs */}
      <div className="flex flex-wrap items-center gap-1 border-b border-[#E5E2D9] px-2 py-2 text-[length:var(--font-size-ui-sm)] dark:border-[#3a3731]">
        {/* Panel tabs — sliding underline indicator */}
        <div className="mr-3 flex items-center gap-1 border-b border-transparent">
          {(
            [
              { key: "files", label: "文件袋", Icon: FolderOpen },
              { key: "plan", label: "Plan", Icon: ClipboardList },
              { key: "subagents", label: "子智能体", Icon: Bot },
              { key: "audit", label: "审计", Icon: ScrollText },
            ] as const
          ).map(({ key, label, Icon }) => {
            const active = rightPanelTab === key;
            return (
              <button
                key={key}
                onClick={() => setRightPanelTab(key)}
                className={cn(
                  "relative flex items-center gap-1.5 rounded px-2.5 py-1.5 font-medium transition-colors",
                  active
                    ? "text-[#E58F67]"
                    : "text-[#8B8884] hover:bg-[#F5F3EE] hover:text-[#3D3B37] dark:text-zinc-500 dark:hover:bg-[#262320] dark:hover:text-zinc-300",
                )}
              >
                <Icon className="h-3.5 w-3.5" />
                <span>{label}</span>
                {key === "subagents" && subagentCount > 0 && (
                  <span
                    className={cn(
                      "flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-bold",
                      subagentRunning
                        ? "animate-pulse bg-[#E58F67]/20 text-[#E58F67]"
                        : "bg-[#E58F67]/10 text-[#E58F67]",
                    )}
                  >
                    {subagentCount}
                  </span>
                )}
                {active && (
                  <motion.span
                    layoutId="panel-tab-indicator"
                    className="absolute inset-x-1 -bottom-[5px] h-0.5 rounded-full bg-[#E58F67]"
                    transition={{ type: "spring", stiffness: 400, damping: 32 }}
                  />
                )}
              </button>
            );
          })}
        </div>

        {/* Files toolbar — only show when on files tab */}
        {rightPanelTab === "files" && (<>
        <div className="h-5 w-px bg-[#E5E2D9] dark:bg-[#3a3731]" />
        <button
          onClick={() => setTreeCollapsed(!treeCollapsed)}
          className="flex items-center gap-1 rounded px-3 py-2 text-[#6B6862] hover:bg-[#F0EDE5] hover:text-[#2D2B27] tablet:flex desktop:hidden dark:text-zinc-400 dark:hover:bg-[#2a2723] dark:hover:text-zinc-200"
          title={treeCollapsed ? "展开文件树" : "折叠文件树"}
        >
          <PanelLeft className="h-3 w-3" />
        </button>
        <button
          onClick={handleUploadClick}
          className="touch-target flex items-center gap-1 rounded px-3 py-2 text-[#6B6862] hover:bg-[#F0EDE5] hover:text-[#2D2B27] dark:text-zinc-400 dark:hover:bg-[#2a2723] dark:hover:text-zinc-200"
          title="上传文件"
        >
          <Upload className="h-3 w-3" />
          <span className="hidden sm:inline">上传</span>
        </button>
        <button
          onClick={handleFolderUploadClick}
          className="touch-target flex items-center gap-1 rounded px-3 py-2 text-[#6B6862] hover:bg-[#F0EDE5] hover:text-[#2D2B27] dark:text-zinc-400 dark:hover:bg-[#2a2723] dark:hover:text-zinc-200"
          title="Upload folder"
        >
          <FolderUp className="h-3 w-3" />
          <span className="hidden sm:inline">Folder</span>
        </button>
        <button
          onClick={() => setNewFileModal(true)}
          className="touch-target flex items-center gap-1 rounded px-3 py-2 text-[#6B6862] hover:bg-[#F0EDE5] hover:text-[#2D2B27] dark:text-zinc-400 dark:hover:bg-[#2a2723] dark:hover:text-zinc-200"
          title="New file"
        >
          <FilePlus className="h-3 w-3" />
          <span className="hidden sm:inline">New</span>
        </button>
        <div className="ml-auto flex items-center gap-1">
          <button
            onClick={handleDownloadZip}
            className="touch-target flex items-center gap-1 rounded px-3 py-2 text-[#6B6862] hover:bg-[#F0EDE5] hover:text-[#2D2B27] dark:text-zinc-400 dark:hover:bg-[#2a2723] dark:hover:text-zinc-200"
            title="Download workspace as zip"
          >
            <Download className="h-3 w-3" />
            <span className="hidden sm:inline">Zip</span>
          </button>
          <button
            onClick={handleClear}
            className="touch-target flex items-center gap-1 rounded px-3 py-2 text-[#6B6862] hover:bg-[#E54D2E]/10 hover:text-[#E54D2E] dark:text-zinc-400"
            title="Clear workspace"
          >
            <Trash2 className="h-3 w-3" />
          </button>
          <button
            onClick={() => bump()}
            className="touch-target flex items-center gap-1 rounded px-3 py-2 text-[#6B6862] hover:bg-[#F0EDE5] hover:text-[#2D2B27] dark:text-zinc-400 dark:hover:bg-[#2a2723] dark:hover:text-zinc-200"
            title="Refresh"
          >
            <RefreshCw className="h-3 w-3" />
          </button>
        </div>
        </>)}
      </div>

      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => {
          handleFiles(e.target.files);
          e.target.value = "";
        }}
      />
      <input
        ref={folderInputRef}
        type="file"
        multiple
        className="hidden"
        // @ts-expect-error webkitdirectory is a non-standard attribute
        webkitdirectory=""
        directory=""
        onChange={(e) => {
          handleFiles(e.target.files);
          e.target.value = "";
        }}
      />

      {/* Body: files tree + editor or Plan / 子智能体 panel */}
      {rightPanelTab === "files" ? (
        // 有打开文件才分栏（左树 + 右编辑器）；无文件时文件树占满整个右侧栏，
        // 不显示空编辑器占位（与 VSCode 行为一致）。
        activeTab ? (
          <div className="flex min-h-0 flex-1">
            <div className={cn(
              "shrink-0 border-r border-[#E5E2D9] overflow-y-auto transition-all duration-200 ease-in-out",
              treeCollapsed ? "w-0 overflow-hidden border-r-0" : "w-48"
            )}>
              <FileTree onOpen={(p) => openTab(p)} />
            </div>
            <div className="flex-1 min-w-0 flex flex-col">
              <TabbedEditor />
            </div>
          </div>
        ) : (
          <div className="min-h-0 flex-1 overflow-y-auto">
            <FileTree onOpen={(p) => openTab(p)} />
          </div>
        )
      ) : rightPanelTab === "plan" ? (
        <div className="flex min-h-0 flex-1">
          <PlanPanel />
        </div>
      ) : rightPanelTab === "audit" ? (
        <div className="flex min-h-0 flex-1">
          <AuditPanel />
        </div>
      ) : (
        <div className="flex min-h-0 flex-1">
          <SubagentPanel />
        </div>
      )}

      {newFileModal && (
        <NewFileModal
          onClose={() => setNewFileModal(false)}
          onCreate={async (path, isDir) => {
            if (isDir) {
              await vfs.mkdir(path);
            } else {
              await vfs.writeFile(path, "");
            }
            bump();
            if (!isDir) openTab(path);
            setNewFileModal(false);
            toast.success(`Created ${isDir ? "directory" : "file"}: ${path}`);
          }}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// File tree
// ---------------------------------------------------------------------------

function FileTree({ onOpen }: { onOpen: (path: string) => void }) {
  const expanded = useVfsView((s) => s.expandedDirs);
  const toggleDir = useVfsView((s) => s.toggleDir);
  const bump = useVfsView((s) => s.bump);
  // Subscribe to version so the tree re-renders when VFS mutates.
  useVfsView((s) => s.version);
  const root = "";
  const [query, setQuery] = useState("");
  // 删除文件夹：待删目录 + 其下文件数（用于确认框）
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const deleteCount = deleteTarget ? vfs.listAllFilesSync(deleteTarget).length : 0;

  const confirmDeleteFolder = () => {
    if (!deleteTarget) return;
    void (async () => {
      await vfs.delete(deleteTarget);
      bump();
      setDeleteTarget(null);
    })();
  };

  // If there's a search query, show flat filtered list instead of tree
  if (query.trim()) {
    const allFiles = vfs.listAllFilesSync("");
    const q = query.toLowerCase();
    const matched = allFiles
      .filter((f) => f.path.toLowerCase().includes(q))
      .slice(0, 50);
    return (
      <div className="flex h-full flex-col font-mono text-[length:var(--font-size-code)]">
        <div className="border-b border-[#E5E2D9] p-2 dark:border-[#3a3731]">
          <div className="flex items-center gap-1.5 rounded border border-[#E5E2D9] bg-[#FAF9F7] px-2 py-1 dark:border-[#3a3731] dark:bg-[#1c1a17]">
            <Search className="h-3 w-3 text-[#8B8884] dark:text-zinc-500" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search files…"
              className="flex-1 bg-transparent text-[#2D2B27] placeholder:text-[#A8A29E] focus:outline-none dark:text-zinc-200 dark:placeholder:text-zinc-500"
            />
            {query && (
              <button
                onClick={() => setQuery("")}
                className="text-[#8B8884] hover:text-[#3D3B37] dark:text-zinc-500 dark:hover:text-zinc-200"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
          <div className="mt-1 text-[length:var(--font-size-ui-sm)] text-[#A8A29E] dark:text-zinc-500">
            {matched.length} match{matched.length !== 1 ? "es" : ""}
          </div>
        </div>
        <div className="flex-1 overflow-y-auto py-1 [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-[#D6D3CE] dark:[&::-webkit-scrollbar-thumb]:bg-[#3a3731]">
          {matched.length === 0 ? (
            <div className="px-3 py-4 text-center text-[#A8A29E] dark:text-zinc-500">No files match "{query}"</div>
          ) : (
            matched.map((f) => (
              <button
                key={f.path}
                onClick={() => {
                  onOpen(f.path);
                  setQuery("");
                }}
                className="flex w-full items-center gap-1.5 px-2 py-1 text-left hover:bg-[#F0EDE5] dark:hover:bg-[#2a2723]"
                title={f.path}
              >
                <FileTypeIcon path={f.path} className="h-3.5 w-3.5 shrink-0 text-[#8B7355] dark:text-[#E8A87C]" />
                <span className="truncate text-[#3D3B37] dark:text-zinc-300">{f.path}</span>
              </button>
            ))
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col font-mono text-[length:var(--font-size-code)]">
      <div className="border-b border-[#E5E2D9] p-2 dark:border-[#3a3731]">
        <div className="flex items-center gap-1.5 rounded border border-[#E5E2D9] bg-[#FAF9F7] px-2 py-1 dark:border-[#3a3731] dark:bg-[#1c1a17]">
          <Search className="h-3 w-3 text-[#8B8884] dark:text-zinc-500" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search files…"
            className="flex-1 bg-transparent text-[#2D2B27] placeholder:text-[#A8A29E] focus:outline-none dark:text-zinc-200 dark:placeholder:text-zinc-500"
          />
        </div>
      </div>
      <div className="flex-1 overflow-y-auto py-1 [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-[#D6D3CE] dark:[&::-webkit-scrollbar-thumb]:bg-[#3a3731]">
        <div className="px-2 py-1 text-[length:var(--font-size-ui-sm)] uppercase tracking-wider text-[#A8A29E] dark:text-zinc-500">
          workspace
        </div>
        <TreeChildren dir={root} depth={0} expanded={expanded} toggleDir={toggleDir} onOpen={onOpen} onDelete={setDeleteTarget} />
        <EmptyHint />
      </div>

      {/* 删除文件夹确认框（样式化） */}
      <AlertDialog open={deleteTarget !== null} onOpenChange={(o) => { if (!o) setDeleteTarget(null); }}>
        <AlertDialogContent className="border-[#E5E2D9] bg-[#FFFFFF] text-[#2D2B27] dark:border-[#3a3731] dark:bg-[#1c1a17] dark:text-zinc-100">
          <AlertDialogHeader>
            <AlertDialogTitle>删除文件夹「{deleteTarget ?? ""}」？</AlertDialogTitle>
            <AlertDialogDescription className="text-[#6B6862] dark:text-zinc-400">
              将递归删除该文件夹下所有内容（{deleteCount} 个文件）。此操作不可撤销。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-[#E5E2D9] text-[#3D3B37] hover:bg-[#F0EDE5] dark:border-[#3a3731] dark:text-zinc-300 dark:hover:bg-[#2a2723]">
              取消
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDeleteFolder}
              className="bg-[#E54D2E] text-white hover:bg-[#C43D1F]"
            >
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function TreeChildren({
  dir,
  depth,
  expanded,
  toggleDir,
  onOpen,
  onDelete,
}: {
  dir: string;
  depth: number;
  expanded: Set<string>;
  toggleDir: (path: string) => void;
  onOpen: (path: string) => void;
  onDelete: (path: string) => void;
}) {
  const children = vfs.listSync(dir);
  if (children.length === 0 && depth === 0) {
    return (
      <div className="px-4 py-2 text-[#A8A29E] dark:text-zinc-500">
        No files yet. Upload files or ask the AI to create some.
      </div>
    );
  }
  return (
    <div>
      {children.map((c) => (
        <TreeRow
          key={c.path}
          node={c}
          depth={depth}
          expanded={expanded}
          toggleDir={toggleDir}
          onOpen={onOpen}
          onDelete={onDelete}
        />
      ))}
    </div>
  );
}

function TreeRow({
  node,
  depth,
  expanded,
  toggleDir,
  onOpen,
  onDelete,
}: {
  node: VfsNode;
  depth: number;
  expanded: Set<string>;
  toggleDir: (path: string) => void;
  onOpen: (path: string) => void;
  onDelete: (path: string) => void;
}) {
  const name = basename(node.path);
  const isOpen = expanded.has(node.path) || (node.path === "" && expanded.has(""));
  const isDir = node.type === "dir";

  return (
    <div className="group/row relative">
      <button
        onClick={() => (isDir ? toggleDir(node.path) : onOpen(node.path))}
        className={cn(
          "flex w-full items-center gap-1 py-1 pr-7 text-left hover:bg-[#F0EDE5] dark:hover:bg-[#2a2723]",
        )}
        style={{ paddingLeft: `${depth * 12 + 8}px` }}
      >
        {isDir ? (
          <>
            {isOpen ? (
              <ChevronDown className="h-3 w-3 shrink-0 text-[#8B8884] dark:text-zinc-500" />
            ) : (
              <ChevronRight className="h-3 w-3 shrink-0 text-[#8B8884] dark:text-zinc-500" />
            )}
            {isOpen ? (
              <FolderOpen className="h-3.5 w-3.5 shrink-0 text-[#B87B5A] dark:text-[#E8A87C]" />
            ) : (
              <Folder className="h-3.5 w-3.5 shrink-0 text-[#B87B5A] dark:text-[#E8A87C]" />
            )}
          </>
        ) : (
          <>
            <span className="w-3 shrink-0" />
            <FileTypeIcon path={node.path} className="h-3.5 w-3.5 shrink-0 text-[#8B7355] dark:text-[#E8A87C]" />
          </>
        )}
        <span className={cn("truncate", isDir ? "text-[#3D3B37] dark:text-zinc-300" : "text-[#6B6862] dark:text-zinc-400")}>
          {name}
          {isDir && "/"}
        </span>
      </button>
      {/* hover 删除按钮 — 仅目录显示（防止误删单文件，单文件仍走编辑器内删除） */}
      {isDir && (
        <button
          onClick={() => onDelete(node.path)}
          title={`删除文件夹 ${node.path}`}
          className="absolute right-1 top-1/2 -translate-y-1/2 rounded p-1 text-[#8B8884] opacity-0 transition-opacity hover:bg-[#E54D2E]/10 hover:text-[#E54D2E] group-hover/row:opacity-100 dark:text-zinc-500 dark:hover:text-[#E54D2E]"
        >
          <Trash2 className="h-3 w-3" />
        </button>
      )}
      {isDir && isOpen && (
        <TreeChildren
          dir={node.path}
          depth={depth + 1}
          expanded={expanded}
          toggleDir={toggleDir}
          onOpen={onOpen}
          onDelete={onDelete}
        />
      )}
    </div>
  );
}

function EmptyHint() {
  const all = vfs.allSync();
  if (all.length > 0) return null;
  return (
    <div className="mt-4 px-4 text-[length:var(--font-size-ui-sm)] text-[#A8A29E] dark:text-zinc-500">
      <div className="rounded border border-dashed border-[#E5E2D9] p-4 text-center dark:border-[#3a3731]">
        <Upload className="mx-auto mb-2 h-6 w-6 text-[#BFB8B0] dark:text-zinc-600" />
        <div>Upload files or ask the AI to create them.</div>
        <div className="mt-1 text-[#BFB8B0] dark:text-zinc-600">
          Everything lives in your browser (IndexedDB) — nothing is uploaded to a server.
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Editor panel
// ---------------------------------------------------------------------------

/** Empty state shown when no file tab is open. */
// ---------------------------------------------------------------------------
// Tabbed editor — VSCode-style multi-tab file editing
// ---------------------------------------------------------------------------

function TabbedEditor() {
  const openTabs = useVfsView((s) => s.openTabs);
  const activeTab = useVfsView((s) => s.activeTab);
  const setActiveTab = useVfsView((s) => s.setActiveTab);
  const closeTab = useVfsView((s) => s.closeTab);
  const dirtyTabs = useVfsView((s) => s.dirtyTabs);
  const setTabDirty = useVfsView((s) => s.setTabDirty);
  const bump = useVfsView((s) => s.bump);

  // Content per tab — state so React re-renders on change.
  // savedContent is also state, for dirty comparison in render.
  const [contents, setContents] = useState<Record<string, string>>({});
  const [savedContents, setSavedContents] = useState<Record<string, string>>({});

  // Initialize content for newly opened tabs
  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect */
    setContents((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const path of openTabs) {
        if (next[path] === undefined) {
          const c = vfs.readFileSync(path) ?? "";
          next[path] = c;
          changed = true;
        }
      }
      for (const path of Object.keys(next)) {
        if (!openTabs.includes(path)) {
          delete next[path];
          changed = true;
        }
      }
      return changed ? next : prev;
    });
    setSavedContents((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const path of openTabs) {
        if (next[path] === undefined) {
          next[path] = vfs.readFileSync(path) ?? "";
          changed = true;
        }
      }
      for (const path of Object.keys(next)) {
        if (!openTabs.includes(path)) {
          delete next[path];
          changed = true;
        }
      }
      return changed ? next : prev;
    });
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [openTabs]);

  // If the active tab's file was deleted externally, close it
  useEffect(() => {
    if (activeTab && vfs.statSync(activeTab) === null) {
      closeTab(activeTab);
    }
  }, [activeTab, closeTab, bump]);

  // React to external VFS mutations (AI editing files via tools).
  // - If a tab's file was written externally and the tab is NOT dirty:
  //   reload its content silently.
  // - If the tab IS dirty (user has unsaved edits): warn via toast and mark
  //   a "stale" flag so the user knows their local copy diverges.
  // - If a tab's file was deleted/rename-ed away: close the tab.
  useEffect(() => {
    const unsubscribe = onVfsEvent((e) => {
      if (e.type === "clear") {
        // Everything gone — close all tabs
        for (const p of openTabs) closeTab(p);
        return;
      }
      const affectedPath = e.type === "rename" ? e.path : e.path;
      if (!affectedPath) return;
      // Check if any open tab is under the affected path
      for (const tabPath of openTabs) {
        const isSelf = tabPath === affectedPath;
        const isUnder = tabPath.startsWith(affectedPath + "/");
        if (!isSelf && !isUnder) continue;

        if (e.type === "delete" || e.type === "rename") {
          closeTab(tabPath);
          continue;
        }
        if (e.type !== "write") continue;

        // File was written externally
        const isDirty = dirtyTabs[tabPath] ?? false;
        if (!isDirty) {
          // Reload silently
          const fresh = vfs.readFileSync(tabPath) ?? "";
          setContents((prev) => ({ ...prev, [tabPath]: fresh }));
          setSavedContents((prev) => ({ ...prev, [tabPath]: fresh }));
        } else {
          // User has unsaved changes — warn with actionable buttons
          toast.warning(
            `${tabPath} was modified by the AI. You have unsaved edits in the editor.`,
            {
              duration: 10000,
              action: {
                label: "Reload from 文件袋",
                onClick: () => {
                  const fresh = vfs.readFileSync(tabPath) ?? "";
                  setContents((prev) => ({ ...prev, [tabPath]: fresh }));
                  setSavedContents((prev) => ({ ...prev, [tabPath]: fresh }));
                  setTabDirty(tabPath, false);
                  toast.success(`Reloaded ${tabPath} from 文件袋`);
                },
              },
              cancel: {
                label: "Keep my version",
                onClick: () => {},
              },
            },
          );
        }
      }
    });
    return unsubscribe;
  }, [openTabs, dirtyTabs, closeTab]);

  // Ctrl/Cmd+S to save the active tab
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault();
        if (activeTab && (dirtyTabs[activeTab] ?? false)) {
          const c = contents[activeTab];
          if (c !== undefined) {
            void vfs.writeFile(activeTab, c).then(() => {
              setSavedContents((prev) => ({ ...prev, [activeTab]: c }));
              setTabDirty(activeTab, false);
              bump();
              toast.success(`Saved ${activeTab}`);
            });
          }
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  });

  if (!activeTab) return null;

  const content = contents[activeTab] ?? "";
  const savedContent = savedContents[activeTab] ?? "";
  const dirty = dirtyTabs[activeTab] ?? false;
  const language = detectLanguage(activeTab);

  const save = async (path: string) => {
    const c = contents[path];
    if (c === undefined) return;
    await vfs.writeFile(path, c);
    setSavedContents((prev) => ({ ...prev, [path]: c }));
    setTabDirty(path, false);
    bump();
    toast.success(`Saved ${path}`);
  };

  const saveActive = async () => {
    if (activeTab) await save(activeTab);
  };

  const remove = async (path: string) => {
    if (!confirm(`Delete ${path}?`)) return;
    await vfs.delete(path);
    bump();
    closeTab(path);
    toast.success(`Deleted ${path}`);
  };

  const downloadOne = async (path: string) => {
    const c = contents[path] ?? "";
    const blob = new Blob([c], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = basename(path);
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Tab bar — VSCode style */}
      <div className="flex items-stretch overflow-x-auto border-b border-[#E5E2D9] bg-[#FAF9F7] text-[length:var(--font-size-ui-sm)] [&::-webkit-scrollbar]:h-1 [&::-webkit-scrollbar-thumb]:bg-[#D6D3CE] dark:border-[#3a3731] dark:bg-[#1c1a17] dark:[&::-webkit-scrollbar-thumb]:bg-[#3a3731]">
        {openTabs.map((path) => {
          const isActive = path === activeTab;
          const isDirty = dirtyTabs[path] ?? false;
          const name = basename(path);
          return (
            <div
              key={path}
              onClick={() => setActiveTab(path)}
              className={`group flex cursor-pointer items-center gap-1.5 border-r border-[#E5E2D9] px-3 py-2 transition-colors dark:border-[#3a3731] ${
                isActive
                  ? "bg-[#FFFFFF] text-[#1A1815] dark:bg-[#161512] dark:text-zinc-100"
                  : "bg-[#FAF9F7] text-[#8B8884] hover:bg-[#FFFFFF]/60 hover:text-[#3D3B37] dark:bg-[#1c1a17] dark:text-zinc-500 dark:hover:bg-[#262320] dark:hover:text-zinc-300"
              }`}
              style={isActive ? { borderBottom: "2px solid #10b981", marginBottom: "-1px" } : {}}
              title={path}
            >
              <FileTypeIcon path={path} className="h-3 w-3 shrink-0 text-[#8B7355] dark:text-[#E8A87C]" />
              <span className="max-w-[120px] truncate font-mono">{name}</span>
              {isDirty ? (
                <span
                  onClick={(e) => {
                    e.stopPropagation();
                    closeTab(path);
                  }}
                  className="ml-1 h-1.5 w-1.5 rounded-full bg-amber-500 group-hover:hidden"
                  title="Unsaved changes"
                />
              ) : null}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  if (isDirty) {
                    if (!confirm(`${path} has unsaved changes. Close anyway?`)) return;
                  }
                  closeTab(path);
                }}
                className={`ml-1 rounded p-0.5 text-[#8B8884] hover:bg-[#D6D3CE] hover:text-[#2D2B27] dark:text-zinc-500 dark:hover:bg-[#3a3731] dark:hover:text-zinc-200 ${isDirty ? "hidden group-hover:block" : ""}`}
                title="Close tab"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          );
        })}
      </div>

      {/* Active tab toolbar */}
      <div className="flex items-center gap-2 border-b border-[#E5E2D9] bg-[#FFFFFF] px-2 py-1.5 text-[length:var(--font-size-ui-sm)] dark:border-[#3a3731] dark:bg-[#161512]">
        <span className="truncate font-mono text-[#6B6862] dark:text-zinc-400">{activeTab}</span>
        <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[length:var(--font-size-ui-sm)] text-[#8B8884]">
          {language}
        </span>
        <div className="ml-auto flex items-center gap-1">
          <button
            onClick={saveActive}
            disabled={!dirty}
            className="touch-target flex items-center gap-1 rounded px-3 py-2 text-[#6B6862] hover:bg-[#F0EDE5] hover:text-[#2D2B27] disabled:opacity-40 dark:text-zinc-400 dark:hover:bg-[#2a2723] dark:hover:text-zinc-200"
            title="Save (Ctrl+S)"
          >
            <Save className="h-3 w-3" />
            <span className="hidden sm:inline">Save</span>
          </button>
          <button
            onClick={() => downloadOne(activeTab)}
            className="touch-target flex items-center gap-1 rounded px-3 py-2 text-[#6B6862] hover:bg-[#F0EDE5] hover:text-[#2D2B27] dark:text-zinc-400 dark:hover:bg-[#2a2723] dark:hover:text-zinc-200"
            title="Download this file"
          >
            <Download className="h-3 w-3" />
          </button>
          <button
            onClick={() => remove(activeTab)}
            className="touch-target flex items-center gap-1 rounded px-3 py-2 text-[#6B6862] hover:bg-[#E54D2E]/10 hover:text-[#E54D2E] dark:text-zinc-400"
            title="Delete this file"
          >
            <Trash2 className="h-3 w-3" />
          </button>
        </div>
      </div>

      {/* Editor */}
      <div className="min-h-0 flex-1 overflow-hidden bg-[#FAF9F7] dark:bg-[#161512]">
        {isImageTab(activeTab, content) ? (
          <div className="flex h-full items-center justify-center overflow-auto p-4">
            <img
              src={content}
              alt={basename(activeTab)}
              className="max-h-full max-w-full rounded object-contain shadow"
              draggable={false}
            />
          </div>
        ) : (
          <CodeMirrorEditor
            key={activeTab}
            value={content}
            onChange={(v) => {
              setContents((prev) => ({ ...prev, [activeTab]: v }));
              setTabDirty(activeTab, v !== savedContents[activeTab]);
            }}
            language={language}
          />
        )}
      </div>

      {/* Status bar */}
      <div className="flex items-center justify-between border-t border-[#E5E2D9] bg-[#FAF9F7] px-3 py-1 text-[length:var(--font-size-ui-sm)] text-[#A8A29E] dark:border-[#3a3731] dark:bg-[#1c1a17] dark:text-zinc-500">
        <span>
          {content.length} chars · {content.split("\n").length} lines
        </span>
        <span className={dirty ? "text-[#B87B5A] dark:text-[#E8A87C]" : "text-[#A8A29E] dark:text-zinc-500"}>
          {dirty ? "● unsaved" : "saved"}
        </span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Lightweight code editor with Prism syntax highlighting
// ---------------------------------------------------------------------------

import { CodeMirrorEditor } from "./code-editor";

/** True if a tab's file is an image (by extension or by stored data: URL). */
function isImageTab(path: string, content: string): boolean {
  if (/^data:image\//.test(content)) return true;
  return /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(path);
}

function detectLanguage(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    js: "javascript",
    mjs: "javascript",
    cjs: "javascript",
    jsx: "jsx",
    ts: "typescript",
    tsx: "tsx",
    css: "css",
    scss: "css",
    json: "json",
    html: "html",
    htm: "html",
    xml: "xml",
    svg: "xml",
    md: "markdown",
    markdown: "markdown",
    sh: "bash",
    bash: "bash",
    zsh: "bash",
    py: "python",
    yml: "yaml",
    yaml: "yaml",
    go: "go",
    rs: "rust",
    toml: "yaml",
    txt: "text",
    env: "text",
    sql: "sql",
  };
  return map[ext] || "text";
}

// ---------------------------------------------------------------------------
// New file modal
// ---------------------------------------------------------------------------

function NewFileModal({
  onClose,
  onCreate,
}: {
  onClose: () => void;
  onCreate: (path: string, isDir: boolean) => void;
}) {
  const [path, setPath] = useState("");
  const [isDir, setIsDir] = useState(false);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-md rounded-lg border border-[#E5E2D9] bg-[#FFFFFF] p-4 text-[#2D2B27] dark:border-[#3a3731] dark:bg-[#1c1a17] dark:text-zinc-100">
        <div className="mb-3 flex items-center gap-2">
          {isDir ? (
            <FolderPlus className="h-4 w-4 text-[#B87B5A] dark:text-[#E8A87C]" />
          ) : (
            <FilePlus className="h-4 w-4 text-[#8B7355] dark:text-[#E8A87C]" />
          )}
          <span className="font-semibold">
            New {isDir ? "directory" : "file"}
          </span>
          <button
            onClick={onClose}
            className="ml-auto rounded p-1 text-[#8B8884] hover:bg-[#F0EDE5] hover:text-[#3D3B37] dark:text-zinc-500 dark:hover:bg-[#2a2723] dark:hover:text-zinc-200"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <input
          autoFocus
          value={path}
          onChange={(e) => setPath(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && path.trim()) {
              onCreate(path.trim(), isDir);
            }
          }}
          placeholder="e.g. src/index.ts"
          className="w-full rounded border border-[#E5E2D9] bg-[#FAF9F7] px-3 py-2 font-mono text-sm focus:border-zinc-500 focus:outline-none dark:border-[#3a3731] dark:bg-[#161512] dark:text-zinc-100"
        />
        <div className="mt-3 flex items-center gap-3 text-xs">
          <label className="flex items-center gap-1.5 cursor-pointer">
            <input
              type="radio"
              checked={!isDir}
              onChange={() => setIsDir(false)}
            />
            <span>File</span>
          </label>
          <label className="flex items-center gap-1.5 cursor-pointer">
            <input
              type="radio"
              checked={isDir}
              onChange={() => setIsDir(true)}
            />
            <span>Directory</span>
          </label>
          <button
            onClick={() => path.trim() && onCreate(path.trim(), isDir)}
            disabled={!path.trim()}
            className="ml-auto rounded bg-[#E58F67] px-3 py-1.5 text-sm text-white hover:bg-[#C66B4A] disabled:opacity-40"
          >
            Create
          </button>
        </div>
      </div>
    </div>
  );
}

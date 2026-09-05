"use client";

/**
 * SkillsDialog — 浏览 / 管理所有可用 Skill 技能包（文件夹级）。
 *
 * 一个 skill = 一个完整文件夹：SKILL.md（YAML frontmatter + 正文）+
 * scripts/ references/ assets/ 支撑文件，可声明 dependencies 依赖其他 skill。
 *
 * - 卡片：名称 + 描述 + 版本 + 文件数 + 依赖徽章（绿=就绪 / 红=缺依赖）
 * - 展开：SKILL.md 渲染、支撑文件树（查看/编辑/删除/新增）、单包导出 .zip
 * - 导入：.zip 文件夹包 / 直接选文件夹 / JSON 备份；导出：JSON 全量备份
 * - 数据来自 src/lib/skills（IndexedDB 独立存储）+ skills/transfer（zip）
 */

import { useEffect, useRef, useState } from "react";
import {
  X,
  Sparkles,
  ChevronDown,
  ChevronRight,
  Download,
  Upload,
  FolderUp,
  Plus,
  Pencil,
  Trash2,
  Check,
  Package,
  AlertTriangle,
  GitBranch,
  FilePlus2,
} from "lucide-react";
import {
  listSkills,
  loadSkill,
  onSkillsChange,
  createSkill,
  removeSkill,
  exportSkills,
  importSkills,
  updateSkillFile,
  deleteSkillFile,
  parseSkillMarkdown,
  type Skill,
  type SkillMeta,
} from "@/lib/skills";
import { importSkillsFromZip, importSkillsFromDirectory, exportSkillZip } from "@/lib/skills/transfer";
import { FileTypeIcon } from "@/lib/file-icon";
import { MarkdownRenderer } from "./terminal";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

const SOURCE_LABEL: Record<Skill["source"], string> = {
  builtin: "内置",
  custom: "自定义",
};

/** 导出的备份文件结构（导入兼容 v1 单文件 / v2 文件夹两种 schema）。 */
const EXPORT_KIND = "opencode-skills";
const EXPORT_VERSION = 2;

function fmtSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** 依赖徽章：绿 = 已就绪，红 = 缺失。 */
function DepChip({ dep, ok }: { dep: string; ok: boolean }) {
  return (
    <span
      title={ok ? `依赖 ${dep} 已就绪` : `依赖 ${dep} 未安装`}
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-mono text-[10px] font-medium",
        ok
          ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
          : "bg-[#E54D2E]/10 text-[#E54D2E]",
      )}
    >
      {ok ? <Check className="h-2.5 w-2.5" /> : <AlertTriangle className="h-2.5 w-2.5" />}
      {dep}
    </span>
  );
}

export function SkillsDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  // 实时刷新：依赖打开状态 + 自定义 skill 版本（AI create/delete skill 会 bump），
  // 任一变化都重查列表。
  const [metas, setMetas] = useState<SkillMeta[]>([]);
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void listSkills().then((list) => {
      if (!cancelled) setMetas(list);
    });
    return () => {
      cancelled = true;
    };
  }, [open]);
  // 订阅 skill 变化（AI 创建/删除自定义 skill 时 bump）→ 实时刷新
  useEffect(() => {
    if (!open) return;
    const unsub = onSkillsChange(() => {
      void listSkills().then(setMetas);
    });
    return () => unsub();
  }, [open]);
  // 展开的 skill 及其完整内容（含文件树，懒加载）
  const [expanded, setExpanded] = useState<string | null>(null);
  const [details, setDetails] = useState<Record<string, Skill>>({});

  // ── UI 新建 / 编辑 SKILL.md / 支撑文件管理 / 导入 ──
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newContent, setNewContent] = useState("");
  const [newDeps, setNewDeps] = useState("");
  const [editing, setEditing] = useState<string | null>(null); // 正在编辑 SKILL.md 的自定义 skill 名
  const [editContent, setEditContent] = useState("");
  // 支撑文件：查看 / 编辑 / 新增
  const [viewingFile, setViewingFile] = useState<{ skill: string; path: string } | null>(null);
  const [fileContents, setFileContents] = useState<Record<string, string>>({});
  const [editingFile, setEditingFile] = useState<{ skill: string; path: string } | null>(null);
  const [editFileContent, setEditFileContent] = useState("");
  const [addingFile, setAddingFile] = useState<string | null>(null); // skill 名
  const [newFilePath, setNewFilePath] = useState("");
  const [newFileContent, setNewFileContent] = useState("");
  const [importing, setImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null); // .json / .zip
  const dirInputRef = useRef<HTMLInputElement>(null); // 文件夹上传

  const refresh = () => void listSkills().then(setMetas);
  const reloadAll = () => {
    refresh();
    setDetails({});
    setExpanded(null);
    setEditing(null);
    setEditingFile(null);
    setViewingFile(null);
  };

  const toggle = (name: string) => {
    if (expanded === name) {
      setExpanded(null);
      setEditing(null);
      setEditingFile(null);
      setViewingFile(null);
      return;
    }
    setExpanded(name);
    setEditing(null);
    setEditingFile(null);
    setViewingFile(null);
    if (!details[name]) {
      void loadSkill(name).then((skill) => {
        if (skill) setDetails((d) => ({ ...d, [name]: skill }));
      });
    }
  };

  // ── 导入结果统一提示（含缺依赖警告）──
  const reportImport = (results: { name: string; status: string; error?: string; fileCount?: number; dependencies?: string[] }[]) => {
    const added = results.filter((r) => r.status === "added");
    const invalid = results.filter((r) => r.status === "invalid");
    reloadAll();
    if (added.length === 0 && invalid.length > 0) {
      toast.error(`导入失败：${invalid[0].error ?? "格式不正确"}`);
      return;
    }
    if (invalid.length > 0) {
      toast.warning(`导入完成：新增 ${added.length} · 失败 ${invalid.length}（${invalid[0].error ?? ""}）`);
    } else {
      toast.success(`导入完成：新增 ${added.length} 个 skill${added.some((a) => (a.fileCount ?? 1) > 1) ? "（含支撑文件）" : ""}`);
    }
    // 缺依赖检查：等刷新后对新增 skill 逐个看 missingDependencies
    void listSkills().then((all) => {
      const problems = all.filter(
        (m) => added.some((a) => a.name === m.name) && m.missingDependencies.length > 0,
      );
      if (problems.length > 0) {
        toast.warning(
          `缺依赖：${problems.map((m) => `${m.name} 缺 ${m.missingDependencies.join("/")}`).join("；")} —— 导入对应 skill 包即可补齐`,
          { duration: 8000 },
        );
      }
    });
  };

  // ── 导入：.json 备份 / .zip 文件夹包（一个入口按扩展名分发）──
  const handleImportFile = (file: File) => {
    if (/\.zip$/i.test(file.name)) {
      setImporting(true);
      importSkillsFromZip(file)
        .then((report) => reportImport(report.results))
        .catch((e) => toast.error(`导入 zip 失败：${e instanceof Error ? e.message : String(e)}`))
        .finally(() => setImporting(false));
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => toast.error("读取文件失败");
    reader.onload = async () => {
      try {
        const parsed = JSON.parse(String(reader.result ?? ""));
        if (parsed?.kind !== EXPORT_KIND || ![1, 2].includes(parsed?.version) || !Array.isArray(parsed.skills)) {
          toast.error("文件格式不正确（缺少 opencode-skills 结构）");
          return;
        }
        const results = await importSkills(parsed.skills);
        reportImport(results);
      } catch (e) {
        toast.error(`导入失败：${e instanceof Error ? e.message : String(e)}`);
      }
    };
    reader.readAsText(file);
  };

  // ── 导入：文件夹上传（webkitRelativePath → 内存 zip → 统一管线）──
  const handleImportDirectory = async (files: File[]) => {
    if (files.length === 0) return;
    setImporting(true);
    try {
      const report = await importSkillsFromDirectory(
        files.map((f) => ({ relPath: f.webkitRelativePath || f.name, file: f })),
      );
      reportImport(report.results);
    } catch (e) {
      toast.error(`导入文件夹失败：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setImporting(false);
    }
  };

  // ── 导出 ──
  const handleExport = async () => {
    const list = await exportSkills();
    if (list.length === 0) {
      toast.info("没有可导出的自定义 skill（内置 skill 随程序嵌入，不导出）");
      return;
    }
    const payload = {
      kind: EXPORT_KIND,
      version: EXPORT_VERSION,
      exportedAt: new Date().toISOString(),
      skills: list,
    };
    triggerDownload(
      new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }),
      "skills-backup.json",
    );
    toast.success(`已导出 ${list.length} 个自定义 skill → skills-backup.json`);
  };

  // ── 单 skill 导出为 .zip 文件夹包（专业分发格式）──
  const handleExportZip = async (name: string) => {
    const skill = details[name] ?? (await loadSkill(name));
    if (!skill) return;
    const { blob, filename } = await exportSkillZip(skill.name, skill.files);
    triggerDownload(blob, filename);
    toast.success(`已导出 skill 文件夹包 → ${filename}`);
  };

  // ── 新建 ──
  const submitCreate = async () => {
    const deps = newDeps.split(/[,，\s]+/).map((s) => s.trim()).filter(Boolean);
    const res = await createSkill(newName.trim(), newContent, { dependencies: deps });
    if (!res.ok) {
      toast.error(`新建失败：${res.error ?? ""}`);
      return;
    }
    toast.success(`已创建 Skill：${res.name}`);
    setCreating(false);
    setNewName("");
    setNewContent("");
    setNewDeps("");
    reloadAll();
  };

  // ── 编辑 SKILL.md（编辑的是含 frontmatter 的全文；支撑文件保留）──
  const startEdit = (name: string) => {
    const detail = details[name];
    setEditing(name);
    setEditContent(detail ? (detail.files["SKILL.md"]?.content ?? detail.body) : "");
  };
  const saveEdit = async (name: string) => {
    const prev = details[name];
    const prevDeps = prev?.dependencies ?? [];
    const parsed = parseSkillMarkdown(editContent);
    // 有 frontmatter → 以编辑后的 dependencies 为准（删掉即清除）；
    // 无 frontmatter → 保留既有依赖，避免误删
    const deps = parsed.frontmatter ? parsed.dependencies : prevDeps;
    const res = await createSkill(name, editContent, { dependencies: deps });
    if (!res.ok) {
      toast.error(`保存失败：${res.error ?? ""}`);
      return;
    }
    toast.success(`已保存 Skill：${name}`);
    setEditing(null);
    reloadAll();
  };

  // ── 支撑文件：查看 / 编辑 / 删除 / 新增 ──
  const fileKey = (skill: string, path: string) => `${skill}::${path}`;
  const viewFile = (skill: string, path: string, content: string, encoding: string) => {
    if (encoding === "base64") {
      setFileContents((c) => ({
        ...c,
        [fileKey(skill, path)]: "[二进制文件 — 内容以 base64 存储，随 .zip 导出后可用本地工具打开]",
      }));
    } else {
      setFileContents((c) => ({ ...c, [fileKey(skill, path)]: content }));
    }
    setViewingFile({ skill, path });
  };
  const startEditFile = (skill: string, path: string, content: string) => {
    setEditingFile({ skill, path });
    setEditFileContent(content);
  };
  const saveEditFile = async () => {
    if (!editingFile) return;
    const res = await updateSkillFile(editingFile.skill, editingFile.path, editFileContent);
    if (!res.ok) {
      toast.error(`保存失败：${res.error ?? ""}`);
      return;
    }
    toast.success(`已保存 ${editingFile.path}`);
    const { skill, path } = editingFile;
    setEditingFile(null);
    // 刷新该 skill 的详情
    void loadSkill(skill).then((s) => {
      if (s) setDetails((d) => ({ ...d, [skill]: s }));
      setFileContents((c) => ({ ...c, [fileKey(skill, path)]: editFileContent }));
    });
    refresh();
  };
  const handleDeleteFile = async (skill: string, path: string) => {
    if (!window.confirm(`删除支撑文件「${path}」？此操作不可撤销。`)) return;
    const res = await deleteSkillFile(skill, path);
    if (!res.ok) {
      toast.error(`删除失败：${res.error ?? ""}`);
      return;
    }
    toast.success(`已删除 ${path}`);
    void loadSkill(skill).then((s) => {
      if (s) setDetails((d) => ({ ...d, [skill]: s }));
    });
    refresh();
  };
  const submitAddFile = async () => {
    if (!addingFile) return;
    const res = await updateSkillFile(addingFile, newFilePath.trim(), newFileContent);
    if (!res.ok) {
      toast.error(`添加失败：${res.error ?? ""}`);
      return;
    }
    toast.success(`已添加 ${newFilePath.trim()}`);
    const skill = addingFile;
    setAddingFile(null);
    setNewFilePath("");
    setNewFileContent("");
    void loadSkill(skill).then((s) => {
      if (s) setDetails((d) => ({ ...d, [skill]: s }));
    });
    refresh();
  };

  // ── 删除（自定义 → 移除；内置 → 隐藏），提示反向依赖 ──
  const handleDelete = async (m: SkillMeta) => {
    const what = m.source === "builtin" ? `隐藏内置 skill「${m.name}」` : `删除自定义 skill「${m.name}」`;
    const depWarn = m.dependents.length > 0 ? `注意：${m.dependents.join("、")} 声明依赖它，删除后这些 skill 将缺依赖。` : "";
    if (!window.confirm(`确定要${what}吗？${m.source === "builtin" ? "内置 skill 不可物理删除，将被隐藏。" : "整个文件夹（含支撑文件）将被移除，此操作不可撤销。"}${depWarn}`)) return;
    await removeSkill(m.name);
    toast.success(m.source === "builtin" ? `已隐藏内置 skill「${m.name}」` : `已删除自定义 skill「${m.name}」`);
    reloadAll();
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <input
        ref={fileInputRef}
        type="file"
        accept=".json,application/json,.zip"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) handleImportFile(f);
          e.target.value = ""; // 允许重复选择同一文件
        }}
      />
      <input
        ref={dirInputRef}
        type="file"
        multiple
        className="hidden"
        {...({ webkitdirectory: "", directory: "" } as Record<string, string>)}
        onChange={(e) => {
          const files = e.target.files ? Array.from(e.target.files) : [];
          if (files.length > 0) void handleImportDirectory(files);
          e.target.value = "";
        }}
      />
      <div className="flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-lg border border-[#DEDEDE] bg-[#FFFFFF] text-[#262626] shadow-2xl dark:border-[#333333] dark:bg-[#161616] dark:text-zinc-100">
        {/* Header */}
        <div className="flex items-center gap-2 border-b border-[#DEDEDE] px-5 py-4 dark:border-[#333333]">
          <Sparkles className="h-5 w-5 text-[#E58F67]" />
          <h2 className="text-lg font-semibold">Skills · 技能包</h2>
          <span className="ml-1 flex items-center gap-1">
            <button
              onClick={() => fileInputRef.current?.click()}
              title="导入 .zip 文件夹包或 JSON 备份"
              className="flex items-center gap-1 rounded border border-[#DEDEDE] px-2 py-1 text-[11px] text-[#383838] transition-colors hover:bg-[#F0F0F0] dark:border-[#333333] dark:text-zinc-300 dark:hover:bg-[#2A2A2A]"
            >
              <Upload className="h-3 w-3" />
              {importing ? "导入中…" : "导入"}
            </button>
            <button
              onClick={() => dirInputRef.current?.click()}
              title="直接选择一个 skill 文件夹上传"
              className="flex items-center gap-1 rounded border border-[#DEDEDE] px-2 py-1 text-[11px] text-[#383838] transition-colors hover:bg-[#F0F0F0] dark:border-[#333333] dark:text-zinc-300 dark:hover:bg-[#2A2A2A]"
            >
              <FolderUp className="h-3 w-3" />
              选文件夹
            </button>
            <button
              onClick={() => void handleExport()}
              title="导出全部自定义 skill 为 JSON 备份（含支撑文件）"
              className="flex items-center gap-1 rounded border border-[#DEDEDE] px-2 py-1 text-[11px] text-[#383838] transition-colors hover:bg-[#F0F0F0] dark:border-[#333333] dark:text-zinc-300 dark:hover:bg-[#2A2A2A]"
            >
              <Download className="h-3 w-3" />
              导出
            </button>
            <button
              onClick={() => {
                setCreating((c) => !c);
                setEditing(null);
              }}
              className="flex items-center gap-1 rounded border border-[#E58F67]/50 bg-[#E58F67]/10 px-2 py-1 text-[11px] text-[#E58F67] transition-colors hover:bg-[#E58F67]/20"
            >
              <Plus className="h-3 w-3" />
              新建
            </button>
          </span>
          <button
            onClick={onClose}
            className="ml-auto rounded p-1.5 text-[#8C8C8C] hover:bg-[#F0F0F0] hover:text-[#383838] dark:text-zinc-500 dark:hover:bg-[#2A2A2A] dark:hover:text-zinc-200"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Hint */}
        <div className="border-b border-[#DEDEDE] px-5 py-2 text-[11px] text-[#8C8C8C] dark:border-[#333333] dark:text-zinc-500">
          每个 Skill 是一个完整文件夹：<span className="font-mono text-[#E58F67]">SKILL.md</span> + 支撑文件
          （references / scripts / assets），可声明 dependencies 依赖其他 skill（加载时自动连带）。
          支持 .zip 文件夹包导入导出；AI 也可通过 create_skill / read_skill_file 操作。
        </div>

        {/* Skill list */}
        <div className="flex-1 overflow-y-auto px-5 py-4 [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-[#D4D4D4] dark:[&::-webkit-scrollbar-thumb]:bg-[#333333]">
          {/* 新建表单 */}
          {creating && (
            <div className="mb-4 rounded-lg border border-[#E58F67]/40 bg-[#FAFAFA] p-4 dark:border-[#E58F67]/30 dark:bg-[#0A0A0A]">
              <div className="mb-2 text-xs font-semibold text-[#6B6B6B] dark:text-zinc-400">新建 Skill</div>
              <div className="mb-2 flex gap-2">
                <input
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="skill 名称（字母数字点横线下划线，≤64）"
                  className="w-1/2 rounded border border-[#DEDEDE] bg-[#FFFFFF] px-3 py-2 font-mono text-sm focus:border-[#E58F67] focus:outline-none dark:border-[#333333] dark:bg-[#0A0A0A] dark:text-zinc-100"
                />
                <input
                  value={newDeps}
                  onChange={(e) => setNewDeps(e.target.value)}
                  placeholder="依赖的其他 skill（逗号分隔，可空）"
                  className="w-1/2 rounded border border-[#DEDEDE] bg-[#FFFFFF] px-3 py-2 font-mono text-sm focus:border-[#E58F67] focus:outline-none dark:border-[#333333] dark:bg-[#0A0A0A] dark:text-zinc-100"
                />
              </div>
              <textarea
                value={newContent}
                onChange={(e) => setNewContent(e.target.value)}
                placeholder={"# Skill 标题\n\n技能说明与指令（Markdown）。可在正文引用 references/ 下的支撑文件；\n创建后在卡片里添加支撑文件，或用 frontmatter 声明 dependencies。"}
                rows={6}
                className="mb-2 w-full rounded border border-[#DEDEDE] bg-[#FFFFFF] px-3 py-2 font-mono text-sm focus:border-[#E58F67] focus:outline-none dark:border-[#333333] dark:bg-[#0A0A0A] dark:text-zinc-100"
              />
              <div className="flex justify-end gap-2">
                <button
                  onClick={() => { setCreating(false); setNewName(""); setNewContent(""); setNewDeps(""); }}
                  className="rounded border border-[#DEDEDE] px-3 py-1.5 text-xs text-[#8C8C8C] hover:bg-[#F0F0F0] dark:border-[#333333] dark:text-zinc-400 dark:hover:bg-[#2A2A2A]"
                >
                  取消
                </button>
                <button
                  onClick={() => void submitCreate()}
                  disabled={!newName.trim() || !newContent.trim()}
                  className="flex items-center gap-1 rounded bg-[#E58F67] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#c96a45] disabled:opacity-40"
                >
                  <Check className="h-3 w-3" />
                  创建
                </button>
              </div>
            </div>
          )}

          {metas.length === 0 ? (
            <div className="rounded border border-dashed border-[#DEDEDE] px-4 py-8 text-center text-xs text-[#8C8C8C] dark:border-[#333333] dark:text-zinc-500">
              暂无可用 Skill。
            </div>
          ) : (
            <div className="space-y-2">
              {metas.map((m) => {
                const isOpen = expanded === m.name;
                const detail = details[m.name];
                const isEditing = editing === m.name && m.source === "custom";
                const supportFiles = detail
                  ? Object.entries(detail.files).filter(([p]) => !/^SKILL\.md$/i.test(p)).sort(([a], [b]) => a.localeCompare(b))
                  : [];
                return (
                  <div
                    key={m.name}
                    className={cn(
                      "overflow-hidden rounded-lg border transition-colors",
                      isOpen
                        ? "border-[#E58F67]/40 bg-[#FAFAFA] dark:border-[#E58F67]/30 dark:bg-[#0A0A0A]"
                        : "border-[#DEDEDE] bg-[#FFFFFF] hover:border-[#D4D4D4] dark:border-[#333333] dark:bg-[#161616] dark:hover:border-[#4D4D4D]",
                    )}
                  >
                    <button
                      onClick={() => toggle(m.name)}
                      className="flex w-full items-center gap-3 px-4 py-3 text-left"
                    >
                      {isOpen ? (
                        <ChevronDown className="h-4 w-4 shrink-0 text-[#E58F67]" />
                      ) : (
                        <ChevronRight className="h-4 w-4 shrink-0 text-[#8C8C8C] dark:text-zinc-500" />
                      )}
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-[#E58F67]/10">
                        <Sparkles className="h-4 w-4 text-[#E58F67]" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-1.5">
                          <span className="font-mono text-sm font-semibold text-[#262626] dark:text-zinc-100">
                            {m.name}
                          </span>
                          {m.version && (
                            <span className="rounded bg-[#E58F67]/10 px-1 py-0.5 font-mono text-[10px] text-[#E58F67]">
                              v{m.version}
                            </span>
                          )}
                          <span
                            title="文件夹内文件总数（含 SKILL.md）"
                            className="inline-flex items-center gap-0.5 rounded bg-zinc-100 px-1 py-0.5 text-[10px] text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400"
                          >
                            <Package className="h-2.5 w-2.5" />
                            {m.fileCount} 文件
                          </span>
                        </span>
                        <span className="mt-0.5 block truncate text-xs text-[#6B6B6B] dark:text-zinc-400">
                          {m.description}
                        </span>
                      </span>
                      <span
                        className={cn(
                          "shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold",
                          m.source === "builtin"
                            ? "bg-[#E58F67]/10 text-[#E58F67]"
                            : "bg-zinc-200 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400",
                        )}
                      >
                        {SOURCE_LABEL[m.source]}
                      </span>
                      {m.source === "custom" && (
                        <span
                          role="button"
                          onClick={(ev) => {
                            ev.stopPropagation();
                            void handleDelete(m);
                          }}
                          title="删除自定义 skill（整个文件夹）"
                          className="shrink-0 rounded p-1.5 text-[#A6A6A6] transition-colors hover:bg-[#E54D2E]/10 hover:text-[#E54D2E]"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </span>
                      )}
                    </button>
                    {isOpen && (
                      <div className="space-y-3 border-t border-[#DEDEDE] px-4 py-3 dark:border-[#333333]">
                        {/* 依赖行 */}
                        {m.dependencies.length > 0 && (
                          <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-[#6B6B6B] dark:text-zinc-400">
                            <GitBranch className="h-3 w-3 shrink-0 text-[#8C8C8C]" />
                            <span>依赖：</span>
                            {m.dependencies.map((dep) => (
                              <DepChip key={dep} dep={dep} ok={!m.missingDependencies.includes(dep)} />
                            ))}
                          </div>
                        )}
                        {m.dependents.length > 0 && (
                          <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-[#6B6B6B] dark:text-zinc-400">
                            <span className="font-mono">←</span>
                            <span>被依赖：{m.dependents.join("、")}</span>
                          </div>
                        )}

                        {/* SKILL.md 正文 / 编辑 */}
                        {isEditing ? (
                          <div>
                            <textarea
                              value={editContent}
                              onChange={(e) => setEditContent(e.target.value)}
                              rows={10}
                              className="mb-2 w-full rounded border border-[#DEDEDE] bg-[#FFFFFF] px-3 py-2 font-mono text-sm focus:border-[#E58F67] focus:outline-none dark:border-[#333333] dark:bg-[#0A0A0A] dark:text-zinc-100"
                            />
                            <div className="flex justify-end gap-2">
                              <button
                                onClick={() => setEditing(null)}
                                className="rounded border border-[#DEDEDE] px-3 py-1.5 text-xs text-[#8C8C8C] hover:bg-[#F0F0F0] dark:border-[#333333] dark:text-zinc-400 dark:hover:bg-[#2A2A2A]"
                              >
                                取消
                              </button>
                              <button
                                onClick={() => void saveEdit(m.name)}
                                disabled={!editContent.trim()}
                                className="flex items-center gap-1 rounded bg-[#E58F67] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#c96a45] disabled:opacity-40"
                              >
                                <Check className="h-3 w-3" />
                                保存（支撑文件保留）
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div className="rounded-md border border-[#E5E5E5] bg-[#FFFFFF] px-3 py-2 dark:border-[#262626] dark:bg-[#111111]">
                            <MarkdownRenderer text={detail ? detail.body : "加载中…"} />
                          </div>
                        )}

                        {/* 支撑文件树 */}
                        {(supportFiles.length > 0 || m.source === "custom") && (
                          <div>
                            <div className="mb-1 flex items-center justify-between">
                              <span className="text-[11px] font-semibold text-[#6B6B6B] dark:text-zinc-400">
                                支撑文件（{supportFiles.length}）
                              </span>
                              {m.source === "custom" && (
                                <button
                                  onClick={() => {
                                    setAddingFile(addingFile === m.name ? null : m.name);
                                    setNewFilePath("");
                                    setNewFileContent("");
                                  }}
                                  className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-[#E58F67] transition-colors hover:bg-[#E58F67]/10"
                                >
                                  <FilePlus2 className="h-3 w-3" />
                                  添加文件
                                </button>
                              )}
                            </div>
                            {addingFile === m.name && (
                              <div className="mb-2 rounded-md border border-[#E58F67]/40 bg-[#FAFAFA] p-2.5 dark:border-[#E58F67]/30 dark:bg-[#0A0A0A]">
                                <input
                                  value={newFilePath}
                                  onChange={(e) => setNewFilePath(e.target.value)}
                                  placeholder="相对路径，如 references/api.md 或 scripts/run.lua"
                                  className="mb-1.5 w-full rounded border border-[#DEDEDE] bg-[#FFFFFF] px-2 py-1.5 font-mono text-xs focus:border-[#E58F67] focus:outline-none dark:border-[#333333] dark:bg-[#0A0A0A] dark:text-zinc-100"
                                />
                                <textarea
                                  value={newFileContent}
                                  onChange={(e) => setNewFileContent(e.target.value)}
                                  rows={4}
                                  placeholder="文件内容（文本）"
                                  className="mb-1.5 w-full rounded border border-[#DEDEDE] bg-[#FFFFFF] px-2 py-1.5 font-mono text-xs focus:border-[#E58F67] focus:outline-none dark:border-[#333333] dark:bg-[#0A0A0A] dark:text-zinc-100"
                                />
                                <div className="flex justify-end gap-1.5">
                                  <button
                                    onClick={() => setAddingFile(null)}
                                    className="rounded border border-[#DEDEDE] px-2 py-1 text-[11px] text-[#8C8C8C] hover:bg-[#F0F0F0] dark:border-[#333333] dark:text-zinc-400 dark:hover:bg-[#2A2A2A]"
                                  >
                                    取消
                                  </button>
                                  <button
                                    onClick={() => void submitAddFile()}
                                    disabled={!newFilePath.trim() || !newFileContent.trim()}
                                    className="flex items-center gap-1 rounded bg-[#E58F67] px-2 py-1 text-[11px] font-semibold text-white hover:bg-[#c96a45] disabled:opacity-40"
                                  >
                                    <Check className="h-2.5 w-2.5" />
                                    添加
                                  </button>
                                </div>
                              </div>
                            )}
                            {supportFiles.length === 0 && addingFile !== m.name ? (
                              <div className="rounded border border-dashed border-[#DEDEDE] px-3 py-2 text-[11px] text-[#A6A6A6] dark:border-[#333333] dark:text-zinc-600">
                                暂无支撑文件——AI 可用 create_skill 的 files 参数创建 references/ scripts/ 等文件。
                              </div>
                            ) : (
                              <div className="overflow-hidden rounded-md border border-[#E5E5E5] dark:border-[#262626]">
                                {supportFiles.map(([path, f]) => {
                                  const key = fileKey(m.name, path);
                                  const isViewing = viewingFile?.skill === m.name && viewingFile.path === path;
                                  const isFileEditing = editingFile?.skill === m.name && editingFile.path === path;
                                  return (
                                    <div key={path} className="border-b border-[#EDEDED] last:border-b-0 dark:border-[#222222]">
                                      <div className="flex items-center gap-2 px-2.5 py-1.5">
                                        <FileTypeIcon path={path} className="h-3.5 w-3.5 shrink-0 text-[#C08A5F] dark:text-[#E8A87C]" />
                                        <button
                                          onClick={() =>
                                            isViewing
                                              ? setViewingFile(null)
                                              : viewFile(m.name, path, f.content, f.encoding)
                                          }
                                          className="min-w-0 flex-1 truncate text-left font-mono text-xs text-[#383838] transition-colors hover:text-[#E58F67] dark:text-zinc-300 dark:hover:text-[#E8A87C]"
                                          title={isViewing ? "收起" : "查看内容"}
                                        >
                                          {path}
                                        </button>
                                        <span className="shrink-0 text-[10px] text-[#A6A6A6] dark:text-zinc-600">
                                          {f.encoding === "base64" ? "binary" : fmtSize(f.content.length)}
                                        </span>
                                        {m.source === "custom" && f.encoding === "text" && (
                                          <span
                                            role="button"
                                            onClick={(ev) => {
                                              ev.stopPropagation();
                                              if (isFileEditing) setEditingFile(null);
                                              else startEditFile(m.name, path, f.content);
                                            }}
                                            title="编辑"
                                            className="shrink-0 rounded p-1 text-[#A6A6A6] transition-colors hover:bg-[#F0F0F0] hover:text-[#383838] dark:hover:bg-[#2A2A2A] dark:hover:text-zinc-200"
                                          >
                                            <Pencil className="h-3 w-3" />
                                          </span>
                                        )}
                                        {m.source === "custom" && (
                                          <span
                                            role="button"
                                            onClick={(ev) => {
                                              ev.stopPropagation();
                                              void handleDeleteFile(m.name, path);
                                            }}
                                            title="删除文件"
                                            className="shrink-0 rounded p-1 text-[#A6A6A6] transition-colors hover:bg-[#E54D2E]/10 hover:text-[#E54D2E]"
                                          >
                                            <Trash2 className="h-3 w-3" />
                                          </span>
                                        )}
                                      </div>
                                      {isFileEditing && (
                                        <div className="px-2.5 pb-2.5">
                                          <textarea
                                            value={editFileContent}
                                            onChange={(e) => setEditFileContent(e.target.value)}
                                            rows={8}
                                            className="mb-1.5 w-full rounded border border-[#DEDEDE] bg-[#FFFFFF] px-2 py-1.5 font-mono text-xs focus:border-[#E58F67] focus:outline-none dark:border-[#333333] dark:bg-[#0A0A0A] dark:text-zinc-100"
                                          />
                                          <div className="flex justify-end gap-1.5">
                                            <button
                                              onClick={() => setEditingFile(null)}
                                              className="rounded border border-[#DEDEDE] px-2 py-1 text-[11px] text-[#8C8C8C] hover:bg-[#F0F0F0] dark:border-[#333333] dark:text-zinc-400 dark:hover:bg-[#2A2A2A]"
                                            >
                                              取消
                                            </button>
                                            <button
                                              onClick={() => void saveEditFile()}
                                              className="flex items-center gap-1 rounded bg-[#E58F67] px-2 py-1 text-[11px] font-semibold text-white hover:bg-[#c96a45]"
                                            >
                                              <Check className="h-2.5 w-2.5" />
                                              保存
                                            </button>
                                          </div>
                                        </div>
                                      )}
                                      {isViewing && !isFileEditing && (
                                        <pre className="mx-2.5 mb-2.5 max-h-64 overflow-auto rounded bg-[#F7F7F7] px-2.5 py-2 font-mono text-[11px] leading-relaxed text-[#383838] dark:bg-[#0D0D0D] dark:text-zinc-300 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-[#D4D4D4] dark:[&::-webkit-scrollbar-thumb]:bg-[#333333]">
                                          {fileContents[key] ?? "加载中…"}
                                        </pre>
                                      )}
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        )}

                        {/* 操作行 */}
                        <div className="flex items-center gap-2 border-t border-[#DEDEDE] pt-2.5 dark:border-[#262626]">
                          <button
                            onClick={() => void handleExportZip(m.name)}
                            className="flex items-center gap-1 rounded border border-[#DEDEDE] px-2.5 py-1.5 text-[11px] text-[#383838] transition-colors hover:bg-[#F0F0F0] dark:border-[#333333] dark:text-zinc-300 dark:hover:bg-[#2A2A2A]"
                          >
                            <Download className="h-3 w-3" />
                            导出 .zip
                          </button>
                          {m.source === "custom" && (
                            <button
                              onClick={() => startEdit(m.name)}
                              className="flex items-center gap-1 rounded border border-[#DEDEDE] px-2.5 py-1.5 text-[11px] text-[#383838] transition-colors hover:bg-[#F0F0F0] dark:border-[#333333] dark:text-zinc-300 dark:hover:bg-[#2A2A2A]"
                            >
                              <Pencil className="h-3 w-3" />
                              编辑 SKILL.md
                            </button>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Storage + 管理说明 */}
          <div className="mt-4 rounded-md border border-[#DEDEDE] bg-[#FAFAFA] px-3 py-2 text-[11px] text-[#8C8C8C] dark:border-[#333333] dark:bg-[#262626] dark:text-zinc-500">
            <div className="mb-1">
              <span className="font-semibold text-[#6B6B6B] dark:text-zinc-400">存储位置：</span>
              <span className="text-[#E58F67]">内置</span> skill 随程序内置；自定义 skill（含全部支撑文件）存于独立的浏览器存储，与文件袋互不影响——清空文件袋不会丢失。
              导出 JSON 会备份全部自定义 skill；单个 skill 的分发用「导出 .zip」。
            </div>
            <div>
              导入支持三种方式：.zip 文件夹包（推荐，兼容 anthropic/skills 仓库布局）、直接选文件夹、JSON 备份。
              内置 skill 只能隐藏、不能物理删除。AI 可用{" "}
              <span className="font-mono text-[#E58F67]">create_skill</span> /{" "}
              <span className="font-mono text-[#E58F67]">read_skill_file</span> /{" "}
              <span className="font-mono text-[#E58F67]">delete_skill</span> 管理。
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

"use client";

/**
 * SkillsDialog — 浏览所有可用 Skill 技能包。
 *
 * 卡片式列表：每个 skill 显示图标 + 名称 + 描述 + 来源徽章（内置/自定义）；
 * 点击卡片展开查看 SKILL.md 全文（Markdown 渲染）。
 * 数据来自 src/lib/skills 的 listSkills() / loadSkill()。
 */

import { useEffect, useRef, useState } from "react";
import {
  X,
  Sparkles,
  ChevronDown,
  ChevronRight,
  Download,
  Upload,
  Plus,
  Pencil,
  Trash2,
  Check,
} from "lucide-react";
import {
  listSkills,
  loadSkill,
  onSkillsChange,
  createSkill,
  removeSkill,
  exportSkills,
  importSkills,
  type Skill,
  type SkillMeta,
} from "@/lib/skills";
import { MarkdownRenderer } from "./terminal";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

const SOURCE_LABEL: Record<Skill["source"], string> = {
  builtin: "内置",
  custom: "自定义",
};

/** 导出的备份文件结构（与导入对应同一 schema）。 */
const EXPORT_KIND = "opencode-skills";
const EXPORT_VERSION = 1;

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
  // 展开的 skill 及其完整内容（懒加载）
  const [expanded, setExpanded] = useState<string | null>(null);
  const [details, setDetails] = useState<Record<string, Skill>>({});

  // ── UI 新建 / 编辑 / 删除 / 导入 ──
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newContent, setNewContent] = useState("");
  const [editing, setEditing] = useState<string | null>(null); // 正在编辑的自定义 skill 名
  const [editContent, setEditContent] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const refresh = () => void listSkills().then(setMetas);
  const reloadAll = () => {
    refresh();
    setDetails({});
    setExpanded(null);
    setEditing(null);
  };

  const toggle = (name: string) => {
    if (expanded === name) {
      setExpanded(null);
      setEditing(null);
      return;
    }
    setExpanded(name);
    setEditing(null);
    if (!details[name]) {
      void loadSkill(name).then((skill) => {
        if (skill) setDetails((d) => ({ ...d, [name]: skill }));
      });
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
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "skills-backup.json";
    a.click();
    URL.revokeObjectURL(url);
    toast.success(`已导出 ${list.length} 个自定义 skill → skills-backup.json`);
  };

  // ── 导入 ──
  const handleImportFile = (file: File) => {
    const reader = new FileReader();
    reader.onerror = () => toast.error("读取文件失败");
    reader.onload = async () => {
      try {
        const parsed = JSON.parse(String(reader.result ?? ""));
        if (parsed?.kind !== EXPORT_KIND || parsed?.version !== EXPORT_VERSION || !Array.isArray(parsed.skills)) {
          toast.error("文件格式不正确（缺少 opencode-skills 结构）");
          return;
        }
        const results = await importSkills(parsed.skills);
        const added = results.filter((r) => r.status === "added").length;
        const invalid = results.filter((r) => r.status === "invalid").length;
        reloadAll();
        toast.success(
          invalid > 0
            ? `导入完成：新增 ${added} · 跳过 ${invalid}`
            : `导入完成：新增 ${added} 个自定义 skill`,
        );
      } catch (e) {
        toast.error(`导入失败：${e instanceof Error ? e.message : String(e)}`);
      }
    };
    reader.readAsText(file);
  };

  // ── 新建 ──
  const submitCreate = async () => {
    const res = await createSkill(newName, newContent);
    if (!res.ok) {
      toast.error(`新建失败：${res.error ?? ""}`);
      return;
    }
    toast.success(`已创建 Skill：${res.name}`);
    setCreating(false);
    setNewName("");
    setNewContent("");
    reloadAll();
  };

  // ── 编辑 ──
  const startEdit = (name: string) => {
    const detail = details[name];
    setEditing(name);
    setEditContent(detail?.content ?? "");
  };
  const saveEdit = async (name: string) => {
    const res = await createSkill(name, editContent); // 同名覆盖
    if (!res.ok) {
      toast.error(`保存失败：${res.error ?? ""}`);
      return;
    }
    toast.success(`已保存 Skill：${name}`);
    setEditing(null);
    reloadAll();
  };

  // ── 删除（自定义 → 移除；内置 → 隐藏） ──
  const handleDelete = async (m: SkillMeta) => {
    const what = m.source === "builtin" ? `隐藏内置 skill「${m.name}」` : `删除自定义 skill「${m.name}」`;
    if (!window.confirm(`确定要${what}吗？${m.source === "builtin" ? "内置 skill 不可物理删除，将被隐藏。" : "此操作不可撤销。"}`)) return;
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
        accept=".json,application/json"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) handleImportFile(f);
          e.target.value = ""; // 允许重复选择同一文件
        }}
      />
      <div className="flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-lg border border-[#E5E2D9] bg-[#FFFFFF] text-[#2D2B27] shadow-2xl dark:border-[#3a3731] dark:bg-[#1c1a17] dark:text-zinc-100">
        {/* Header */}
        <div className="flex items-center gap-2 border-b border-[#E5E2D9] px-5 py-4 dark:border-[#3a3731]">
          <Sparkles className="h-5 w-5 text-[#E58F67]" />
          <h2 className="text-lg font-semibold">Skills · 技能包</h2>
          <span className="ml-1 flex items-center gap-1">
            <button
              onClick={() => void handleExport()}
              title="导出自定义 skill 为 JSON 备份"
              className="flex items-center gap-1 rounded border border-[#E5E2D9] px-2 py-1 text-[11px] text-[#3D3B37] transition-colors hover:bg-[#F0EDE5] dark:border-[#3a3731] dark:text-zinc-300 dark:hover:bg-[#2a2723]"
            >
              <Download className="h-3 w-3" />
              导出
            </button>
            <button
              onClick={() => fileInputRef.current?.click()}
              title="从 JSON 备份导入自定义 skill"
              className="flex items-center gap-1 rounded border border-[#E5E2D9] px-2 py-1 text-[11px] text-[#3D3B37] transition-colors hover:bg-[#F0EDE5] dark:border-[#3a3731] dark:text-zinc-300 dark:hover:bg-[#2a2723]"
            >
              <Upload className="h-3 w-3" />
              导入
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
            className="ml-auto rounded p-1.5 text-[#8B8884] hover:bg-[#F0EDE5] hover:text-[#3D3B37] dark:text-zinc-500 dark:hover:bg-[#2a2723] dark:hover:text-zinc-200"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Hint */}
        <div className="border-b border-[#E5E2D9] px-5 py-2 text-[11px] text-[#8B8884] dark:border-[#3a3731] dark:text-zinc-500">
          技能包可由 AI 通过 <span className="font-mono text-[#E58F67]">create_skill</span> 创建、<span className="font-mono text-[#E58F67]">delete_skill</span> 删除；也可在此新建 / 编辑 / 导入导出。点击卡片查看完整内容。
        </div>

        {/* Skill list */}
        <div className="flex-1 overflow-y-auto px-5 py-4 [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-[#D6D3CE] dark:[&::-webkit-scrollbar-thumb]:bg-[#3a3731]">
          {/* 新建表单 */}
          {creating && (
            <div className="mb-4 rounded-lg border border-[#E58F67]/40 bg-[#FAF9F7] p-4 dark:border-[#E58F67]/30 dark:bg-[#161512]">
              <div className="mb-2 text-xs font-semibold text-[#6B6862] dark:text-zinc-400">新建 Skill</div>
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="skill 名称（字母数字点横线下划线，≤64）"
                className="mb-2 w-full rounded border border-[#E5E2D9] bg-[#FFFFFF] px-3 py-2 font-mono text-sm focus:border-[#E58F67] focus:outline-none dark:border-[#3a3731] dark:bg-[#161512] dark:text-zinc-100"
              />
              <textarea
                value={newContent}
                onChange={(e) => setNewContent(e.target.value)}
                placeholder={"# Skill 标题\n\n填写技能说明与指令（Markdown）。首行 # 标题会成为列表里的描述。"}
                rows={6}
                className="mb-2 w-full rounded border border-[#E5E2D9] bg-[#FFFFFF] px-3 py-2 font-mono text-sm focus:border-[#E58F67] focus:outline-none dark:border-[#3a3731] dark:bg-[#161512] dark:text-zinc-100"
              />
              <div className="flex justify-end gap-2">
                <button
                  onClick={() => { setCreating(false); setNewName(""); setNewContent(""); }}
                  className="rounded border border-[#E5E2D9] px-3 py-1.5 text-xs text-[#8B8884] hover:bg-[#F0EDE5] dark:border-[#3a3731] dark:text-zinc-400 dark:hover:bg-[#2a2723]"
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
            <div className="rounded border border-dashed border-[#E5E2D9] px-4 py-8 text-center text-xs text-[#8B8884] dark:border-[#3a3731] dark:text-zinc-500">
              暂无可用 Skill。
            </div>
          ) : (
            <div className="space-y-2">
              {metas.map((m) => {
                const isOpen = expanded === m.name;
                const detail = details[m.name];
                const isEditing = editing === m.name && m.source === "custom";
                return (
                  <div
                    key={m.name}
                    className={cn(
                      "overflow-hidden rounded-lg border transition-colors",
                      isOpen
                        ? "border-[#E58F67]/40 bg-[#FAF9F7] dark:border-[#E58F67]/30 dark:bg-[#161512]"
                        : "border-[#E5E2D9] bg-[#FFFFFF] hover:border-[#D6D3CE] dark:border-[#3a3731] dark:bg-[#1c1a17] dark:hover:border-[#52504b]",
                    )}
                  >
                    <button
                      onClick={() => toggle(m.name)}
                      className="flex w-full items-center gap-3 px-4 py-3 text-left"
                    >
                      {isOpen ? (
                        <ChevronDown className="h-4 w-4 shrink-0 text-[#E58F67]" />
                      ) : (
                        <ChevronRight className="h-4 w-4 shrink-0 text-[#8B8884] dark:text-zinc-500" />
                      )}
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-[#E58F67]/10">
                        <Sparkles className="h-4 w-4 text-[#E58F67]" />
                      </span>
                      <span className="flex-1">
                        <span className="block font-mono text-sm font-semibold text-[#2D2B27] dark:text-zinc-100">
                          {m.name}
                        </span>
                        <span className="mt-0.5 block text-xs text-[#6B6862] dark:text-zinc-400">
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
                          title="删除自定义 skill"
                          className="shrink-0 rounded p-1.5 text-[#A8A29E] transition-colors hover:bg-[#E54D2E]/10 hover:text-[#E54D2E]"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </span>
                      )}
                    </button>
                    {isOpen && (
                      <div className="border-t border-[#E5E2D9] px-4 py-3 dark:border-[#3a3731]">
                        {isEditing ? (
                          <div>
                            <textarea
                              value={editContent}
                              onChange={(e) => setEditContent(e.target.value)}
                              rows={10}
                              className="mb-2 w-full rounded border border-[#E5E2D9] bg-[#FFFFFF] px-3 py-2 font-mono text-sm focus:border-[#E58F67] focus:outline-none dark:border-[#3a3731] dark:bg-[#161512] dark:text-zinc-100"
                            />
                            <div className="flex justify-end gap-2">
                              <button
                                onClick={() => setEditing(null)}
                                className="rounded border border-[#E5E2D9] px-3 py-1.5 text-xs text-[#8B8884] hover:bg-[#F0EDE5] dark:border-[#3a3731] dark:text-zinc-400 dark:hover:bg-[#2a2723]"
                              >
                                取消
                              </button>
                              <button
                                onClick={() => void saveEdit(m.name)}
                                disabled={!editContent.trim()}
                                className="flex items-center gap-1 rounded bg-[#E58F67] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#c96a45] disabled:opacity-40"
                              >
                                <Check className="h-3 w-3" />
                                保存
                              </button>
                            </div>
                          </div>
                        ) : (
                          <>
                            <MarkdownRenderer text={detail ? detail.content : "加载中…"} />
                            {m.source === "custom" && (
                              <div className="mt-3 flex justify-end">
                                <button
                                  onClick={() => startEdit(m.name)}
                                  className="flex items-center gap-1 rounded border border-[#E5E2D9] px-3 py-1.5 text-xs text-[#3D3B37] hover:bg-[#F0EDE5] dark:border-[#3a3731] dark:text-zinc-300 dark:hover:bg-[#2a2723]"
                                >
                                  <Pencil className="h-3 w-3" />
                                  编辑
                                </button>
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Storage + 管理说明 */}
          <div className="mt-4 rounded-md border border-[#E5E2D9] bg-[#FAF9F7] px-3 py-2 text-[11px] text-[#8B8884] dark:border-[#3a3731] dark:bg-[#262320] dark:text-zinc-500">
            <div className="mb-1">
              <span className="font-semibold text-[#6B6862] dark:text-zinc-400">存储位置：</span>
              <span className="text-[#E58F67]">内置</span> skill 随程序内置，不在文件袋；自定义 skill 存于独立的浏览器存储，与文件袋内容互不影响——清空文件袋不会丢失。
              {" "}导出会备份全部自定义 skill（内置不导出）。
            </div>
            <div>
              导入 / 新建 / 编辑作用于自定义 skill；内置 skill 只能隐藏、不能物理删除。AI 也可用{" "}
              <span className="font-mono text-[#E58F67]">create_skill</span> /{" "}
              <span className="font-mono text-[#E58F67]">delete_skill</span> 管理。
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

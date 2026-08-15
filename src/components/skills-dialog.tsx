"use client";

/**
 * SkillsDialog — 浏览所有可用 Skill 技能包。
 *
 * 卡片式列表：每个 skill 显示图标 + 名称 + 描述 + 来源徽章（内置/自定义）；
 * 点击卡片展开查看 SKILL.md 全文（Markdown 渲染）。
 * 数据来自 src/lib/skills 的 listSkills() / loadSkill()。
 */

import { useEffect, useState } from "react";
import { X, Sparkles, ChevronDown, ChevronRight } from "lucide-react";
import { listSkills, loadSkill, type Skill, type SkillMeta } from "@/lib/skills";
import { useVfsView } from "@/store/vfs-view";
import { MarkdownRenderer } from "./terminal";
import { cn } from "@/lib/utils";

const SOURCE_LABEL: Record<Skill["source"], string> = {
  builtin: "内置",
  custom: "自定义",
};

export function SkillsDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  // 实时刷新：依赖 VFS 版本（AI create_skill/delete_skill 会 bump）+ 弹窗打开，
  // 任一变化都重查 skill 列表（自定义 skill 增删、隐藏名单变化都能反映）。
  const vfsVersion = useVfsView((s) => s.version);
  const [metas, setMetas] = useState<SkillMeta[]>([]);
  useEffect(() => {
    if (open) setMetas(listSkills());
  }, [open, vfsVersion]);
  // 展开的 skill 及其完整内容（懒加载）
  const [expanded, setExpanded] = useState<string | null>(null);
  const [details, setDetails] = useState<Record<string, Skill>>({});

  const toggle = (name: string) => {
    if (expanded === name) {
      setExpanded(null);
      return;
    }
    setExpanded(name);
    if (!details[name]) {
      const skill = loadSkill(name);
      if (skill) setDetails((d) => ({ ...d, [name]: skill }));
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-lg border border-[#E5E2D9] bg-[#FFFFFF] text-[#2D2B27] shadow-2xl dark:border-[#3a3731] dark:bg-[#1c1a17] dark:text-zinc-100">
        {/* Header */}
        <div className="flex items-center gap-2 border-b border-[#E5E2D9] px-5 py-4 dark:border-[#3a3731]">
          <Sparkles className="h-5 w-5 text-[#E58F67]" />
          <h2 className="text-lg font-semibold">Skills · 技能包</h2>
          <button
            onClick={onClose}
            className="ml-auto rounded p-1.5 text-[#8B8884] hover:bg-[#F0EDE5] hover:text-[#3D3B37] dark:text-zinc-500 dark:hover:bg-[#2a2723] dark:hover:text-zinc-200"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Hint */}
        <div className="border-b border-[#E5E2D9] px-5 py-2 text-[11px] text-[#8B8884] dark:border-[#3a3731] dark:text-zinc-500">
          技能包可由 AI 通过 <span className="font-mono text-[#E58F67]">create_skill</span> 创建、<span className="font-mono text-[#E58F67]">delete_skill</span> 删除；点击卡片查看完整内容。
        </div>

        {/* Skill list */}
        <div className="flex-1 overflow-y-auto px-5 py-4 [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-[#D6D3CE] dark:[&::-webkit-scrollbar-thumb]:bg-[#3a3731]">
          {metas.length === 0 ? (
            <div className="rounded border border-dashed border-[#E5E2D9] px-4 py-8 text-center text-xs text-[#8B8884] dark:border-[#3a3731] dark:text-zinc-500">
              暂无可用 Skill。
            </div>
          ) : (
            <div className="space-y-2">
              {metas.map((m) => {
                const isOpen = expanded === m.name;
                const detail = details[m.name];
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
                    </button>
                    {isOpen && (
                      <div className="border-t border-[#E5E2D9] px-4 py-3 dark:border-[#3a3731]">
                        {detail ? (
                          <MarkdownRenderer text={detail.content} />
                        ) : (
                          <div className="animate-pulse text-xs text-[#8B8884] dark:text-zinc-500">
                            加载中…
                          </div>
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
              <span className="text-[#E58F67]">内置</span> skill 随程序内置，不在文件袋；AI 用{" "}
              <span className="font-mono text-[#E58F67]">create_skill</span> 创建的自定义 skill 才会出现在文件袋的{" "}
              <span className="font-mono text-[#E58F67]">skills/&lt;名称&gt;/SKILL.md</span>。
            </div>
            <div>
              AI 可用 <span className="font-mono text-[#E58F67]">delete_skill</span> 删除自定义 skill（移除目录）或隐藏内置 skill。
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";
import { MotionConfig } from "framer-motion";
import { Terminal } from "@/components/terminal";
import { FileBag } from "@/components/file-bag";
import { SettingsDialog } from "@/components/settings-dialog";
import { HelpDialog } from "@/components/help-dialog";
import { SkillsDialog } from "@/components/skills-dialog";
import {
  Settings,
  CirclePlus,
  BookOpen,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  Trash2,
  MoreHorizontal,
  Sparkles,
  Search,
  FolderOpen,
  X,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { hasPersistentMasterKey } from "@/lib/api-key-vault";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from "@/components/ui/alert-dialog";
import { useSession } from "@/store/session";
import { useVfsView } from "@/store/vfs-view";
import type { SessionMeta } from "@/lib/session-storage";
import { cn } from "@/lib/utils";

function formatRelativeTime(ts: number): string {
  const diff = Date.now() - ts;
  const m = Math.floor(diff / 60_000);
  if (m < 1) return "刚刚";
  if (m < 60) return `${m} 分钟前`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} 小时前`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d} 天前`;
  return new Date(ts).toLocaleDateString("zh-CN");
}

function SessionRow({
  session,
  active,
  onSwitch,
  onRename,
  onDelete,
}: {
  session: SessionMeta;
  active?: boolean;
  onSwitch: () => void;
  onRename: (title: string) => void;
  onDelete: () => void;
}) {
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(session.title);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const commitRename = () => {
    const t = draft.trim();
    if (t && t !== session.title) onRename(t);
    setRenaming(false);
  };

  return (
    <div
      onClick={onSwitch}
      className={cn(
        "group flex cursor-pointer items-center gap-2 rounded-lg px-3 py-1.5 text-[13px] text-[#6B6B6B] transition-colors hover:bg-white hover:text-[#262626] dark:text-zinc-400 dark:hover:bg-[#262626] dark:hover:text-zinc-200",
        active && "bg-white text-[#262626] hover:bg-white hover:text-[#262626] dark:bg-[#2A2A2A] dark:text-zinc-100 dark:hover:bg-[#2A2A2A] dark:hover:text-zinc-100",
      )}
    >
      {/* 当前会话左侧圆点指示（ZCode 式） */}
      <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", active ? "bg-[#E58F67]" : "bg-transparent")} />
      {renaming ? (
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitRename}
          onKeyDown={(e) => {
            if (e.key === "Enter") commitRename();
            if (e.key === "Escape") setRenaming(false);
          }}
          onClick={(e) => e.stopPropagation()}
          className="w-full min-w-0 rounded border border-[#E58F67]/50 bg-white px-1.5 py-0.5 text-xs focus:outline-none dark:bg-[#161616] dark:text-zinc-100"
        />
      ) : (
        <span className="min-w-0 truncate">{session.title || "新会话"}</span>
      )}
      <span className="ml-auto shrink-0 text-[10px] text-[#A6A6A6] dark:text-zinc-500">{formatRelativeTime(session.updatedAt)}</span>
      {!renaming && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              onClick={(e) => e.stopPropagation()}
              className="shrink-0 rounded p-0.5 text-[#A6A6A6] transition-colors hover:bg-[#F0F0F0] hover:text-[#262626] dark:text-zinc-500 dark:hover:bg-[#2A2A2A] dark:hover:text-zinc-200"
              title="更多操作"
            >
              <MoreHorizontal className="h-3.5 w-3.5" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-[120px]">
            <DropdownMenuItem
              onClick={(e) => {
                e.stopPropagation();
                setDraft(session.title);
                setRenaming(true);
              }}
            >
              <Pencil className="h-3.5 w-3.5" /> 重命名
            </DropdownMenuItem>
            <DropdownMenuItem
              className="text-red-500 focus:text-red-500"
              onClick={(e) => {
                e.stopPropagation();
                setConfirmOpen(true);
              }}
            >
              <Trash2 className="h-3.5 w-3.5" /> 删除
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除这个会话？</AlertDialogTitle>
            <AlertDialogDescription>
              “{session.title || "新会话"}” 将被永久删除，此操作无法撤销。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={(e) => e.stopPropagation()}>取消</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-500 text-white hover:bg-red-600"
              onClick={(e) => {
                e.stopPropagation();
                setConfirmOpen(false);
                onDelete();
              }}
            >
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export default function Home() {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [skillsOpen, setSkillsOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [, setPanelDirection] = useState<"horizontal" | "vertical">("horizontal");
  const init = useSession((s) => s.init);
  const config = useSession((s) => s.config);
  const sessionId = useSession((s) => s.sessionId);
  const title = useSession((s) => s.title);
  const rightPanelOpen = useVfsView((s) => s.rightPanelOpen);
  const setRightPanelOpen = useVfsView((s) => s.setRightPanelOpen);
  const sessions = useSession((s) => s.sessions);
  const newSession = useSession((s) => s.newSession);
  const switchSession = useSession((s) => s.switchSession);
  const deleteSession = useSession((s) => s.deleteSession);
  const renameSession = useSession((s) => s.renameSession);

  useEffect(() => {
    init();
    // 仅"从未配置过 Key"才首次弹设置；有持久化主密钥/Key → 静默打开
    // （Key 已在 init 的 tryRestore 中从 localStorage 恢复，无需重填）。
    const shouldOpen = !hasPersistentMasterKey();
    /* eslint-disable react-hooks/set-state-in-effect */
    if (shouldOpen) setSettingsOpen(true);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [init]);

  // 开发者签名（Copilot CLI 式的烙印）：打开 DevTools 即见
  useEffect(() => {
    console.log(
      "%cOpen Code Web %c· 浏览器里的 AI 编程工作台\n%chttps://github.com/5849mog/OpenCodeCLI%c · 所有文件与密钥都留在你的浏览器里",
      "color:#E58F67;font-weight:bold;font-size:12px",
      "color:#8a8a8a;font-size:12px",
      "color:#8a8a8a;font-size:11px",
      "color:#8a8a8a;font-size:11px",
    );
  }, []);

  // ZCode 式快捷键：⌘N / Ctrl+N 新建任务，⌘K / Ctrl+K 搜索会话
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      if (e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearchOpen(true);
      } else if (e.key.toLowerCase() === "n") {
        e.preventDefault();
        void newSession();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [newSession]);

  // Responsive: sidebar collapses by default below desktop breakpoint
  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(max-width: 80rem)");
    const handler = (e: MediaQueryListEvent | MediaQueryList) => {
      setSidebarCollapsed(e.matches);
    };
    mq.addEventListener("change", handler);
    handler(mq);
    return () => mq.removeEventListener("change", handler);
  }, []);

  // Responsive: panel direction switches to vertical on tablet
  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(max-width: 64rem)");
    const handler = (e: MediaQueryListEvent | MediaQueryList) => {
      const isVertical = e.matches;
      setPanelDirection(isVertical ? "vertical" : "horizontal");
    };
    mq.addEventListener("change", handler);
    handler(mq);
    return () => mq.removeEventListener("change", handler);
  }, []);

  return (
    <MotionConfig reducedMotion="user">
      <div className="flex h-screen bg-background">
      {/* Left sidebar — conversation list, collapsible.
          手机（<md）：展开态是覆盖层抽屉；桌面：常驻 288px 列 */}
      <aside
        className={cn(
          "flex flex-col border-r border-[#DEDEDE] bg-[#F5F5F5] transition-all duration-200 ease-in-out dark:border-sidebar-border dark:bg-sidebar",
          sidebarCollapsed
            ? "w-14 shrink-0"
            : "fixed inset-y-0 left-0 z-40 w-[86vw] max-w-[300px] shadow-2xl md:static md:z-auto md:w-72 md:max-w-none md:shrink-0 md:shadow-none",
        )}
      >
        {sidebarCollapsed ? (
          /* Collapsed: icon-only sidebar */
          <>
            <div className="flex flex-col items-center gap-3 px-3 py-4">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#E58F67] text-sm font-bold text-white shadow-sm">
                {"</>"}
              </div>
              {/* Expand button */}
              <button
                onClick={() => setSidebarCollapsed(false)}
                className="touch-target flex items-center justify-center rounded-lg text-[#8C8C8C] hover:bg-white hover:text-[#262626] dark:text-zinc-500 dark:hover:bg-[#262626] dark:hover:text-zinc-200"
                title="展开侧边栏"
              >
                <PanelLeftOpen className="h-4 w-4" />
              </button>
              {/* 手机端快捷：新建任务 / 搜索会话（抽屉两跳的捷径） */}
              <button
                onClick={() => void newSession()}
                className="touch-target flex items-center justify-center rounded-lg text-[#8C8C8C] hover:bg-white hover:text-[#262626] dark:text-zinc-500 dark:hover:bg-[#262626] dark:hover:text-zinc-200"
                title="新建任务 (⌘N / Ctrl+N)"
              >
                <CirclePlus className="h-4 w-4" />
              </button>
              <button
                onClick={() => {
                  setSidebarCollapsed(false);
                  setSearchOpen(true);
                }}
                className="touch-target flex items-center justify-center rounded-lg text-[#8C8C8C] hover:bg-white hover:text-[#262626] dark:text-zinc-500 dark:hover:bg-[#262626] dark:hover:text-zinc-200"
                title="搜索会话"
              >
                <Search className="h-4 w-4" />
              </button>
            </div>
            <div className="flex-1" />
            <div className="flex flex-col items-center gap-2 border-t border-[#DEDEDE] px-3 py-4 dark:border-sidebar-border">
              <button
                onClick={() => setSettingsOpen(true)}
                className="touch-target flex items-center justify-center rounded-lg text-[#8C8C8C] hover:bg-white hover:text-[#262626] dark:text-zinc-500 dark:hover:bg-[#262626] dark:hover:text-zinc-200"
                title="设置"
              >
                <Settings className="h-4 w-4" />
              </button>
              <button
                onClick={() => setHelpOpen(true)}
                className="touch-target flex items-center justify-center rounded-lg text-[#8C8C8C] hover:bg-white hover:text-[#262626] dark:text-zinc-500 dark:hover:bg-[#262626] dark:hover:text-zinc-200"
                title="帮助"
              >
                <BookOpen className="h-4 w-4" />
              </button>
              <button
                onClick={() => setSkillsOpen(true)}
                className="touch-target flex items-center justify-center rounded-lg text-[#8C8C8C] hover:bg-white hover:text-[#262626] dark:text-zinc-500 dark:hover:bg-[#262626] dark:hover:text-zinc-200"
                title="Skills 技能包"
              >
                <Sparkles className="h-4 w-4" />
              </button>
            </div>
          </>
        ) : (
          /* Expanded: full sidebar */
          <>
            {/* 顶部：仅折叠按钮（ZCode 无顶部品牌块，品牌在底部用户区） */}
            <div className="flex justify-end px-2.5 pb-1 pt-2.5">
              <button
                onClick={() => setSidebarCollapsed(true)}
                className="touch-target flex items-center justify-center rounded-lg p-1.5 text-[#8C8C8C] hover:bg-white hover:text-[#262626] dark:text-zinc-500 dark:hover:bg-[#262626] dark:hover:text-zinc-200"
                title="折叠侧边栏"
              >
                <PanelLeftClose className="h-4 w-4" />
              </button>
            </div>

            {/* 顶部导航：新建任务 ⌘N / 搜索 ⌘K / 插件市场（ZCode 式，带快捷键提示） */}
            <div className="flex flex-col gap-0.5 px-2 pb-2">
              <button
                onClick={() => void newSession()}
                className="group flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-[#6B6B6B] transition-colors hover:bg-white hover:text-[#262626] dark:text-zinc-400 dark:hover:bg-[#2A2A2A] dark:hover:text-zinc-200"
              >
                <CirclePlus className="h-4 w-4 shrink-0" />
                新建任务
                <span className="ml-auto text-[10px] text-[#A6A6A6] dark:text-zinc-600 dark:group-hover:text-zinc-400">⌘N</span>
              </button>
              <button
                onClick={() => {
                  setSearchOpen((v) => !v);
                  if (searchOpen) setSearchQuery("");
                }}
                className={cn(
                  "group flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors hover:bg-white hover:text-[#262626] dark:hover:bg-[#2A2A2A] dark:hover:text-zinc-200",
                  searchOpen ? "text-[#E58F67]" : "text-[#6B6B6B] dark:text-zinc-400",
                )}
              >
                <Search className="h-4 w-4 shrink-0" />
                搜索
                <span
                  className={cn(
                    "ml-auto text-[10px] text-[#A6A6A6] dark:text-zinc-600 dark:group-hover:text-zinc-400",
                    searchOpen && "text-[#E58F67]/70 dark:text-[#E58F67]/70",
                  )}
                >
                  ⌘K
                </span>
              </button>
              <button
                onClick={() => setSkillsOpen(true)}
                className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-[#6B6B6B] transition-colors hover:bg-white hover:text-[#262626] dark:text-zinc-400 dark:hover:bg-[#2A2A2A] dark:hover:text-zinc-200"
              >
                <Sparkles className="h-4 w-4 shrink-0" />
                Skill
              </button>
              <button
                onClick={() => useVfsView.getState().setRightPanelOpen(!rightPanelOpen)}
                className={cn(
                  "flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors hover:bg-white hover:text-[#262626] dark:hover:bg-[#2A2A2A] dark:hover:text-zinc-200",
                  rightPanelOpen ? "text-[#E58F67]" : "text-[#6B6B6B] dark:text-zinc-400",
                )}
              >
                <FolderOpen className="h-4 w-4 shrink-0" />
                文件袋
              </button>
              {searchOpen && (
                <div className="mt-1 flex items-center gap-2 rounded-lg border border-[#DEDEDE] bg-white px-2.5 py-1.5 dark:border-[#333333] dark:bg-[#161616]">
                  <Search className="h-3.5 w-3.5 shrink-0 text-[#A6A6A6] dark:text-zinc-500" />
                  <input
                    autoFocus
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Escape") {
                        setSearchOpen(false);
                        setSearchQuery("");
                      }
                    }}
                    placeholder="按标题过滤会话…"
                    className="w-full min-w-0 bg-transparent text-xs text-[#262626] placeholder:text-[#A6A6A6] focus:outline-none dark:text-zinc-200 dark:placeholder:text-zinc-500"
                  />
                  <button
                    onClick={() => {
                      setSearchOpen(false);
                      setSearchQuery("");
                    }}
                    className="shrink-0 rounded p-0.5 text-[#A6A6A6] hover:text-[#262626] dark:text-zinc-500 dark:hover:text-zinc-200"
                    title="关闭搜索"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              )}
            </div>

            {/* 会话列表 —— 直接平铺（无项目/任务分组），当前会话置顶高亮 */}
            <div className="flex-1 overflow-y-auto px-2 py-2">
              {(() => {
                const q = searchQuery.trim().toLowerCase();
                // 当前会话可能还没写入 sessions 列表（首条消息前）——兜底一个伪 meta，保证它始终显示
                const fromList = sessions.find((s) => s.id === sessionId);
                const current: SessionMeta =
                  fromList ?? {
                    id: sessionId,
                    title: title || "新会话",
                    createdAt: Date.now(),
                    updatedAt: Date.now(),
                    totalTokens: 0,
                    messageCount: 0,
                  };
                const rest = sessions
                  .filter((s) => s.id !== sessionId)
                  .sort((a, b) => b.updatedAt - a.updatedAt);
                const ordered = [current, ...rest];
                const list = q
                  ? ordered.filter((s) => (s.title || "新会话").toLowerCase().includes(q))
                  : ordered;
                if (list.length === 0) {
                  return (
                    <div className="px-2 py-3 text-xs text-[#A6A6A6] dark:text-zinc-500">
                      没有匹配的会话
                    </div>
                  );
                }
                return (
                  <div className="space-y-0.5">
                    {list.map((s) => (
                      <SessionRow
                        key={s.id}
                        session={s}
                        active={s.id === sessionId}
                        onSwitch={() => void switchSession(s.id)}
                        onRename={(t) => void renameSession(s.id, t)}
                        onDelete={() => void deleteSession(s.id)}
                      />
                    ))}
                  </div>
                );
              })()}
            </div>

            {/* 底部用户区：头像 + 名称 + 设置（ZCode 式）；未配 Key 时保留配置入口 */}
            <div className="border-t border-[#DEDEDE] px-2.5 py-2.5 dark:border-sidebar-border">
              <div className="flex items-center gap-2.5 px-1">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#E58F67] text-[10px] font-bold text-white">
                  {"</>"}
                </div>
                <span className="min-w-0 truncate text-[13px] text-[#262626] dark:text-zinc-100">Open Code</span>
                <button
                  onClick={() => setSettingsOpen(true)}
                  className="ml-auto flex shrink-0 items-center justify-center rounded-lg p-1.5 text-[#8C8C8C] transition-colors hover:bg-white hover:text-[#262626] dark:text-zinc-500 dark:hover:bg-[#262626] dark:hover:text-zinc-200"
                  title="设置"
                >
                  <Settings className="h-4 w-4" />
                </button>
              </div>
              {!config.hasApiKey && (
                <button
                  onClick={() => setSettingsOpen(true)}
                  className="mt-2 w-full rounded-lg border border-[#E58F67]/30 bg-[#E58F67]/5 px-3 py-1.5 text-[10px] text-[#E58F67] hover:bg-[#E58F67]/10"
                >
                  配置 API Key
                </button>
              )}
            </div>
          </>
        )}
      </aside>

      {/* 手机端抽屉遮罩：点击关闭（桌面 md:hidden 不显示） */}
      {!sidebarCollapsed && (
        <div
          className="fixed inset-0 z-30 bg-black/50 md:hidden"
          onClick={() => setSidebarCollapsed(true)}
        />
      )}

      {/* Main area — terminal + file bag */}
      <main className="min-w-0 flex-1">
        <div className="flex h-full min-w-0">
          <div className="min-w-0 flex-1">
            <Terminal />
          </div>
          {/* 右栏：默认隐藏，顶部右上角按钮滑入
              手机（<md）：全视口浮层抽屉；桌面：常驻 380px 列 */}
          <div
            className={cn(
              "h-full shrink-0 overflow-hidden transition-[width] duration-300 ease-out",
              rightPanelOpen
                ? "fixed inset-y-0 right-0 z-40 w-[92vw] max-w-[380px] shadow-2xl md:static md:z-auto md:w-[380px] md:max-w-none md:shadow-none"
                : "w-0",
            )}
          >
            <div className="h-full w-[380px] max-w-[90vw]">
              <FileBag />
            </div>
          </div>
          {rightPanelOpen && (
            <div
              className="fixed inset-0 z-30 bg-black/50 md:hidden"
              onClick={() => setRightPanelOpen(false)}
            />
          )}
        </div>
      </main>

      <SettingsDialog
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
      />
      <HelpDialog
        open={helpOpen}
        onOpenChange={setHelpOpen}
      />
      <SkillsDialog
        open={skillsOpen}
        onClose={() => setSkillsOpen(false)}
      />
      </div>
    </MotionConfig>
  );
}

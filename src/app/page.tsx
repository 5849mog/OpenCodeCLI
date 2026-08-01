"use client";

import { useEffect, useState } from "react";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { Terminal } from "@/components/terminal";
import { FileBag } from "@/components/file-bag";
import { SettingsDialog } from "@/components/settings-dialog";
import { HelpDialog } from "@/components/help-dialog";
import {
  Settings,
  Plus,
  MessageSquare,
  BookOpen,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  Trash2,
  MoreHorizontal,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
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
import type { SessionMeta } from "@/lib/session-storage";
import { vfs } from "@/lib/vfs";
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
  onSwitch,
  onRename,
  onDelete,
}: {
  session: SessionMeta;
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
        "group flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-[#2D2B27]",
        "cursor-pointer hover:bg-white",
      )}
    >
      <MessageSquare className="h-3.5 w-3.5 shrink-0 text-[#A8A29E]" />
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
          className="w-full min-w-0 rounded border border-[#D97757]/50 bg-white px-1.5 py-0.5 text-xs focus:outline-none"
        />
      ) : (
        <span className="truncate">{session.title || "新会话"}</span>
      )}
      <span className="ml-auto shrink-0 text-[10px] text-[#A8A29E]">{formatRelativeTime(session.updatedAt)}</span>
      {!renaming && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              onClick={(e) => e.stopPropagation()}
              className="shrink-0 rounded p-0.5 text-[#A8A29E] transition-colors hover:bg-[#F0EDE5] hover:text-[#2D2B27]"
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
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [panelDirection, setPanelDirection] = useState<"horizontal" | "vertical">("horizontal");
  const init = useSession((s) => s.init);
  const config = useSession((s) => s.config);
  const sessionId = useSession((s) => s.sessionId);
  const title = useSession((s) => s.title);
  const sessions = useSession((s) => s.sessions);
  const newSession = useSession((s) => s.newSession);
  const switchSession = useSession((s) => s.switchSession);
  const deleteSession = useSession((s) => s.deleteSession);
  const renameSession = useSession((s) => s.renameSession);
  const [fileCount, setFileCount] = useState(0);

  useEffect(() => {
    init();
    const stored = localStorage.getItem("opencode-web.config");
    let shouldOpen = !stored;
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        shouldOpen = !parsed.apiKey && !parsed.hasApiKey;
      } catch {
        shouldOpen = true;
      }
    }
    /* eslint-disable react-hooks/set-state-in-effect */
    if (shouldOpen) setSettingsOpen(true);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [init]);

  useEffect(() => {
    const update = () => setFileCount(vfs.allSync().filter((n) => n.type === "file").length);
    update();
    const interval = setInterval(update, 800);
    return () => clearInterval(interval);
  }, []);

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
    <div className="flex h-screen bg-[#FAF9F7]">
      {/* Left sidebar — conversation list, collapsible */}
      <aside
        className={cn(
          "flex flex-col border-r border-[#E5E2D9] bg-[#F5F3EE] transition-all duration-200 ease-in-out",
          sidebarCollapsed ? "w-14 shrink-0" : "w-56 shrink-0"
        )}
      >
        {sidebarCollapsed ? (
          /* Collapsed: icon-only sidebar */
          <>
            <div className="flex flex-col items-center gap-3 px-3 py-4">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#D97757] text-sm font-bold text-white shadow-sm">
                {"</>"}
              </div>
              {/* Expand button */}
              <button
                onClick={() => setSidebarCollapsed(false)}
                className="touch-target flex items-center justify-center rounded-lg text-[#8B8884] hover:bg-white hover:text-[#2D2B27]"
                title="展开侧边栏"
              >
                <PanelLeftOpen className="h-4 w-4" />
              </button>
            </div>
            <div className="flex-1" />
            <div className="flex flex-col items-center gap-2 border-t border-[#E5E2D9] px-3 py-4">
              <button
                onClick={() => setSettingsOpen(true)}
                className="touch-target flex items-center justify-center rounded-lg text-[#8B8884] hover:bg-white hover:text-[#2D2B27]"
                title="设置"
              >
                <Settings className="h-4 w-4" />
              </button>
              <button
                onClick={() => setHelpOpen(true)}
                className="touch-target flex items-center justify-center rounded-lg text-[#8B8884] hover:bg-white hover:text-[#2D2B27]"
                title="帮助"
              >
                <BookOpen className="h-4 w-4" />
              </button>
            </div>
          </>
        ) : (
          /* Expanded: full sidebar */
          <>
            {/* Brand + collapse button */}
            <div className="flex items-center justify-between px-4 py-4">
              <div className="flex items-center gap-2.5">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#D97757] text-sm font-bold text-white shadow-sm">
                  {"</>"}
                </div>
                <span className="text-sm font-medium text-[#2D2B27]" style={{ fontFamily: "var(--font-fraunces), serif" }}>
                  Open Code
                </span>
              </div>
              <button
                onClick={() => setSidebarCollapsed(true)}
                className="touch-target flex items-center justify-center rounded-lg text-[#8B8884] hover:bg-white hover:text-[#2D2B27]"
                title="折叠侧边栏"
              >
                <PanelLeftClose className="h-4 w-4" />
              </button>
            </div>

            {/* New chat button */}
            <div className="px-3 pb-2">
              <button
                onClick={() => void newSession()}
                className="flex w-full items-center gap-2 rounded-lg border border-[#E5E2D9] bg-white px-3 py-2 text-sm text-[#6B6862] transition-colors hover:border-[#D97757]/30 hover:text-[#D97757]"
              >
                <Plus className="h-4 w-4" />
                新任务
              </button>
            </div>

            {/* Conversation list */}
            <div className="flex-1 overflow-y-auto px-2 py-2">
              <div className="mb-1 px-2 text-[10px] font-semibold uppercase tracking-wider text-[#A8A29E]">
                会话
              </div>
              {/* Current session */}
              <div className="flex items-center gap-2 rounded-lg bg-[#D97757]/8 px-3 py-2 text-sm text-[#2D2B27]">
                <MessageSquare className="h-3.5 w-3.5 shrink-0 text-[#D97757]" />
                <span className="truncate">{title || "新会话"}</span>
                {config.hasApiKey && (
                  <span className="ml-auto text-[10px] text-[#A8A29E]">{config.model}</span>
                )}
              </div>
              {/* History sessions */}
              <div className="mb-1 mt-3 px-2 text-[10px] font-semibold uppercase tracking-wider text-[#A8A29E]">
                历史会话
              </div>
              {sessions.filter((s) => s.id !== sessionId).length === 0 ? (
                <div className="px-2 py-3 text-xs text-[#A8A29E]">暂无历史会话</div>
              ) : (
                <div className="space-y-0.5">
                  {sessions
                    .filter((s) => s.id !== sessionId)
                    .map((s) => (
                      <SessionRow
                        key={s.id}
                        session={s}
                        onSwitch={() => void switchSession(s.id)}
                        onRename={(t) => void renameSession(s.id, t)}
                        onDelete={() => void deleteSession(s.id)}
                      />
                    ))}
                </div>
              )}
            </div>

            {/* Bottom controls */}
            <div className="border-t border-[#E5E2D9] p-2">
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setSettingsOpen(true)}
                  className="flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs text-[#8B8884] hover:bg-white hover:text-[#2D2B27]"
                >
                  <Settings className="h-3.5 w-3.5" />
                  <span>设置</span>
                </button>
                <button
                  onClick={() => setHelpOpen(true)}
                  className="flex items-center justify-center rounded-lg px-3 py-2 text-[#8B8884] hover:bg-white hover:text-[#2D2B27]"
                >
                  <BookOpen className="h-3.5 w-3.5" />
                </button>
              </div>
              {config.hasApiKey ? (
                <div className="mt-2 flex items-center gap-1.5 px-3 py-1 text-[10px] text-[#8B7355]">
                  <span className="h-1.5 w-1.5 rounded-full bg-[#D97757]" />
                  {config.model} · {fileCount} files
                </div>
              ) : (
                <button
                  onClick={() => setSettingsOpen(true)}
                  className="mt-2 w-full rounded-lg border border-[#D97757]/30 bg-[#D97757]/5 px-3 py-1.5 text-[10px] text-[#D97757] hover:bg-[#D97757]/10"
                >
                  配置 API Key
                </button>
              )}
            </div>
          </>
        )}
      </aside>

      {/* Main area — terminal + file bag */}
      <main className="min-w-0 flex-1">
        <ResizablePanelGroup direction={panelDirection} className="h-full">
          <ResizablePanel defaultSize={panelDirection === "horizontal" ? 62 : 55} minSize={30}>
            <Terminal />
          </ResizablePanel>
          <ResizableHandle withHandle className="bg-[#E5E2D9]" />
          <ResizablePanel defaultSize={panelDirection === "horizontal" ? 38 : 45} minSize={25}>
            <FileBag />
          </ResizablePanel>
        </ResizablePanelGroup>
      </main>

      <SettingsDialog
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
      />
      <HelpDialog
        open={helpOpen}
        onOpenChange={setHelpOpen}
      />
    </div>
  );
}

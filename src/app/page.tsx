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
import { Settings, Plus, MessageSquare, BookOpen } from "lucide-react";
import { useSession } from "@/store/session";
import { vfs } from "@/lib/vfs";

export default function Home() {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const init = useSession((s) => s.init);
  const config = useSession((s) => s.config);
  const reset = useSession((s) => s.reset);
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

  return (
    <div className="flex h-screen bg-[#FAF9F7]">
      {/* Left sidebar — conversation list */}
      <aside className="flex w-56 shrink-0 flex-col border-r border-[#E5E2D9] bg-[#F5F3EE]">
        {/* Brand */}
        <div className="flex items-center gap-2.5 px-4 py-4">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#D97757] text-sm font-bold text-white shadow-sm">
            {"</>"}
          </div>
          <span className="text-sm font-medium text-[#2D2B27]" style={{ fontFamily: "var(--font-fraunces), serif" }}>
            Open Code
          </span>
        </div>

        {/* New chat button */}
        <div className="px-3 pb-2">
          <button
            onClick={() => reset()}
            className="flex w-full items-center gap-2 rounded-lg border border-[#E5E2D9] bg-white px-3 py-2 text-sm text-[#6B6862] transition-colors hover:border-[#D97757]/30 hover:text-[#D97757]"
          >
            <Plus className="h-4 w-4" />
            新任务
          </button>
        </div>

        {/* Conversation list placeholder */}
        <div className="flex-1 overflow-y-auto px-2 py-2">
          <div className="mb-1 px-2 text-[10px] font-semibold uppercase tracking-wider text-[#A8A29E]">
            历史会话
          </div>
          {/* Current session */}
          <div className="flex items-center gap-2 rounded-lg bg-[#D97757]/8 px-3 py-2 text-sm text-[#2D2B27]">
            <MessageSquare className="h-3.5 w-3.5 shrink-0 text-[#D97757]" />
            <span className="truncate">当前会话</span>
            {config.hasApiKey && (
              <span className="ml-auto text-[10px] text-[#A8A29E]">{config.model}</span>
            )}
          </div>
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
              onClick={() => {
                const help = "Open Code Web — 按 /help 查看命令列表";
                alert(help);
              }}
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
      </aside>

      {/* Main area — terminal + file bag */}
      <main className="min-w-0 flex-1">
        <ResizablePanelGroup direction="horizontal" className="h-full">
          <ResizablePanel defaultSize={62} minSize={35}>
            <Terminal />
          </ResizablePanel>
          <ResizableHandle withHandle className="bg-[#E5E2D9]" />
          <ResizablePanel defaultSize={38} minSize={25}>
            <FileBag />
          </ResizablePanel>
        </ResizablePanelGroup>
      </main>

      <SettingsDialog
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
      />
    </div>
  );
}

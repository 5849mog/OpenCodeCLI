"use client";

/**
 * Token usage panel — right-side slide-out sheet showing how many tokens the
 * session has actually used, the last request's breakdown, compaction stats,
 * and a visual context-occupancy bar.
 *
 * Opened via the header Gauge button or by clicking the token counter below
 * the input box. (The /tokens slash command remains as a keyboard alternative.)
 */

import { Gauge } from "lucide-react";
import { useSession } from "@/store/session";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

const CONTEXT_BUDGET = 60_000;

export function TokenSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const totalTokens = useSession((s) => s.totalTokens);
  const lastUsage = useSession((s) => s.lastUsage);
  const compactedReleases = useSession((s) => s.compactedReleases ?? 0);
  const compactCount = useSession((s) => s.compactCount ?? 0);
  const lastSentPayload = useSession((s) => s.lastSentPayload);

  // Estimated current context occupancy: cumulative real usage minus what
  // compaction has released (rough — actual per-request context varies).
  const estimatedContext = Math.max(0, totalTokens - compactedReleases);
  const occupancyPct = Math.min(100, Math.round((estimatedContext / CONTEXT_BUDGET) * 100));

  const row = (label: string, value: string, sub?: string) => (
    <div className="flex items-baseline justify-between gap-3 py-1.5">
      <span className="text-[length:var(--font-size-ui-sm)] text-[#8B8884] dark:text-zinc-500">{label}</span>
      <span className="text-right font-mono text-sm text-[#2D2B27] dark:text-zinc-100">
        {value}
        {sub && <span className="ml-1.5 text-[10px] font-normal text-[#A8A29E] dark:text-zinc-600">{sub}</span>}
      </span>
    </div>
  );

  return (
    <Sheet open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent side="right" className="w-[85vw] border-[#E5E2D9] bg-[#FFFFFF] text-[#2D2B27] sm:max-w-md dark:border-[#3a3731] dark:bg-[#1c1a17] dark:text-zinc-100">
        <SheetHeader className="border-b border-[#E5E2D9] dark:border-[#3a3731]">
          <SheetTitle className="flex items-center gap-2 text-base">
            <Gauge className="h-4 w-4 text-[#D97757]" />
            Token 用量
          </SheetTitle>
          <SheetDescription className="text-xs text-[#8B8884] dark:text-zinc-500">
            本次会话的真实 API 用量与压缩情况（点按钮或输入区下方的 token 计数打开）。
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {/* Context occupancy bar */}
          <div className="mb-4 rounded-lg border border-[#E5E2D9] bg-[#FAF9F7] px-4 py-3 dark:border-[#3a3731] dark:bg-[#161512]">
            <div className="mb-1.5 flex items-baseline justify-between">
              <span className="text-[length:var(--font-size-ui-sm)] text-[#8B8884] dark:text-zinc-500">
                估算当前上下文占用
              </span>
              <span className="font-mono text-xs text-[#2D2B27] dark:text-zinc-100">
                {estimatedContext.toLocaleString()} / {CONTEXT_BUDGET.toLocaleString()}
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-[#E5E2D9] dark:bg-[#3a3731]">
              <div
                className={cn(
                  "h-full rounded-full transition-all",
                  occupancyPct > 90
                    ? "bg-[#E54D2E]"
                    : occupancyPct > 70
                      ? "bg-[#E8A87C]"
                      : "bg-[#D97757]",
                )}
                style={{ width: `${occupancyPct}%` }}
              />
            </div>
            <div className="mt-1.5 text-[10px] text-[#A8A29E] dark:text-zinc-600">
              {occupancyPct}% · 超过预算时 send 会自动截断较旧的消息 / 压缩工具结果
            </div>
          </div>

          <div className="rounded-lg border border-[#E5E2D9] px-4 py-3 dark:border-[#3a3731]">
            <div className="mb-1 border-b border-[#E5E2D9] pb-1 text-[10px] font-semibold uppercase tracking-wider text-[#8B8884] dark:border-[#3a3731] dark:text-zinc-500">
              用量
            </div>
            {row("累计真实用量", totalTokens.toLocaleString(), "tokens")}
            {lastUsage
              ? row(
                  "上次请求",
                  lastUsage.total_tokens.toLocaleString(),
                  `= ${lastUsage.prompt_tokens.toLocaleString()} prompt + ${lastUsage.completion_tokens.toLocaleString()} completion`,
                )
              : row("上次请求", "—", "尚未发送过消息")}
          </div>

          <div className="mt-3 rounded-lg border border-[#E5E2D9] px-4 py-3 dark:border-[#3a3731]">
            <div className="mb-1 border-b border-[#E5E2D9] pb-1 text-[10px] font-semibold uppercase tracking-wider text-[#8B8884] dark:border-[#3a3731] dark:text-zinc-500">
              压缩
            </div>
            {row("压缩次数", String(compactCount), "次")}
            {row("累计释放", `~${(compactedReleases / 1000).toFixed(1)}K`, "token")}
            <div className="mt-2 text-[10px] text-[#A8A29E] dark:text-zinc-600">
              压缩用 LLM 摘要折叠旧对话；后续内容在压缩后的摘要上继续叠加。释放量随每次 /compact 累加。
            </div>
          </div>

          <div className="mt-3 rounded-lg border border-[#E5E2D9] px-4 py-3 dark:border-[#3a3731]">
            <div className="mb-1 border-b border-[#E5E2D9] pb-1 text-[10px] font-semibold uppercase tracking-wider text-[#8B8884] dark:border-[#3a3731] dark:text-zinc-500">
              上次发送的上下文
            </div>
            {row("消息条数", lastSentPayload ? String(lastSentPayload.length) : "—", "含 system + 上下文")}
            <div className="mt-2 text-[10px] text-[#A8A29E] dark:text-zinc-600">
              点 header 的「上下文」按钮可查看 / 编辑上次实际发送给 AI 的完整 payload。
            </div>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

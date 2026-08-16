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
import { estimateConversationTokens } from "@/lib/context";

const CONTEXT_BUDGET = 60_000;

export function TokenSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const totalTokens = useSession((s) => s.totalTokens);
  const lastUsage = useSession((s) => s.lastUsage);
  const compactedReleases = useSession((s) => s.compactedReleases ?? 0);
  const compactCount = useSession((s) => s.compactCount ?? 0);
  const lastSentPayload = useSession((s) => s.lastSentPayload);

  // Estimated size of the actual payload sent on the last request (the real
  // per-request context). NOT the cumulative billing tally — that's totalTokens.
  const sentContext = lastSentPayload ? estimateConversationTokens(lastSentPayload) : null;
  const occupancyPct = sentContext
    ? Math.min(100, Math.round((sentContext / CONTEXT_BUDGET) * 100))
    : 0;

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
            <Gauge className="h-4 w-4 text-[#E58F67]" />
            Token 用量
          </SheetTitle>
          <SheetDescription className="text-xs text-[#8B8884] dark:text-zinc-500">
            本次会话的真实 API 用量与压缩情况（点按钮或输入区下方的 token 计数打开）。
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {/* Last request — the number that actually matters per call */}
          <div className="mb-4 rounded-lg border border-[#E5E2D9] bg-[#FAF9F7] px-4 py-3 dark:border-[#3a3731] dark:bg-[#161512]">
            <div className="mb-1 text-[length:var(--font-size-ui-sm)] text-[#8B8884] dark:text-zinc-500">
              最近一次请求
            </div>
            {lastUsage ? (
              <>
                <div className="font-mono text-2xl font-semibold text-[#2D2B27] dark:text-zinc-100">
                  {lastUsage.total_tokens.toLocaleString()}
                  <span className="ml-2 text-xs font-normal text-[#8B8884] dark:text-zinc-500">tokens</span>
                </div>
                <div className="mt-1 font-mono text-xs text-[#A8A29E] dark:text-zinc-600">
                  = {lastUsage.prompt_tokens.toLocaleString()} prompt + {lastUsage.completion_tokens.toLocaleString()} completion
                </div>
                <div className="mt-1.5 text-[10px] text-[#A8A29E] dark:text-zinc-600">
                  单次发给模型（输入 + 输出）的量，通常被截断在约 {CONTEXT_BUDGET.toLocaleString()} token 预算内。—— 不是下方累计的账单量
                </div>
              </>
            ) : (
              <div className="font-mono text-2xl font-semibold text-[#A8A29E] dark:text-zinc-600">—</div>
            )}
          </div>

          {/* Context occupancy bar (based on the actually-sent payload, not cumulative) */}
          <div className="mb-4 rounded-lg border border-[#E5E2D9] bg-[#FAF9F7] px-4 py-3 dark:border-[#3a3731] dark:bg-[#161512]">
            <div className="mb-1.5 flex items-baseline justify-between">
              <span className="text-[length:var(--font-size-ui-sm)] text-[#8B8884] dark:text-zinc-500">
                上次发送的上下文估算
              </span>
              {sentContext !== null ? (
                <span className="font-mono text-xs text-[#2D2B27] dark:text-zinc-100">
                  {sentContext.toLocaleString()} / {CONTEXT_BUDGET.toLocaleString()}
                </span>
              ) : (
                <span className="font-mono text-xs text-[#A8A29E] dark:text-zinc-600">—</span>
              )}
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-[#E5E2D9] dark:bg-[#3a3731]">
              <div
                className={cn(
                  "h-full rounded-full transition-all",
                  occupancyPct > 90
                    ? "bg-[#E54D2E]"
                    : occupancyPct > 70
                      ? "bg-[#E8A87C]"
                      : "bg-[#E58F67]",
                )}
                style={{ width: `${sentContext !== null ? occupancyPct : 0}%` }}
              />
            </div>
            <div className="mt-1.5 text-[10px] text-[#A8A29E] dark:text-zinc-600">
              {sentContext !== null
                ? `${occupancyPct}% · 超过预算时 send 会自动截断较旧的消息 / 压缩工具结果`
                : "尚未发送过请求"}
            </div>
          </div>

          <div className="rounded-lg border border-[#E5E2D9] px-4 py-3 dark:border-[#3a3731]">
            <div className="mb-1 border-b border-[#E5E2D9] pb-1 text-[10px] font-semibold uppercase tracking-wider text-[#8B8884] dark:border-[#3a3731] dark:text-zinc-500">
              账单 · 累计
            </div>
            {row("累计真实用量", totalTokens.toLocaleString(), "tokens — 本会话所有请求之和，非单次发送量")}
            <div className="mt-2 text-[10px] text-[#A8A29E] dark:text-zinc-600">
              这是所有 API 请求 token 数的累计（账单口径），只增不减。单次实际量看上方「最近一次请求」。
            </div>
          </div>

          <div className="mt-3 rounded-lg border border-[#E5E2D9] px-4 py-3 dark:border-[#3a3731]">
            <div className="mb-1 border-b border-[#E5E2D9] pb-1 text-[10px] font-semibold uppercase tracking-wider text-[#8B8884] dark:border-[#3a3731] dark:text-zinc-500">
              压缩
            </div>
            {row("压缩次数", String(compactCount), "次")}
            {row("累计释放", `~${(compactedReleases / 1000).toFixed(1)}K`, "token")}
            <div className="mt-2 text-[10px] text-[#A8A29E] dark:text-zinc-600">
              /compact 用 LLM 摘要折叠旧对话：只释放上下文占用，不改变账单累计（totalTokens 不变）。
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

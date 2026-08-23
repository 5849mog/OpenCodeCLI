"use client";

/**
 * AuditPanel — 会话审计面板（右侧栏常驻 tab）。
 *
 * 三个视图：
 *  - 工具调用：名称/次数/成功/失败/总耗时/平均耗时（events 配对，耗时 = 相邻 ts 差）；
 *  - 文件改动：VFS 变更日志（含 delete/move/bash 写入）+ events 的 diff 内容；
 *  - Token：累计真实用量、逐请求明细（usageHistory）、成本估算（cost.ts 价格表）。
 *
 * 与 /audit 导出共用 buildAuditReport（src/lib/audit.ts），数据实时刷新。
 */

import { useMemo, useState } from "react";
import { Wrench, FileDiff, Coins } from "lucide-react";
import { cn } from "@/lib/utils";
import { useSession } from "@/store/session";
import { buildAuditReport } from "@/lib/audit";

type TabKey = "tools" | "files" | "tokens";

function fmtMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

const KIND_LABEL: Record<string, string> = {
  write: "写入",
  delete: "删除",
  rename: "改名",
  clear: "清空",
  diff: "内容变更",
};

export function AuditPanel() {
  const events = useSession((s) => s.events);
  const usageHistory = useSession((s) => s.usageHistory);
  const vfsChangeLog = useSession((s) => s.vfsChangeLog);
  const totalTokens = useSession((s) => s.totalTokens);
  const model = useSession((s) => s.config.model);
  const [tab, setTab] = useState<TabKey>("tools");

  const report = useMemo(
    () => buildAuditReport(events, usageHistory, vfsChangeLog, totalTokens, model),
    [events, usageHistory, vfsChangeLog, totalTokens, model],
  );

  const tabs: { key: TabKey; label: string; Icon: typeof Wrench }[] = [
    { key: "tools", label: "工具", Icon: Wrench },
    { key: "files", label: "文件", Icon: FileDiff },
    { key: "tokens", label: "Token", Icon: Coins },
  ];

  return (
    <div className="flex h-full min-h-0 flex-col bg-[#FCFBF8] dark:bg-[#171717]">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-[#DEDEDE] px-4 py-2.5 dark:border-[#333333]">
        <div className="text-sm font-semibold text-[#262626] dark:text-zinc-100">会话审计</div>
        <div className="flex items-center gap-0.5">
          {tabs.map(({ key, label, Icon }) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={cn(
                "flex items-center gap-1 rounded px-2 py-1 text-[11px] font-medium transition-colors",
                tab === key
                  ? "bg-[#E58F67]/10 text-[#E58F67]"
                  : "text-[#8C8C8C] hover:bg-[#F5F5F5] hover:text-[#383838] dark:text-zinc-500 dark:hover:bg-[#262626]",
              )}
            >
              <Icon className="h-3 w-3" />
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {tab === "tools" && <ToolsView report={report} />}
        {tab === "files" && <FilesView report={report} />}
        {tab === "tokens" && <TokensView report={report} />}
      </div>
    </div>
  );
}

function ToolsView({ report }: { report: ReturnType<typeof buildAuditReport> }) {
  if (report.toolStats.length === 0) {
    return <Empty text="还没有工具调用。让 AI 干点活之后回来看看。" />;
  }
  return (
    <table className="w-full text-left text-xs">
      <thead>
        <tr className="border-b border-[#DEDEDE] text-[10px] uppercase tracking-wider text-[#8C8C8C] dark:border-[#333333] dark:text-zinc-500">
          <th className="py-1.5 pr-2 font-medium">工具</th>
          <th className="px-2 py-1.5 text-right font-medium">次数</th>
          <th className="px-2 py-1.5 text-right font-medium">成功</th>
          <th className="px-2 py-1.5 text-right font-medium">失败</th>
          <th className="px-2 py-1.5 text-right font-medium">总耗时</th>
          <th className="pl-2 py-1.5 text-right font-medium">平均</th>
        </tr>
      </thead>
      <tbody>
        {report.toolStats.map((s) => (
          <tr key={s.name} className="border-b border-[#F0EEE8] dark:border-[#2a2724]">
            <td className="py-1.5 pr-2 font-mono text-[11px] text-[#262626] dark:text-zinc-200">{s.name}</td>
            <td className="px-2 py-1.5 text-right text-[#262626] dark:text-zinc-200">{s.count}</td>
            <td className="px-2 py-1.5 text-right text-[#4A7C3A] dark:text-green-400">{s.ok}</td>
            <td className={cn("px-2 py-1.5 text-right", s.fail > 0 ? "text-[#E54D2E]" : "text-[#A6A6A6]")}>{s.fail}</td>
            <td className="px-2 py-1.5 text-right text-[#8C8C8C] dark:text-zinc-500">{fmtMs(s.totalMs)}</td>
            <td className="pl-2 py-1.5 text-right text-[#8C8C8C] dark:text-zinc-500">{fmtMs(s.avgMs)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function FilesView({ report }: { report: ReturnType<typeof buildAuditReport> }) {
  if (report.fileChanges.length === 0) {
    return <Empty text="还没有文件改动。" />;
  }
  return (
    <ul className="space-y-1">
      {report.fileChanges.slice(-200).map((f, i) => (
        <li key={i} className="flex items-baseline gap-2 text-xs">
          <span className="shrink-0 font-mono text-[10px] text-[#A6A6A6] dark:text-zinc-600">
            {new Date(f.ts).toLocaleTimeString()}
          </span>
          <span
            className={cn(
              "shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium",
              f.kind === "delete" ? "bg-[#E54D2E]/10 text-[#E54D2E]"
                : f.kind === "rename" ? "bg-[#E8A87C]/20 text-[#B0703B]"
                : f.kind === "diff" ? "bg-[#4A7C3A]/10 text-[#4A7C3A]"
                : "bg-[#E58F67]/10 text-[#B0703B]",
            )}
          >
            {KIND_LABEL[f.kind] ?? f.kind}
          </span>
          <span className="truncate font-mono text-[11px] text-[#262626] dark:text-zinc-200">
            {f.path}
            {f.toPath ? ` → ${f.toPath}` : ""}
          </span>
          {f.summary && (
            <span className="shrink-0 text-[10px] text-[#A6A6A6] dark:text-zinc-600">{f.summary}</span>
          )}
        </li>
      ))}
    </ul>
  );
}

function TokensView({ report }: { report: ReturnType<typeof buildAuditReport> }) {
  const srcLabel: Record<string, string> = { main: "主循环", subagent: "子代理", orchestrator: "编排" };
  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-[#DEDEDE] bg-[#FAFAFA] px-3 py-2 dark:border-[#333333] dark:bg-[#0A0A0A]">
        <div className="flex items-baseline justify-between">
          <span className="text-[11px] text-[#8C8C8C] dark:text-zinc-500">累计真实用量</span>
          <span className="font-mono text-lg font-semibold text-[#262626] dark:text-zinc-100">
            {report.totalTokens.toLocaleString()}
            <span className="ml-1 text-[10px] font-normal text-[#8C8C8C]">tokens</span>
          </span>
        </div>
        {report.cost ? (
          <div className="mt-1 flex items-baseline justify-between">
            <span className="text-[11px] text-[#8C8C8C] dark:text-zinc-500">
              成本估算（{report.cost.rate.key}）
            </span>
            <span className="font-mono text-sm text-[#262626] dark:text-zinc-100">
              ${report.cost.usd.toFixed(4)}
            </span>
          </div>
        ) : (
          <div className="mt-1 text-[10px] text-[#A6A6A6] dark:text-zinc-600">
            未匹配到价格表（{report.model}）——在 src/lib/cost.ts 补充定价后可见成本。
          </div>
        )}
        {report.cost && (
          <div className="mt-0.5 text-[10px] text-[#A6A6A6] dark:text-zinc-600">
            {report.cost.promptTokens.toLocaleString()} prompt + {report.cost.completionTokens.toLocaleString()} completion（真实拆分）
          </div>
        )}
      </div>

      <div>
        <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-[#8C8C8C] dark:text-zinc-500">
          逐请求明细（{report.usageRows.length}）
        </div>
        {report.usageRows.length === 0 ? (
          <div className="text-[11px] text-[#A6A6A6] dark:text-zinc-600">还没有 API 请求。</div>
        ) : (
          <table className="w-full text-left text-[11px]">
            <thead>
              <tr className="border-b border-[#DEDEDE] text-[10px] uppercase tracking-wider text-[#8C8C8C] dark:border-[#333333] dark:text-zinc-500">
                <th className="py-1 pr-2 font-medium">时间</th>
                <th className="px-1 py-1 font-medium">来源</th>
                <th className="px-1 py-1 text-right font-medium">prompt</th>
                <th className="px-1 py-1 text-right font-medium">completion</th>
                <th className="pl-1 py-1 text-right font-medium">total</th>
              </tr>
            </thead>
            <tbody>
              {report.usageRows.slice(-50).map((u, i) => (
                <tr key={i} className="border-b border-[#F0EEE8] dark:border-[#2a2724]">
                  <td className="py-1 pr-2 font-mono text-[10px] text-[#A6A6A6] dark:text-zinc-600">
                    {new Date(u.ts).toLocaleTimeString()}
                  </td>
                  <td className="px-1 py-1 text-[#8C8C8C] dark:text-zinc-500">{srcLabel[u.source] ?? u.source}</td>
                  <td className="px-1 py-1 text-right text-[#262626] dark:text-zinc-200">{u.promptTokens.toLocaleString()}</td>
                  <td className="px-1 py-1 text-right text-[#262626] dark:text-zinc-200">{u.completionTokens.toLocaleString()}</td>
                  <td className="pl-1 py-1 text-right font-medium text-[#262626] dark:text-zinc-100">{u.totalTokens.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <div className="py-8 text-center text-xs text-[#A6A6A6] dark:text-zinc-600">{text}</div>
  );
}

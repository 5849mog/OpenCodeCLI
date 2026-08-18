/**
 * audit.ts — 会话审计聚合（审计面板与 /audit 导出共用同一份数据逻辑）。
 *
 * 数据源全部来自已持久化的会话状态：
 *  - 工具调用统计：events[]（tool-call / tool-result 配对，耗时 = 相邻 ts 差）；
 *  - 文件改动地图：vfsChangeLog[]（覆盖 delete/move/bash 写入）+ events[].diff
 *    （write/edit/patch 的内容级变更）；
 *  - Token 花费：usageHistory[]（真实逐次拆分）累计 + cost.ts 价格表估算。
 */

import type { SessionEvent, UsageRecord, VfsChangeRecord } from "@/store/session";
import { matchModelRate, estimateCost, split80_20, type ModelRate } from "./cost";

export interface ToolStat {
  name: string;
  count: number;
  ok: number;
  fail: number;
  totalMs: number;
  avgMs: number;
}

export interface FileChangeEntry {
  ts: number;
  /** vfs 日志型（write/delete/rename/clear）或 diff 型（有 before/after 内容）。 */
  kind: "write" | "delete" | "rename" | "clear" | "diff";
  path?: string;
  toPath?: string;
  /** diff 型条目的变更摘要（before→after 字符数）。 */
  summary?: string;
}

export interface AuditReport {
  model: string;
  eventCount: number;
  toolCallCount: number;
  /** 会话总时长 ms（首个事件 → 最后一个事件）。 */
  durationMs: number;
  toolStats: ToolStat[];
  fileChanges: FileChangeEntry[];
  usageRows: UsageRecord[];
  totalTokens: number;
  /** 真实拆分（usageHistory 累计）下的成本估算；无 usage 时退化为 80/20。 */
  cost: { usd: number; rate: ModelRate; promptTokens: number; completionTokens: number } | null;
}

/** tool-call 与 tool-result 按"同名 + 顺序"配对（与 terminal 的 groupToolEvents 一致）。 */
function pairToolEvents(events: SessionEvent[]): { call: SessionEvent; result?: SessionEvent }[] {
  const claimed = new Set<string>();
  const pairs: { call: SessionEvent; result?: SessionEvent }[] = [];
  for (const ev of events) {
    if (ev.kind !== "tool-call" || !ev.toolName) continue;
    const result = events.find(
      (r) =>
        r.kind === "tool-result" &&
        r.toolName === ev.toolName &&
        !claimed.has(r.id),
    );
    if (result) {
      claimed.add(result.id);
      pairs.push({ call: ev, result });
    } else {
      pairs.push({ call: ev });
    }
  }
  return pairs;
}

/** 聚合审计报告（纯函数，可测）。 */
export function buildAuditReport(
  events: SessionEvent[],
  usageHistory: UsageRecord[],
  vfsChangeLog: VfsChangeRecord[],
  totalTokens: number,
  model: string,
): AuditReport {
  // ── 工具调用统计 ──
  const statMap = new Map<string, ToolStat>();
  const pairs = pairToolEvents(events);
  for (const { call, result } of pairs) {
    const name = call.toolName!;
    let st = statMap.get(name);
    if (!st) {
      st = { name, count: 0, ok: 0, fail: 0, totalMs: 0, avgMs: 0 };
      statMap.set(name, st);
    }
    st.count++;
    if (result) {
      if (result.ok !== false) st.ok++;
      else st.fail++;
      const ms = result.ts - call.ts;
      if (ms >= 0) st.totalMs += ms;
    } else {
      st.fail++; // 无配对结果 = 调用失败/中断
    }
  }
  const toolStats = [...statMap.values()]
    .map((s) => ({ ...s, avgMs: s.count > 0 ? Math.round(s.totalMs / s.count) : 0 }))
    .sort((a, b) => b.totalMs - a.totalMs);

  // ── 文件改动地图：vfs 日志（含 delete/move/bash）+ events 的 diff 内容 ──
  const fileChanges: FileChangeEntry[] = vfsChangeLog.map((c) => ({
    ts: c.ts,
    kind: c.type,
    path: c.path,
    toPath: c.toPath,
  }));
  for (const ev of events) {
    if (ev.kind === "tool-result" && ev.diff) {
      fileChanges.push({
        ts: ev.ts,
        kind: "diff",
        path: ev.diff.path,
        summary: `${ev.diff.before.length} → ${ev.diff.after.length} chars`,
      });
    }
  }
  fileChanges.sort((a, b) => a.ts - b.ts);

  // ── Token 花费：真实拆分累计 → 成本估算 ──
  let cost: AuditReport["cost"] = null;
  const rate = matchModelRate(model);
  if (rate) {
    const promptSum = usageHistory.reduce((s, u) => s + u.promptTokens, 0);
    const completionSum = usageHistory.reduce((s, u) => s + u.completionTokens, 0);
    if (promptSum + completionSum > 0) {
      cost = {
        usd: estimateCost(rate, promptSum, completionSum),
        rate,
        promptTokens: promptSum,
        completionTokens: completionSum,
      };
    } else {
      // 无逐次记录 → 80/20 假设
      const { prompt, completion } = split80_20(totalTokens);
      cost = {
        usd: estimateCost(rate, prompt, completion),
        rate,
        promptTokens: prompt,
        completionTokens: completion,
      };
    }
  }

  const firstTs = events[0]?.ts ?? 0;
  const lastTs = events[events.length - 1]?.ts ?? firstTs;

  return {
    model,
    eventCount: events.length,
    toolCallCount: pairs.length,
    durationMs: Math.max(0, lastTs - firstTs),
    toolStats,
    fileChanges,
    usageRows: usageHistory,
    totalTokens,
    cost,
  };
}

function fmtMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

/** 渲染 Markdown 报告（/audit 导出用）。 */
export function renderAuditMarkdown(r: AuditReport): string {
  const lines: string[] = [];
  lines.push(`# 会话审计报告`);
  lines.push(``);
  lines.push(`- 模型：${r.model}`);
  lines.push(`- 会话时长：${fmtMs(r.durationMs)}`);
  lines.push(`- 事件数：${r.eventCount}，工具调用：${r.toolCallCount}`);
  lines.push(`- 累计 token：${r.totalTokens.toLocaleString()}`);
  if (r.cost) {
    lines.push(
      `- 成本估算：$${r.cost.usd.toFixed(4)}（$${r.cost.rate.in}/M in, $${r.cost.rate.out}/M out，` +
        `${r.cost.promptTokens.toLocaleString()} prompt + ${r.cost.completionTokens.toLocaleString()} completion）`,
    );
  }
  lines.push(``);

  lines.push(`## 工具调用统计`);
  lines.push(``);
  lines.push(`| 工具 | 次数 | 成功 | 失败 | 总耗时 | 平均耗时 |`);
  lines.push(`| --- | ---: | ---: | ---: | ---: | ---: |`);
  for (const s of r.toolStats) {
    lines.push(`| ${s.name} | ${s.count} | ${s.ok} | ${s.fail} | ${fmtMs(s.totalMs)} | ${fmtMs(s.avgMs)} |`);
  }
  lines.push(``);

  lines.push(`## 文件改动`);
  lines.push(``);
  if (r.fileChanges.length === 0) {
    lines.push(`（无文件改动）`);
  } else {
    for (const f of r.fileChanges.slice(-100)) {
      const time = new Date(f.ts).toLocaleTimeString();
      const detail =
        f.kind === "rename" ? ` → ${f.toPath}` :
        f.kind === "diff" ? `（${f.summary}）` : "";
      lines.push(`- \`${time}\` **${f.kind}** \`${f.path}\`${detail}`);
    }
  }
  lines.push(``);

  lines.push(`## Token 用量明细`);
  lines.push(``);
  if (r.usageRows.length === 0) {
    lines.push(`（无逐次记录）`);
  } else {
    const srcLabel: Record<string, string> = { main: "主循环", subagent: "子代理", orchestrator: "编排" };
    lines.push(`| 时间 | 来源 | prompt | completion | total |`);
    lines.push(`| --- | --- | ---: | ---: | ---: |`);
    for (const u of r.usageRows) {
      lines.push(`| ${new Date(u.ts).toLocaleTimeString()} | ${srcLabel[u.source] ?? u.source} | ${u.promptTokens} | ${u.completionTokens} | ${u.totalTokens} |`);
    }
  }
  lines.push(``);
  return lines.join("\n");
}

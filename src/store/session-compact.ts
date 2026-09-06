
"use client";

import {
  type AiClientConfig
} from "@/lib/ai-client";
import {
} from "@/lib/tools/index";
import {  compactConversation  } from "@/lib/compact";
import {
} from "@/lib/session-storage";
import {  apiKeyVault  } from "@/lib/api-key-vault";

// ---------------------------------------------------------------------------
// Idle auto-lock — wipes API keys from memory after N minutes of inactivity.
// ---------------------------------------------------------------------------
import {  nextId,  flushPersist  } from "./session-persist";
import type {  SessionSet,  SessionGet  } from "./session-helpers";

/**
 * auto-compact 触发判定（纯函数，可测）：
 * 开关开启 + 未在压缩中 + 真分词器估算超预算 85% + 距上次压缩 ≥10 条新消息。
 */
export function shouldAutoCompact(opts: {
  autoCompact: boolean;
  isCompacting: boolean;
  estimatedTokens: number;
  tokenBudget: number;
  messagesSinceLastCompact: number;
}): boolean {
  return (
    opts.autoCompact &&
    !opts.isCompacting &&
    opts.estimatedTokens > opts.tokenBudget * 0.85 &&
    opts.messagesSinceLastCompact >= 10
  );
}

/**
 * 压缩会话历史（手动 /compact 与 auto-compact 共用）。
 * - 对话太短 / 未配置 API Key：manual 推事件提示；auto 静默跳过（truncate 兜底）。
 * - 成功：写回 messages + 累计 compactedReleases/compactCount + lastCompactMsgCount
 *   （auto-compact 节流基准）+ 立即持久化 + 推 system 事件（触发方式标注）。
 * - 失败：manual 推 error 事件；auto 静默（truncate 兜底）。
 */
export async function doCompact(trigger: "manual" | "auto", set: SessionSet, get: SessionGet): Promise<void> {
  const { messages } = get();
  if (messages.length < 4) {
    if (trigger === "manual") {
      set((s) => ({
        events: [
          ...s.events,
          { id: nextId(), kind: "system", text: "对话太短，无需压缩（至少需要 4 条消息）。", ts: Date.now() },
        ],
      }));
    }
    return;
  }
  if (!apiKeyVault.hasKey()) {
    if (trigger === "manual") {
      set((s) => ({
        events: [
          ...s.events,
          { id: nextId(), kind: "error", text: "无法压缩：未配置 API Key。压缩需要调用模型生成摘要。", ts: Date.now() },
        ],
      }));
    }
    return;
  }
  const config = get().config;
  const aiConfig: AiClientConfig = {
    baseUrl: config.baseUrl,
    apiKey: apiKeyVault.getKey() ?? "",
    model: config.model,
    temperature: config.temperature,
    maxTokens: config.maxTokens,
    thinkingEnabled: config.thinkingEnabled,
    reasoningEffort: config.reasoningEffort,
  };
  set({ isCompacting: true, agentStatus: "正在压缩对话历史…" });
  try {
    const result = await compactConversation(messages, aiConfig);
    // 真写回 store——后续每一轮请求都发送压缩后的历史
    const released = result.tokensBefore - result.tokensAfter;
    set((s) => ({
      messages: result.messages,
      truncated: false,
      // 累计本次释放的 token 数与压缩次数（压缩感知面板用）
      compactedReleases: (s.compactedReleases ?? 0) + (released > 0 ? released : 0),
      compactCount: (s.compactCount ?? 0) + 1,
      lastCompactMsgCount: result.messages.length,
    }));
    // 立即持久化压缩后的历史——否则刷新页面后 IndexedDB 里还是
    // 未压缩的完整对话，压缩效果丢失（send 里下一次 schedulePersist
    // 才会覆盖，但刷新前这个窗口期内持久化层是旧数据）。
    void flushPersist(get);
    const modeLabel = result.mode === "llm" ? "LLM 摘要" : "启发式压缩（摘要调用失败，已降级）";
    set((s) => ({
      events: [
        ...s.events,
        {
          id: nextId(),
          kind: "system",
          text: `${trigger === "auto" ? "已自动压缩对话历史" : "已压缩对话历史"}（${modeLabel}）：${messages.length} 条消息 → ${result.messages.length} 条，释放约 ${((result.tokensBefore - result.tokensAfter) / 1000).toFixed(1)}K token（${result.tokensBefore.toLocaleString()} → ${result.tokensAfter.toLocaleString()}）。旧对话已浓缩为摘要。`,
          ts: Date.now(),
        },
      ],
    }));
  } catch (e) {
    if (trigger === "manual") {
      set((s) => ({
        events: [
          ...s.events,
          { id: nextId(), kind: "error", text: `压缩失败：${e instanceof Error ? e.message : String(e)}。对话历史保持不变。`, ts: Date.now() },
        ],
      }));
    }
  } finally {
    // 无论成功失败都清除压缩状态——UI 的"压缩中"动画随之消失
    set({ isCompacting: false, agentStatus: "" });
  }
}

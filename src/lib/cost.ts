/**
 * cost.ts — 模型价格表与成本估算（/cost 命令与审计面板共用）。
 *
 * 价格为 USD / 1M tokens 的公开定价（近似，用户可自行调整）。
 */

/** 单位：USD / 1M tokens。 */
export const RATES: Record<string, { in: number; out: number }> = {
  "gpt-4o": { in: 2.5, out: 10 },
  "gpt-4o-mini": { in: 0.15, out: 0.6 },
  "gpt-4.1": { in: 2, out: 8 },
  "gpt-4.1-mini": { in: 0.4, out: 1.6 },
  "deepseek-v4-flash": { in: 0.27, out: 1.1 },
  "deepseek-v4-pro": { in: 0.55, out: 2.19 },
  "claude-3-5-sonnet": { in: 3, out: 15 },
  "claude-3-5-haiku": { in: 0.8, out: 4 },
};

export interface ModelRate {
  key: string;
  in: number;
  out: number;
}

/** 按模型名匹配价格（key 按长度降序，避免 "gpt-4o" 抢先匹配 "gpt-4o-mini"）。 */
export function matchModelRate(model: string): ModelRate | null {
  const key = Object.keys(RATES)
    .sort((a, b) => b.length - a.length)
    .find((k) => model.toLowerCase().includes(k.toLowerCase()));
  if (!key) return null;
  const r = RATES[key];
  return { key, in: r.in, out: r.out };
}

/**
 * 按真实拆分（prompt/completion）估算成本；未提供拆分时退化为 80/20 假设。
 * 返回 USD 金额。
 */
export function estimateCost(
  rate: ModelRate,
  promptTokens: number,
  completionTokens: number,
): number {
  return (promptTokens / 1_000_000) * rate.in + (completionTokens / 1_000_000) * rate.out;
}

/** 80/20 拆分（旧口径，未知真实拆分时用）。 */
export function split80_20(totalTokens: number): { prompt: number; completion: number } {
  const prompt = Math.round(totalTokens * 0.8);
  return { prompt, completion: totalTokens - prompt };
}

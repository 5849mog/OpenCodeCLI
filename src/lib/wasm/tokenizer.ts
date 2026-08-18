/**
 * tokenizer.ts — DeepSeek 真分词器宿主桥接层（context 估算/审计面板共用）。
 *
 * 背景：浏览器此前只能用字符启发式估算 token（±15%）。本项目接入 DeepSeek-V3
 * 官方 tokenizer.json（128k BPE 词表，7.8MB，public/tokenizer/）+ @huggingface/
 * tokenizers 纯 JS 移植（public/wasm/tokenizers-lib.js，IIFE 打包，无 wasm），
 * 与 Python transformers 同引擎——计数逐字节一致（仅对 DeepSeek 模型精确；
 * 其他厂商模型为近似，但比字符估算准一个量级）。
 *
 * 架构：第四号静态 Worker（tokenizer-worker.js），复用 worker-client 池化单例
 * （首次 request 才创建；tokenizer.json 在 worker 内 fetch 一次常驻）。
 *  - countTokens / countTexts：LRU 缓存（按文本），worker 未就绪/出错时回退字符估算；
 *  - countConversationTokensAccurate：批量一次往返（含 tool_calls args，
 *    开销常数与 context.ts 的 estimateMessageTokens 对齐）；
 *  - warmup：fire-and-forget 预热（首次用户消息后调用，不阻塞发送）；
 *  - tokenizerStatus：idle | loading | ready | failed（面板显示用）。
 */

import type { ChatMessage } from "../ai-client";
import { estimateTokens } from "../context";
import { createWorkerClient, type WorkerClient } from "./worker-client";

/** GitHub Pages basePath 兼容（复用 esbuild.ts 的 wasmUrl 逻辑）。 */
function wasmUrl(file: string): string {
  if (typeof window === "undefined") return `/${file}`;
  if (window.location.hostname.endsWith("github.io")) {
    const seg = window.location.pathname.split("/").filter(Boolean)[0] ?? "";
    return `/${seg ? seg + "/" : ""}${file}`;
  }
  return `/${file}`;
}

let client: WorkerClient | null = null;
function getClient(): WorkerClient {
  if (!client) client = createWorkerClient(wasmUrl("wasm/tokenizer-worker.js"), 60_000);
  return client;
}

export type TokenizerStatus = "idle" | "loading" | "ready" | "failed";

let status: TokenizerStatus = "idle";
let statusSubs = new Set<(s: TokenizerStatus) => void>();

function setStatus(s: TokenizerStatus): void {
  if (status === s) return;
  status = s;
  for (const fn of statusSubs) {
    try { fn(s); } catch { /* ignore */ }
  }
}

/** 订阅分词器状态变化（UI 显示加载态用）。返回取消函数。 */
export function onTokenizerStatus(fn: (s: TokenizerStatus) => void): () => void {
  statusSubs.add(fn);
  return () => statusSubs.delete(fn);
}

export function tokenizerStatus(): TokenizerStatus {
  return status;
}

/** LRU：按文本缓存计数（worker 往返比本地 Map 贵一个量级）。 */
const LRU_CAP = 2000;
const lru = new Map<string, number>();
function lruGet(text: string): number | undefined {
  const v = lru.get(text);
  if (v !== undefined) lru.delete(text); // 刷新到尾部
  return v;
}
function lruSet(text: string, count: number): void {
  lru.delete(text);
  lru.set(text, count);
  if (lru.size > LRU_CAP) {
    const first = lru.keys().next().value;
    if (first !== undefined) lru.delete(first);
  }
}

/**
 * 预热：fire-and-forget 创建 worker 并加载 tokenizer.json（约 1-2s），
 * 不 await——首次发送不阻塞；就绪后估算自动切真分词器。
 */
export function warmup(): void {
  if (status === "ready" || status === "loading") return;
  setStatus("loading");
  getClient()
    .request<{ ok: boolean; result?: { counts: number[] } }>({ texts: [] }, { timeoutMs: 60_000 })
    .then(() => setStatus("ready"))
    .catch(() => setStatus("failed"));
}

/** 批量精确计数（空数组也会触发一次 worker 初始化往返）。worker 失败回退字符估算。 */
export async function countTexts(texts: string[]): Promise<number[]> {
  const miss: number[] = [];
  const out: number[] = new Array(texts.length);
  texts.forEach((t, i) => {
    const c = lruGet(t);
    if (c !== undefined) out[i] = c;
    else { out[i] = -1; miss.push(i); }
  });
  if (miss.length === 0) return out;

  const missTexts = miss.map((i) => texts[i]);
  try {
    const msg = await getClient().request<{ ok: boolean; result?: { counts: number[] } }>(
      { texts: missTexts },
      { timeoutMs: 30_000 },
    );
    if (msg.ok && msg.result && Array.isArray(msg.result.counts) && msg.result.counts.length === missTexts.length) {
      miss.forEach((origIdx, k) => {
        const c = msg.result!.counts![k];
        out[origIdx] = c;
        lruSet(texts[origIdx], c);
      });
    } else {
      throw new Error("分词器响应异常");
    }
  } catch {
    setStatus("failed");
    for (const i of miss) out[i] = estimateTokens(texts[i]);
  }
  return out;
}

/** 单段文本精确计数（LRU 缓存）。 */
export async function countTokens(text: string): Promise<number> {
  const c = lruGet(text);
  if (c !== undefined) return c;
  const [v] = await countTexts([text]);
  return v;
}

/**
 * 整段会话精确计数：与 context.ts estimateMessageTokens 对齐的开销常数
 * （每消息 +4、每 tool_call +8），文本部分走真分词器批量一次往返。
 */
export async function countConversationTokensAccurate(msgs: ChatMessage[]): Promise<number> {
  const flat: string[] = [];
  const perMsg: { overhead: number; partIdx: number[] }[] = msgs.map((m) => {
    let overhead = 4; // per-message overhead（与 estimateMessageTokens 一致）
    const partIdx: number[] = [];
    if (typeof m.content === "string") { partIdx.push(flat.length); flat.push(m.content); }
    if (m.tool_calls) {
      overhead += m.tool_calls.length * 8;
      for (const tc of m.tool_calls) {
        partIdx.push(flat.length); flat.push(tc.function.name);
        partIdx.push(flat.length); flat.push(tc.function.arguments);
      }
    }
    if (m.name) { partIdx.push(flat.length); flat.push(m.name); }
    return { overhead, partIdx };
  });

  const counts = flat.length > 0 ? await countTexts(flat) : [];
  let total = 0;
  perMsg.forEach((p, i) => {
    let sum = 0;
    for (const idx of p.partIdx) sum += counts[idx] ?? 0;
    total += p.overhead + sum;
  });
  return total;
}

/**
 * 给 context.ts 用的默认计数器：分词器就绪走真计数，否则立即回退字符估算
 * （不等待 worker——首次发送零延迟，预热完成后自动升级精度）。
 */
export async function contextCounter(msgs: ChatMessage[]): Promise<number> {
  if (status === "ready") return countConversationTokensAccurate(msgs);
  return msgs.reduce((sum, m) => sum + estimateMessageTokensLocal(m), 0);
}

/** 与 context.ts estimateMessageTokens 相同的同步估算（局部引用避免循环依赖）。 */
function estimateMessageTokensLocal(msg: ChatMessage): number {
  let total = 4;
  if (typeof msg.content === "string") total += estimateTokens(msg.content);
  if (msg.tool_calls) {
    for (const tc of msg.tool_calls) {
      total += estimateTokens(tc.function.name);
      total += estimateTokens(tc.function.arguments);
      total += 8;
    }
  }
  if (msg.name) total += estimateTokens(msg.name);
  return total;
}

import { describe, expect, it, vi } from "vitest";
import {
  compressToolResult,
  estimateContentPartsTokens,
  estimateConversationTokens,
  estimateMessageTokens,
  estimateTokens,
  truncateConversation,
} from "../context";
import type { ChatMessage, ToolCall } from "./ai-client";

// context.ts 顶层 import 了 wasm/tokenizer（浏览器 Worker 桥接层）。
// Node 测试里 mock 掉，避免任何 Worker 副作用；token 计数一律显式传 counter。
vi.mock("../wasm/tokenizer", () => ({
  contextCounter: () => 0,
}));

const counter = (msgs: ChatMessage[]) => estimateConversationTokens(msgs);

const systemMsg: ChatMessage = { role: "system", content: "You are a coding agent." };
const workspaceMsg: ChatMessage = { role: "user", content: "<workspace>files: a.txt</workspace>" };
const userMsg = (t: string): ChatMessage => ({ role: "user", content: t });

const call = (id: string): ToolCall => ({
  id,
  type: "function",
  function: { name: "bash", arguments: '{"command":"ls"}' },
});

const assistantWithCall = (id: string): ChatMessage => ({
  role: "assistant",
  content: "",
  tool_calls: [call(id)],
});

const toolMsg = (id: string, content: string): ChatMessage => ({
  role: "tool",
  tool_call_id: id,
  content,
  name: "bash",
});

describe("estimateTokens", () => {
  it("空文本为 0", () => {
    expect(estimateTokens("")).toBe(0);
  });

  it("ASCII 约 4 字符/token", () => {
    expect(estimateTokens("abcdefgh")).toBe(2);
  });

  it("CJK 约 1.5 字符/token", () => {
    // 3 个 CJK → ceil(3/1.5) = 2
    expect(estimateTokens("你好吗")).toBe(2);
  });

  it("中英混算分别计价", () => {
    // 3 CJK → 2；4 ASCII → 1；ceil(2 + 1) = 3
    expect(estimateTokens("你好吗abcd")).toBe(3);
  });
});

describe("estimateContentPartsTokens", () => {
  it("图片固定 384、file 引用 15、文本正常计", () => {
    const parts = [
      { type: "text", text: "abcdefgh" } as const,
      { type: "image_url", image_url: { url: "data:..." } } as const,
      { type: "file", file_id: "f-1" } as const,
    ];
    expect(estimateContentPartsTokens([...parts])).toBe(2 + 384 + 15);
  });
});

describe("estimateMessageTokens", () => {
  it("含 tool_calls 时计结构性开销", () => {
    const base = estimateMessageTokens({ role: "assistant", content: "" });
    const withCall = estimateMessageTokens(assistantWithCall("call-1"));
    // tool name + args + 每调用 8 overhead
    expect(withCall).toBeGreaterThan(base);
    expect(withCall - base).toBe(estimateTokens("bash") + estimateTokens('{"command":"ls"}') + 8);
  });
});

describe("compressToolResult", () => {
  it("非 tool 消息原样返回", () => {
    const msg = userMsg("hello");
    expect(compressToolResult(msg)).toBe(msg);
  });

  it("≤200 字符的 tool 消息不压缩", () => {
    const msg = toolMsg("t1", "short output");
    expect(compressToolResult(msg)).toBe(msg);
  });

  it("超长 tool 消息压缩为首行 + 截断标记", () => {
    const long = "first line\n" + Array.from({ length: 50 }, (_, i) => `line ${i}`).join("\n");
    const msg = toolMsg("t1", long);
    const out = compressToolResult(msg);
    expect(out).not.toBe(msg);
    expect(out.content).toContain("[tool result (bash) truncated]");
    expect(out.content).toContain("first line");
    expect(out.content).toContain("51 lines truncated");
    expect(out.content).toContain(`${long.length} chars total`);
  });
});

describe("truncateConversation", () => {
  it("预算内原样返回", async () => {
    const msgs = [systemMsg, workspaceMsg, userMsg("hi")];
    const out = await truncateConversation(msgs, 60_000, 10, counter);
    expect(out.dropped).toBe(0);
    expect(out.compressed).toBe(0);
    expect(out.messages).toBe(msgs);
  });

  it("Phase 1：压缩中段 tool 消息，保护 system/context/recent", async () => {
    // 注意：压缩保留首行，构造多行内容才能体现真实收益
    // （单行超长输出压缩后不缩反增 —— 已记入阶段 3 修复清单）。
    const bigTool = toolMsg("t1", "head\n" + "x".repeat(4000));
    const fillers: ChatMessage[] = [];
    for (let i = 0; i < 15; i++) {
      fillers.push(assistantWithCall(`c${i}`), toolMsg(`c${i}`, `head ${i}\n` + "y".repeat(2000)));
    }
    const recent: ChatMessage[] = [];
    for (let i = 0; i < 10; i++) recent.push(userMsg(`recent ${i} ${"z".repeat(50)}`));
    const msgs = [systemMsg, workspaceMsg, bigTool, ...fillers, ...recent];

    // 预算卡在「压缩后刚好够」的位置，验证 Phase 1 单独生效
    const before = counter(msgs);
    const out = await truncateConversation(msgs, before - 1000, 10, counter);
    expect(out.compressed).toBeGreaterThan(0);
    expect(out.dropped).toBe(0);
    // 头两条受保护
    expect(out.messages[0]).toBe(systemMsg);
    expect(out.messages[1]).toBe(workspaceMsg);
    // 最近 10 条原样保留
    expect(out.messages.slice(-10)).toEqual(recent);
  });

  it("Phase 2：成对丢弃 assistant+tool，不产生孤儿 tool_call_id", async () => {
    const fillers: ChatMessage[] = [];
    for (let i = 0; i < 20; i++) {
      fillers.push(assistantWithCall(`c${i}`), toolMsg(`c${i}`, "y".repeat(3000)));
    }
    const recent: ChatMessage[] = [];
    for (let i = 0; i < 10; i++) recent.push(userMsg(`recent ${i} ${"z".repeat(50)}`));
    const msgs = [systemMsg, workspaceMsg, ...fillers, ...recent];

    const out = await truncateConversation(msgs, counter(msgs) / 2, 10, counter);
    expect(out.dropped).toBeGreaterThan(0);
    expect(out.compressed).toBeGreaterThan(0);
    expect(out.tokensAfter).toBeLessThanOrEqual(counter(msgs) / 2);
    // 头两条受保护
    expect(out.messages[0]).toBe(systemMsg);
    expect(out.messages[1]).toBe(workspaceMsg);
    // 没有孤儿 tool 消息：每个 tool 的 tool_call_id 都能找到前面的 assistant 调用
    const callIds = new Set<string>();
    for (const m of out.messages) {
      if (m.role === "assistant" && m.tool_calls) {
        for (const tc of m.tool_calls) callIds.add(tc.id);
      }
    }
    for (const m of out.messages) {
      if (m.role === "tool") {
        expect(callIds.has(m.tool_call_id ?? "")).toBe(true);
      }
    }
    // 最近 10 条原样保留
    expect(out.messages.slice(-10)).toEqual(recent);
  });

  it("中段为普通 user 消息时逐条丢弃", async () => {
    const fillers: ChatMessage[] = [];
    for (let i = 0; i < 20; i++) fillers.push(userMsg(`filler ${i} ${"f".repeat(2000)}`));
    const recent: ChatMessage[] = [userMsg("recent-0"), userMsg("recent-1")];
    const msgs = [systemMsg, workspaceMsg, ...fillers, ...recent];

    const out = await truncateConversation(msgs, counter(msgs) / 3, 2, counter);
    expect(out.dropped).toBeGreaterThan(0);
    const rest = out.messages.filter((m, i) => i > 1 && i < out.messages.length - 2);
    // 丢的都是中段 filler，不会误伤 system/context/recent
    expect(out.messages[0]).toBe(systemMsg);
    expect(out.messages[1]).toBe(workspaceMsg);
    expect(out.messages.slice(-2)).toEqual(recent);
    expect(rest.some((m) => m.role === "user" && m.content.startsWith("filler 19"))).toBe(true);
  });
});

/**
 * Subagent — a lightweight secondary AI agent with its own conversation
 * context. Mirrors Claude Code's "task" tool: the main AI can delegate an
 * independent subtask to a subagent, which runs its own agent loop (with
 * tool calling) and returns a final text summary.
 *
 * Key properties:
 * - The subagent does NOT see the main conversation history (clean context).
 * - The subagent shares the same VFS + config (it can read/write files).
 * - The subagent has its own tool budget (default 8 iterations).
 * - The subagent's tool calls + intermediate results are NOT shown in the
 *   main UI — only the final summary is returned to the main AI.
 * - The subagent's token usage is added to the session total.
 */

import {
  streamChatCompletionWithRetry,
  type AiClientConfig,
  type ChatMessage,
} from "./ai-client";
import { vfs } from "./vfs";
import {
  TOOL_DEFINITIONS,
  dispatchTool,
  buildSystemPrompt,
  type ToolResult,
} from "./tools/index";
import { buildWorkspaceContext } from "./tools/system-prompt";
import { truncateConversation, DEFAULT_TOKEN_BUDGET } from "./context";

/** 子代理不允许再委派子代理（dispatch.ts 无 dispatch_subagent/orchestrate_task
 *  分支，调用必失败）——工具集直接剔除，避免诱导模型调用后吃到 "Unknown tool"。
 *  ask_user_input 同样剔除：子代理侧没有用户，禁止弹提问面板（Rule 7）。 */
const SUBAGENT_TOOLS = TOOL_DEFINITIONS.filter(
  (t) =>
    t.function.name !== "dispatch_subagent" &&
    t.function.name !== "orchestrate_task" &&
    t.function.name !== "ask_user_input",
);

/** 每请求超时（与主循环 PER_REQUEST_TIMEOUT_MS 一致）——子代理卡死不能无声无息。 */
const PER_REQUEST_TIMEOUT_MS = 300_000;

export interface SubagentOptions {
  /** The task description for the subagent. */
  task: string;
  /** Max iterations for the subagent's agent loop. Default 8. */
  maxIterations?: number;
  /** Token budget for the subagent's own context. Default DEFAULT_TOKEN_BUDGET. */
  tokenBudget?: number;
  /** Optional callback to receive token usage from the subagent. */
  onUsage?: (usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number }) => void;
  /** Optional callback to receive status updates (for UI display). */
  onStatus?: (status: string) => void;
  /** AbortSignal to cancel the subagent. */
  signal?: AbortSignal;
  /** 继承主循环模式："plan" 时子代理只读（workspace context 与 dispatchTool readOnly
   *  都按此 mode）——堵住「Plan 模式派子代理绕过只读」的漏洞。 */
  mode?: "plan" | "bypass";
}

export interface SubagentResult {
  /** The subagent's final text summary. */
  summary: string;
  /** Number of tool calls the subagent made. */
  toolCallCount: number;
  /** Number of iterations the subagent ran. */
  iterations: number;
  /** Whether the subagent completed normally (true) or hit the iteration cap (false). */
  completed: boolean;
}

/**
 * Run a subagent. The subagent uses the same AI config + VFS as the main
 * session, but has its own isolated conversation history.
 */
export async function runSubagent(
  config: AiClientConfig,
  opts: SubagentOptions,
): Promise<SubagentResult> {
  const maxIter = opts.maxIterations ?? 8;
  const aiConfig: AiClientConfig = {
    baseUrl: config.baseUrl,
    apiKey: config.apiKey,
    model: config.model,
    temperature: config.temperature,
    maxTokens: config.maxTokens,
    thinkingEnabled: config.thinkingEnabled,
    reasoningEffort: config.reasoningEffort,
  };

  // Build the subagent's conversation: static system prompt + workspace
  // context (cache-friendly) + task description. mode 继承主循环：
  // Plan 模式下子代理也只读。
  const systemPrompt = buildSystemPrompt({});
  const contextBlock = buildWorkspaceContext({ mode: opts.mode ?? "bypass" });
  // NOTE: index 0 = system prompt, index 1 = workspace context block.
  // truncateConversation below protects both by index — keep this order.
  let messages: ChatMessage[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: contextBlock },
    { role: "user", content: `你是一个子代理——一个专注完成主代理委派的特定子任务的助手。你与主代理共享同一个工作区，有完整的工具访问权限。

## 你的工作原则

1. **你有 ${maxIter} 次工具调用迭代预算。** 高效利用每一次调用：先想清楚要查什么、在哪、期望看到什么，再动手。
2. **你看不到主对话历史。** 只依据下面"你的任务"部分的描述工作，不要假设主代理已经提供给你的信息之外的上下文。
3. **完成时写一份完整、有条理的总结，然后停止调用工具。** 你的最终回复会**完整**返回给主代理——不要为了"显得简短"而牺牲信息。把该报告的发现、文件路径、行号、函数签名、代码片段都写全。结论的质量优先于长度。
4. **报告行号时用 \`read_file\` 的 \`lineNumbers: true\` 参数**，不要凭肉眼数行。\`read_file\` 默认不带行号；传入 \`lineNumbers: true\` 会在每行前加行号前缀（如 \` 42 | const x = 1\`），你引用的每个行号都来自工具、真实可信。需要引用大文件的某一段时，先 \`view_outline\` 拿到结构行号，再精确 read 那一段。
5. **如果你无法完成任务**，在你的最终回复里说明原因，然后停止。
6. **你不能委派给其他子代理**——你没有任何委派工具。所有事情都要自己做。

## 你的任务
${opts.task}

开始。按需使用工具，然后在最终回复中完整总结你的工作。` },
  ];

  let toolCallCount = 0;
  let iterations = 0;
  let lastText = "";

  for (let iter = 0; iter < maxIter; iter++) {
    iterations++;
    if (opts.signal?.aborted) break;
    opts.onStatus?.(`Subagent iteration ${iter + 1}/${maxIter}`);
    // summary 只取「最终轮」的文本：每轮开头重置，避免跨轮累积把每轮
    // 工具调用前的分析也拼进 summary（污染主上下文的确定性 bug）。
    lastText = "";

    // Safety net: keep the subagent's own context under budget. Only triggers
    // when a big tool result blows the budget — do NOT shrink tokenBudget to
    // proactively truncate (it would make the model re-read files, costing more).
    const { messages: truncated } = await truncateConversation(
      messages,
      opts.tokenBudget ?? DEFAULT_TOKEN_BUDGET,
      8,
    );
    if (truncated.length < messages.length) messages = truncated;

    // 每请求超时：组合用户 signal 与 300s 超时（与主循环一致）
    const timeoutController = new AbortController();
    const timeoutId = setTimeout(() => timeoutController.abort(), PER_REQUEST_TIMEOUT_MS);
    const reqSignal = opts.signal
      ? AbortSignal.any([opts.signal, timeoutController.signal])
      : timeoutController.signal;
    let result: Awaited<ReturnType<typeof streamChatCompletionWithRetry>>;
    try {
      result = await streamChatCompletionWithRetry(
        aiConfig,
        messages,
        SUBAGENT_TOOLS,
        {
          onText: (delta) => {
            lastText += delta;
          },
          onUsage: (usage) => {
            opts.onUsage?.(usage);
          },
        },
        reqSignal,
      );
    } finally {
      clearTimeout(timeoutId);
    }

    messages.push(result.message);

    if (!result.message.tool_calls || result.message.tool_calls.length === 0) {
      // Subagent is done — returned text summary
      const c = result.message.content;
      return {
        summary: lastText || (typeof c === "string" ? c : "") || "(subagent returned no summary)",
        toolCallCount,
        iterations,
        completed: true,
      };
    }

    // Execute the subagent's tool calls
    for (const tc of result.message.tool_calls) {
      if (opts.signal?.aborted) break;
      // Parse args first so we can use them for the snapshot label
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(tc.function.arguments || "{}");
      } catch {
        args = {};
      }
      // Push a snapshot before mutating tools (so /undo works across subagent edits)
      const mutatingTools = new Set([
        "write_file", "edit_file", "multi_edit", "delete_file",
        "move_file", "batch_rename", "append_file", "create_dir", "update_plan",
        "apply_patch", "insert_at", "run_lua", "run_js",
      ]);
      if (mutatingTools.has(tc.function.name)) {
        const preview = (typeof args.path === "string") ? args.path : (typeof args.from === "string") ? args.from : "";
        vfs.takeSnapshot(`subagent:${tc.function.name}(${preview})`);
      }
      const toolResult: ToolResult = await dispatchTool(tc.function.name, args, {
        readOnly: opts.mode === "plan",
      });
      toolCallCount++;
      messages.push({
        role: "tool",
        content: toolResult.output,
        tool_call_id: tc.id || `tc_${Date.now()}`,
        name: tc.function.name,
      });
    }
  }

  // Hit iteration cap
  return {
    summary: lastText || "(subagent reached its iteration limit without a final summary)",
    toolCallCount,
    iterations,
    completed: false,
  };
}

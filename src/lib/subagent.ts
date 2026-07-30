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
export interface SubagentOptions {
  /** The task description for the subagent. */
  task: string;
  /** Max iterations for the subagent's agent loop. Default 8. */
  maxIterations?: number;
  /** Optional callback to receive token usage from the subagent. */
  onUsage?: (usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number }) => void;
  /** Optional callback to receive status updates (for UI display). */
  onStatus?: (status: string) => void;
  /** AbortSignal to cancel the subagent. */
  signal?: AbortSignal;
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
  // context (cache-friendly) + task description.
  const systemPrompt = buildSystemPrompt({});
  const contextBlock = buildWorkspaceContext({ mode: "bypass" });
  const messages: ChatMessage[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: contextBlock },
    { role: "user", content: `You are a subagent — a focused assistant working on a specific subtask delegated by the main agent.

## Your constraints
- You have a LIMITED budget of ${maxIter} tool-call iterations. Work efficiently.
- You do NOT see the main conversation history. Work only from the task description below.
- When you are done, write a concise summary of what you did and stop calling tools. Your final text response will be returned to the main agent.
- If you cannot complete the task, explain why in your final response and stop.

## Your task
${opts.task}

Begin. Use tools as needed, then summarize your work in your final response.` },
  ];

  let toolCallCount = 0;
  let iterations = 0;
  let lastText = "";

  for (let iter = 0; iter < maxIter; iter++) {
    iterations++;
    if (opts.signal?.aborted) break;
    opts.onStatus?.(`Subagent iteration ${iter + 1}/${maxIter}`);

    const result = await streamChatCompletionWithRetry(
      aiConfig,
      messages,
      TOOL_DEFINITIONS,
      {
        onText: (delta) => {
          lastText += delta;
        },
        onUsage: (usage) => {
          opts.onUsage?.(usage);
        },
      },
      opts.signal,
    );

    messages.push(result.message);

    if (!result.message.tool_calls || result.message.tool_calls.length === 0) {
      // Subagent is done — returned text summary
      return {
        summary: lastText || result.message.content || "(subagent returned no summary)",
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
        "move_file", "append_file", "create_dir", "update_plan",
        "apply_patch", "insert_at",
      ]);
      if (mutatingTools.has(tc.function.name)) {
        const preview = (typeof args.path === "string") ? args.path : (typeof args.from === "string") ? args.from : "";
        vfs.takeSnapshot(`subagent:${tc.function.name}(${preview})`);
      }
      const toolResult: ToolResult = await dispatchTool(tc.function.name, args);
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

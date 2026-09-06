
"use client";

import {
  streamChatCompletionWithRetry,
  type AiClientConfig,
  type ChatMessage,
  type ToolCall
} from "@/lib/ai-client";
import {
  dispatchTool,
  buildSystemPrompt,
  filterToolsByPreset,
  type ToolResult
} from "@/lib/tools/index";
import {  buildWorkspaceContext  } from "@/lib/tools/system-prompt";
import {  vfs } from "@/lib/vfs";
import {  useVfsView  } from "@/store/vfs-view";
import {
  truncateConversation
} from "@/lib/context";
import {
} from "@/lib/session-storage";
import {  runSubagent  } from "@/lib/subagent";
import {  orchestrateTask  } from "@/lib/orchestrator";
import {  apiKeyVault  } from "@/lib/api-key-vault";
import {  warmup,  tokenizerStatus,  countConversationTokensAccurate  } from "@/lib/wasm/tokenizer";
import {  uuid  } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Idle auto-lock — wipes API keys from memory after N minutes of inactivity.
// ---------------------------------------------------------------------------
import type {
  SessionState
} from "./session";
import {  shouldAutoCompact,  doCompact  } from "./session-compact";
import {  nextId,  schedulePersist  } from "./session-persist";
import {  recordUsage,  bashCommandMutates,  formatToolArgsPreview  } from "./session-helpers";

export async function runAgentLoop(
  set: (partial: Partial<SessionState> | ((s: SessionState) => Partial<SessionState>)) => void,
  get: () => SessionState,
  signal: AbortSignal,
) {
  const PER_REQUEST_TIMEOUT_MS = 300_000; // 5 minutes per AI request (long thinking)
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

  // No iteration cap — modern agents run until the task is done. The loop
  // exits naturally when the AI stops calling tools, returns an empty
  // response, or the user aborts. A runaway AI is the user's responsibility
  // (they can hit Stop).
  set({ agentMaxIterations: 0 });

  // Build static system prompt once. This NEVER changes between iterations
  // (customInstructions is user-controlled and rarely changes; agentPreset is
  // locked at session creation), ensuring the prompt prefix is stable for API
  // caching.
  const preset = get().agentPreset ?? "full";
  const STATIC_SYSTEM_PROMPT = buildSystemPrompt({
    preset,
    customInstructions: config.customInstructions,
  });
  // 按运行模式过滤模型可见的工具集（full=全部；light/minimal=白名单子集）。
  // dispatch 层仍注册全部工具——被过滤的模型看不到就不会调用。
  const ACTIVE_TOOLS = filterToolsByPreset(preset);

  let iter = 0;
  while (true) {
    if (signal.aborted) return;

    set({
      agentIteration: iter + 1,
      agentStatus: iter === 0 ? "Thinking…" : "Continuing…",
    });

    // Build fresh workspace context for this iteration — the VFS tree may
    // have changed after tool execution, and the mode may have been toggled.
    const contextBlock = buildWorkspaceContext({ mode: get().mode });

    // Apply smart truncation before sending to the AI.
    // pendingOverrideMessages: 用户在 payload 编辑器中改过的消息列表，用它
    // 替换当前历史（system/workspace-context 由 send 自行重建）。首轮消费后清空。
    const overrideMsgs = get().pendingOverrideMessages;
    const historyMsgs = overrideMsgs ?? get().messages;
    let fullMessages: ChatMessage[] = [
      { role: "system", content: STATIC_SYSTEM_PROMPT },
      // The context block is injected as a user message so that the system
      // prompt stays fully static and cacheable.
      { role: "user", content: contextBlock },
      ...historyMsgs,
    ];
    if (overrideMsgs) set({ pendingOverrideMessages: null, truncated: false });
    // 预热真分词器（fire-and-forget，不阻塞发送；本轮估算仍走字符启发式，
    // 下一轮起自动升级为 DeepSeek BPE 精确计数）。
    warmup();
    // auto-compact：真分词器就绪 + 估算超预算 85% + 距上次压缩 ≥10 条新消息
    // → 自动 LLM 摘要（信息保留）；否则由 truncateConversation 丢旧消息兜底。
    if (tokenizerStatus() === "ready") {
      const estimatedTokens = await countConversationTokensAccurate(fullMessages);
      if (shouldAutoCompact({
        autoCompact: config.autoCompact,
        isCompacting: get().isCompacting,
        estimatedTokens,
        tokenBudget: config.tokenBudget,
        messagesSinceLastCompact: get().messages.length - (get().lastCompactMsgCount ?? 0),
      })) {
        await doCompact("auto", set, get);
        // compact 已替换 get().messages——重建 fullMessages（含新注入的 context block）
        fullMessages = [
          { role: "system", content: STATIC_SYSTEM_PROMPT },
          { role: "user", content: contextBlock },
          ...get().messages,
        ];
      }
    }
    const { messages: truncatedMsgs, dropped, tokensBefore, tokensAfter } =
      await truncateConversation(fullMessages, config.tokenBudget, 10);
    if (dropped > 0) {
      set({ truncated: true });
      // Surface a system notice the FIRST time we truncate in this turn.
      if (iter === 0) {
        set((s) => ({
          events: [
            ...s.events,
            {
              id: nextId(),
              kind: "system",
              text: `Context truncated to fit token budget: dropped ${dropped} older message(s), compressed tool results. (~${tokensBefore} → ~${tokensAfter} tokens)`,
              ts: Date.now(),
            },
          ],
        }));
      }
    }
    const messagesForAI = truncatedMsgs;
    // 记录本次实际发送的 payload，供 payload-inspector 弹窗展示/编辑。
    set({ lastSentPayload: messagesForAI });

    let streamedText = "";
    let reasoning = "";
    let firstTokenReceived = false;
    let firstReasoningMs: number | null = null;
    const streamStartMs = Date.now();
    const streamEventId = nextId();
    // Don't push to events yet — use streamingText for live updates.
    // The final event is pushed once when streaming completes.
    set({ streamingText: { id: streamEventId, text: "" } });

    // Combine the user's abort signal with a per-request timeout.
    // The flag disambiguates timeout from user-abort: fetch rejects a timeout
    // abort with name === "AbortError", so e.name alone cannot tell them apart.
    let requestTimedOut = false;
    const timeoutController = new AbortController();
    const timeoutId = setTimeout(() => {
      requestTimedOut = true;
      timeoutController.abort(new DOMException("Request timed out", "TimeoutError"));
    }, PER_REQUEST_TIMEOUT_MS);
    const onUserAbort = () => timeoutController.abort(signal.reason);
    if (signal.aborted) timeoutController.abort(signal.reason);
    else signal.addEventListener("abort", onUserAbort, { once: true });

    let assistantMsg: ChatMessage;
    let finishReason: string | null = null;
    try {
      const result = await streamChatCompletionWithRetry(
        aiConfig,
        messagesForAI,
        ACTIVE_TOOLS,
        {
          onText: (delta) => {
            if (!firstTokenReceived) {
              firstTokenReceived = true;
              set({ agentStatus: "Generating response…" });
            }
            streamedText += delta;
            set({ streamingText: { id: streamEventId, text: streamedText } });
          },
          onReasoning: (delta) => {
            if (firstReasoningMs === null) firstReasoningMs = Date.now();
            reasoning += delta;
            set({ streamingReasoning: { id: streamEventId, text: reasoning } });
          },
          onUsage: (usage) => {
            recordUsage(set, usage, "main");
          },
        },
        timeoutController.signal,
      );
      assistantMsg = result.message;
      finishReason = result.finishReason;
    } catch (e) {
      clearTimeout(timeoutId);
      signal.removeEventListener("abort", onUserAbort);
      // Clear streaming text
      set({ streamingText: null, streamingReasoning: null });
      // Timeout must be checked before isAbort: a timeout abort also surfaces
      // as name === "AbortError", but should show a real error, not go silent.
      if (requestTimedOut) {
        set((s) => ({
          events: [
            ...s.events,
            {
              id: nextId(),
              kind: "error",
              text: `AI 请求超过 ${PER_REQUEST_TIMEOUT_MS / 1000 / 60} 分钟仍无响应，已中止。可能是思考内容过长或网络问题；可重试，或到设置里调大 Max tokens。`,
              ts: Date.now(),
            },
          ],
        }));
        return;
      }
      const isAbort = e instanceof Error && e.name === "AbortError";
      if (isAbort) return; // user pressed Stop — stay silent
      throw e;
    }
    clearTimeout(timeoutId);
    signal.removeEventListener("abort", onUserAbort);

    // Check finish_reason — "length" means the response was truncated at max_tokens
    if (finishReason === "length") {
      set((s) => ({
        events: [
          ...s.events,
          {
            id: nextId(),
            kind: "system" as const,
            text: `⚠️ Response was truncated at max_tokens (${config.maxTokens}). The AI's output was cut off mid-sentence or mid-JSON. Increase maxTokens in Settings, or shorten the conversation with /clear.`,
            ts: Date.now(),
          },
        ],
      }));
    }

    // Clear streaming text and push the final event to events ONCE.
    set({ streamingText: null, streamingReasoning: null });
    const hasText = streamedText.trim().length > 0;
    const hasReasoning = reasoning.trim().length > 0;
    const hasToolCalls =
      !!assistantMsg.tool_calls && assistantMsg.tool_calls.length > 0;

    // Push the final assistant event (text and/or reasoning). Reasoning-only
    // responses (e.g. thinking consumed the whole budget) still render.
    if (hasText || hasReasoning) {
      set((s) => ({
        events: [
          ...s.events,
          {
            id: streamEventId,
            kind: "assistant-message" as const,
            text: hasText ? streamedText : undefined,
            reasoning: hasReasoning ? reasoning : undefined,
            ts: Date.now(),
            durationMs: firstReasoningMs !== null ? Date.now() - firstReasoningMs : Date.now() - streamStartMs,
          },
        ],
      }));
    }

    // Append the assistant message to conversation history regardless,
    // so the AI can continue if it had tool calls.
    set((s) => ({
      messages: [...s.messages, assistantMsg],
    }));

    if (!hasToolCalls) {
      // AI is done — either it replied with text, or it returned nothing
      // at all (no text AND no reasoning). If empty, surface a system notice
      // so the user isn't left wondering what happened.
      if (!hasText && !hasReasoning) {
        set((s) => ({
          events: [
            ...s.events,
            {
              id: nextId(),
              kind: "system",
              text: "The AI returned an empty response (no text and no tool calls). This can happen with certain models or when the context is too large. Try rephrasing your message or switching models.",
              ts: Date.now(),
            },
          ],
        }));
      }
      return;
    }

    // Execute tool calls concurrently when independent. All VFS operations
    // are sync/in-memory so parallelism is safe and much faster for batches
    // like reading 5 files at once.
    if (signal.aborted) return;
    const toolCalls = assistantMsg.tool_calls;
    if (!toolCalls) return;
    if (toolCalls.length === 1) {
      set({ agentStatus: `Calling ${toolCalls[0].function.name}…` });
      await executeToolCallSafe(set, get, toolCalls[0], signal, false);
    } else {
      // Take a SINGLE snapshot before the batch so that undo reverts the
      // entire batch, not just the last tool call. With Promise.all, all
      // tool calls start simultaneously — if each took its own snapshot,
      // they'd all capture the SAME pre-batch state (race condition), and
      // one undo would wipe everything.
      const hasMutating = toolCalls.some((tc) => MUTATING_TOOLS.has(tc.function.name));
      if (hasMutating) {
        vfs.takeSnapshot(`batch:${toolCalls.length} tools`);
      }
      // Run all tool calls in parallel with skipSnapshot=true since we
      // already took the batch snapshot above.
      set({ agentStatus: `Calling ${toolCalls.length} tools…` });
      await Promise.all(
        toolCalls.map((tc) => executeToolCallSafe(set, get, tc, signal, true)),
      );
    }
    iter++;
  }
  // unreachable — loop exits via return statements above
}

/** Tools that mutate the VFS. Undo snapshots are taken before these. */
const MUTATING_TOOLS = new Set([
  "write_file", "edit_file", "multi_edit", "delete_file",
  "move_file", "batch_rename", "append_file", "create_dir", // update_plan 不在其中：计划存独立 plan store（不在 VFS），无需快照
  "apply_patch", "insert_at", "run_lua", "run_js", // run_lua/run_js 带 outputs 时写回 VFS → 需快照可 undo
  "bash", // bash 的 > / >> / tee / mkdir / rm / rmdir / touch / cp / mv / sed -i 会写 VFS
  "create_skill", "delete_skill", // 创建/删除 skill（写 skills/ 目录）→ 需快照可 undo
  "transpile", // 编译器语义：file/files/path 模式把产物写入 VFS → 需快照可 undo
  "git_commit", // git 提交（写 git 工作区）→ 需快照可 undo
]);

/** Wrapper that guarantees a tool result message is ALWAYS added to the
 *  conversation, even if executeToolCall throws. This prevents the
 *  "insufficient tool messages following tool_calls" API error that
 *  happens when a tool call fails (e.g., subagent abort) and leaves
 *  the assistant message without a matching tool response. */
export async function executeToolCallSafe(
  set: (partial: Partial<SessionState> | ((s: SessionState) => Partial<SessionState>)) => void,
  get: () => SessionState,
  tc: ToolCall,
  signal?: AbortSignal,
  skipSnapshot = false,
): Promise<void> {
  const toolCallId = tc.id || `tc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  if (!tc.id) tc.id = toolCallId;
  try {
    await executeToolCall(set, get, tc, signal, skipSnapshot);
  } catch (e) {
    // Tool execution threw — add a fallback tool result so the API
    // doesn't complain about missing tool_call_id responses.
    const errorMsg = e instanceof Error ? e.message : String(e);
    const isAbort = e instanceof Error && (e.name === "AbortError" || e.name === "TimeoutError");
    const toolMsg: ChatMessage = {
      role: "tool",
      content: isAbort
        ? `Tool execution was aborted.`
        : `Tool execution failed with error: ${errorMsg}`,
      tool_call_id: toolCallId,
      name: tc.function.name,
    };
    set((s) => ({
      messages: [...s.messages, toolMsg],
    }));
  }
}

export async function executeToolCall(
  set: (partial: Partial<SessionState> | ((s: SessionState) => Partial<SessionState>)) => void,
  get: () => SessionState,
  tc: ToolCall,
  signal?: AbortSignal,
  skipSnapshot = false,
) {
  // H3: ensure tool_call_id is non-empty (some providers don't return it)
  const toolCallId = tc.id || `tc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  if (!tc.id) tc.id = toolCallId;

  // H2: parse arguments; surface JSON errors clearly instead of swallowing
  let args: Record<string, unknown>;
  let parseError: string | null = null;
  try {
    args = JSON.parse(tc.function.arguments || "{}");
  } catch (e) {
    args = {};
    parseError = e instanceof Error ? e.message : String(e);
  }

  const callEventId = nextId();
  set((s) => ({
    events: [
      ...s.events,
      {
        id: callEventId,
        kind: "tool-call",
        toolName: tc.function.name,
        toolArgs: args,
        ts: Date.now(),
      },
    ],
  }));

  // Pre-set pendingQuestions for ask_user_input — the modal appears
  // immediately on this render cycle, without waiting for dispatchTool.
  if (tc.function.name === "ask_user_input" && !parseError) {
    const rawQuestions = args.questions as Array<Record<string, unknown>> | undefined;
    if (Array.isArray(rawQuestions) && rawQuestions.length > 0) {
      // Don't overlay existing pending questions
      if (get().pendingQuestions !== null) return;
      set({
        pendingQuestions: {
          title: args.title ? String(args.title) : "",
          description: args.description ? String(args.description) : "",
          submit_label: args.submit_label ? String(args.submit_label) : "提交",
          request_id: args.request_id ? String(args.request_id) : uuid().slice(0, 12),
          questions: rawQuestions.map((q: Record<string, unknown>) => {
            const qType = String(q.type ?? "text_input");
            const isSelect = qType === "single_select" || qType === "multi_select";
            return {
              id: q.id ? String(q.id) : `q_${uuid().slice(0, 6)}`,
              question: String(q.question),
              type: qType as "single_select" | "multi_select" | "text_input",
              options: isSelect
                ? (q.options as Array<Record<string, unknown>>)?.map((o) => ({
                    id: o.id ? String(o.id) : `opt_${uuid().slice(0, 6)}`,
                    label: String(o.label),
                    description: o.description ? String(o.description) : "",
                  })) ?? []
                : [],
              required: q.required !== false,
              allow_other: !!q.allow_other,
            };
          }),
        },
      });
    }
  }

  let result: ToolResult;
  if (parseError) {
    // Tell the AI its arguments were malformed JSON so it can retry
    result = {
      ok: false,
      output: `Failed to parse tool arguments as JSON: ${parseError}. Raw arguments (truncated): ${tc.function.arguments.slice(0, 200)}`,
      tool: tc.function.name,
      args,
    };
  } else {
    // Special-case: dispatch_subagent runs a nested agent loop with its own
    // context. Token usage is accumulated into the session.
    if (tc.function.name === "dispatch_subagent") {
      const task = String(args.task ?? "");
      const maxIter = typeof args.max_iterations === "number" ? args.max_iterations : 8;
      if (!task) {
        result = {
          ok: false,
          output: "dispatch_subagent requires a 'task' argument.",
          tool: "dispatch_subagent",
          args,
        };
      } else {
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
        set({ agentStatus: `Subagent: ${task.slice(0, 40)}…` });
        const subResult = await runSubagent(aiConfig, {
          task,
          maxIterations: maxIter,
          tokenBudget: config.tokenBudget,
          onUsage: (usage) => {
            recordUsage(set, usage, "subagent");
          },
          onStatus: (status) => {
            set({ agentStatus: `Subagent · ${status}` });
          },
          // 继承主循环模式：Plan 模式下子代理也只读（堵住绕过只读的漏洞）
          mode: get().mode,
          preset: get().agentPreset,
          signal,
        });
        // 撞迭代上限也是正常结果（部分完成），不标记失败——主代理从
        // summary 文本知道完成度；失败协议只对真正的失败生效。
        result = {
          ok: true,
          output: `Subagent ${subResult.completed ? "completed" : "stopped (hit iteration limit)"} after ${subResult.iterations} iterations, ${subResult.toolCallCount} tool calls.\n\n--- Subagent summary ---\n${subResult.summary}`,
          tool: "dispatch_subagent",
          args,
        };
      }
    } else if (tc.function.name === "orchestrate_task") {
      // Plan 模式拦截（special-case 在 Plan 检查之前，必须在此处理）：
      // orchestrate_task 产出工作产物，Plan 模式下不允许。
      if (get().mode === "plan") {
        result = {
          ok: false,
          output:
            "[Plan mode] orchestrate_task (produces work product) is blocked. " +
            "In Plan mode you can only READ and ANALYZE — propose your plan in text, " +
            "and the user will switch to Bypass mode to let you execute it.",
          tool: "orchestrate_task",
          args,
        };
      } else {
        const task = String(args.task ?? "");
        const maxSub = Math.min(Number(args.max_sub_agents) || 3, 5);
        const subMaxIter = Number(args.sub_agent_max_iterations) || 8;
        if (!task) {
          result = {
            ok: false,
            output: "orchestrate_task requires a 'task' argument.",
            tool: "orchestrate_task",
            args,
          };
        } else {
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
        set({ agentStatus: `🧠 Orchestrator: 分解任务中…` });
        try {
          const orchResult = await orchestrateTask(aiConfig, {
            task,
            maxSubAgents: maxSub,
            subAgentMaxIterations: subMaxIter,
            onStatus: (s) => {
              set({ agentStatus: `🧠 ${s}` });
            },
            onUsage: (usage) => {
              recordUsage(set, usage, "orchestrator");
            },
            signal,
            preset: get().agentPreset,
          });
          result = {
            ok: true,
            output: `Orchestration completed: ${orchResult.subTasks.length} subtasks, ${orchResult.totalToolCalls} total tool calls.\n\n--- Synthesized result ---\n${orchResult.summary}`,
            tool: "orchestrate_task",
            args,
          };
        } catch (e) {
          result = {
            ok: false,
            output: `Orchestration failed: ${e instanceof Error ? e.message : String(e)}`,
            tool: "orchestrate_task",
            args,
          };
        }
        }
      }
    } else {
      // Plan mode: block all mutating tools — AI can only read/analyze.
      // update_plan is EXEMPT: the plan is the planning artifact itself, so
      // maintaining it in Plan mode is allowed (aligned with modern agents).
      // dispatch_subagent stays allowed (read-only exploration is legal; the
      // subagent inherits the mode and runs read-only too). orchestrate_task
      // produces work product → blocked in Plan mode (in its special-case).
      const mutatingTools = new Set([
        "write_file", "edit_file", "multi_edit", "delete_file",
        "move_file", "batch_rename", "append_file", "create_dir",
        "apply_patch", "insert_at", "undo_edit", "unzip_archive",
        "create_skill", "delete_skill",
        "transpile", // 编译器语义：file/files/path 模式把产物写入 VFS → Plan 模式拦截
      ]);
      if (get().mode === "plan" && mutatingTools.has(tc.function.name)) {
        result = {
          ok: false,
          output: `[Plan mode] This tool (${tc.function.name}) is blocked. In Plan mode you can only READ and ANALYZE files — you cannot modify them. Propose your plan in text, and the user will switch to Bypass mode to let you execute it.`,
          tool: tc.function.name,
          args,
        };
      } else {
        // Push a VFS snapshot before mutating tools (for /undo).
        // When skipSnapshot is true (parallel batch), the caller already took
        // a single batch snapshot — we must not take individual ones or they'd
        // all capture the same pre-batch state (race via Promise.all).
        const isUndo = tc.function.name === "undo_edit";
        // bash writes (>/>>/tee/mkdir/rm/rmdir/touch/cp/mv/sed -i) mutate the VFS,
        // but read-only bash (ls/cat/grep) must NOT push a no-op snapshot.
        const isMutatingBash =
          tc.function.name === "bash" &&
          bashCommandMutates(typeof args.command === "string" ? args.command : "");
        if (
          !skipSnapshot &&
          !isUndo &&
          (MUTATING_TOOLS.has(tc.function.name) || isMutatingBash)
        ) {
          vfs.takeSnapshot(`${tc.function.name}(${formatToolArgsPreview(args)})`);
        }
        result = await dispatchTool(tc.function.name, args, { readOnly: get().mode === "plan" });
        // Ensure the file bag UI refreshes after any mutating tool
        if (result.mutated) useVfsView.getState().bump();
      }
    }
  }

  set((s) => ({
    events: [
      ...s.events,
      {
        id: nextId(),
        kind: "tool-result",
        toolName: tc.function.name,
        toolArgs: args,
        toolOutput: result.output,
        diff: result.diff,
        plan: result.plan,
        ok: result.ok,
        ts: Date.now(),
      },
    ],
  }));

  const toolMsg: ChatMessage = {
    role: "tool",
    content: result.output,
    tool_call_id: toolCallId,
    name: tc.function.name,
  };
  set((s) => ({
    messages: [...s.messages, toolMsg],
  }));
  // Persist after each tool execution so a crash mid-loop still saves progress.
  schedulePersist(get);
}

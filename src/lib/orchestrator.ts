/**
 * Orchestrator — hierarchical multi-agent task decomposition & execution.
 *
 * Takes a high-level task, decomposes it into independent subtasks via a cheap
 * LLM call, executes subtasks in parallel using runSubagent, and synthesizes
 * the results into a coherent summary.
 *
 * Architecture (flat fan-out, no nesting):
 *   1. decompose()       — one cheap LLM call → string[] subtask descriptions
 *   2. executeSubTasks() — Promise.all(map(runSubagent)) → SubTaskResult[]
 *   3. synthesize()      — one cheap LLM call → final summary
 */

import {
  streamChatCompletionWithRetry,
  type AiClientConfig,
  type TokenUsage,
} from "./ai-client";
import { runSubagent } from "./subagent";

export interface OrchestratorOptions {
  task: string;
  maxSubAgents?: number;
  subAgentMaxIterations?: number;
  signal?: AbortSignal;
  onStatus?: (status: string) => void;
  onUsage?: (usage: TokenUsage) => void;
}

export interface SubTaskResult {
  description: string;
  summary: string;
  toolCallCount: number;
  iterations: number;
  completed: boolean;
}

export interface OrchestratorResult {
  summary: string;
  subTasks: SubTaskResult[];
  totalToolCalls: number;
  totalIterations: number;
}

/**
 * Orchestrate a complex task: decompose → parallel execute → synthesize.
 */
export async function orchestrateTask(
  config: AiClientConfig,
  opts: OrchestratorOptions,
): Promise<OrchestratorResult> {
  const {
    task,
    maxSubAgents = 3,
    subAgentMaxIterations = 8,
    signal,
    onStatus,
    onUsage,
  } = opts;

  onStatus?.("Decomposing task…");

  // 1. Decompose
  const subTasks = await decomposeTask(config, task, maxSubAgents, signal);
  if (subTasks.length === 0) {
    // Fall back to a single sub-agent if decomposition fails
    onStatus?.("Running single sub-agent (decomposition skipped)…");
    const result = await runSubagent(config, {
      task,
      maxIterations: subAgentMaxIterations * 2,
      signal,
      onUsage,
    });
    const singleResult: SubTaskResult = {
      description: task,
      summary: result.summary,
      toolCallCount: result.toolCallCount,
      iterations: result.iterations,
      completed: result.completed,
    };
    return {
      summary: result.summary,
      subTasks: [singleResult],
      totalToolCalls: result.toolCallCount,
      totalIterations: result.iterations,
    };
  }

  // 2. Execute in parallel
  onStatus?.(`Running ${subTasks.length} sub-agents in parallel…`);
  const subTaskResults = await executeSubTasks(
    config,
    subTasks,
    subAgentMaxIterations,
    signal,
    onStatus,
    onUsage,
  );

  // 3. Synthesize
  onStatus?.("Synthesizing results…");
  const summary = await synthesizeResults(
    config,
    task,
    subTaskResults,
    signal,
  );

  const totalToolCalls = subTaskResults.reduce((s, r) => s + r.toolCallCount, 0);
  const totalIterations = subTaskResults.reduce((s, r) => s + r.iterations, 0);

  return {
    summary,
    subTasks: subTaskResults,
    totalToolCalls,
    totalIterations,
  };
}

// ---------------------------------------------------------------------------
// Step 1: Decompose
// ---------------------------------------------------------------------------

async function decomposeTask(
  config: AiClientConfig,
  task: string,
  maxSubTasks: number,
  signal?: AbortSignal,
): Promise<string[]> {
  const prompt = `Decompose the following task into at most ${maxSubTasks} independent subtasks that can be worked on in parallel. Each subtask should produce work product (code, files, analysis).

Rules:
- Each subtask must be INDEPENDENT — no ordering dependencies between them.
- Each subtask must be completable within ~8 tool-call iterations.
- Prefer subtasks that produce files or make measurable progress.
- Return ONLY a valid JSON array of strings, no other text.

Task: ${task}

Output format: ["subtask 1 description", "subtask 2 description", ...]`;

  let collected = "";

  try {
    const result = await streamChatCompletionWithRetry(
      config,
      [
        { role: "system" as const, content: "You are a task decomposition expert. Output only valid JSON arrays." },
        { role: "user" as const, content: prompt },
      ],
      [], // no tools needed
      {
        onText: (delta) => { collected += delta; },
      },
      signal,
      2,
    );

    // Try to extract JSON array from the response
    const text = result.message?.content || collected;
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return [];
    const parsed = JSON.parse(jsonMatch[0]);
    if (Array.isArray(parsed) && parsed.length > 0) {
      return parsed.slice(0, maxSubTasks).map(String);
    }
    return [];
  } catch (e) {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Step 2: Execute subtasks in parallel
// ---------------------------------------------------------------------------

async function executeSubTasks(
  config: AiClientConfig,
  subTasks: string[],
  maxIterations: number,
  signal?: AbortSignal,
  onStatus?: (status: string) => void,
  onUsage?: (usage: TokenUsage) => void,
): Promise<SubTaskResult[]> {
  const total = subTasks.length;
  const completed = new Array(total).fill(false);

  const results = await Promise.all(
    subTasks.map(async (description, index) => {
      if (signal?.aborted) {
        completed[index] = true;
        return {
          description,
          summary: "[Subtask cancelled]",
          toolCallCount: 0,
          iterations: 0,
          completed: false,
        };
      }
      onStatus?.(`子任务 ${index + 1}/${total}: ${description.slice(0, 50)}…`);
      try {
        const result = await runSubagent(config, {
          task: description,
          maxIterations,
          signal,
          onStatus: (s) => onStatus?.(`子任务 ${index + 1}/${total}: ${description.slice(0, 30)} → ${s}`),
          onUsage,
        });
        completed[index] = true;
        const doneCount = completed.filter(Boolean).length;
        onStatus?.(`✅ 子任务 ${index + 1}/${total} 完成 (${doneCount}/${total})`);
        return {
          description,
          summary: result.summary,
          toolCallCount: result.toolCallCount,
          iterations: result.iterations,
          completed: result.completed,
        };
      } catch (e) {
        completed[index] = true;
        return {
          description,
          summary: `[Subtask error: ${e instanceof Error ? e.message : String(e)}]`,
          toolCallCount: 0,
          iterations: 0,
          completed: false,
        };
      }
    }),
  );

  return results;
}

// ---------------------------------------------------------------------------
// Step 3: Synthesize results
// ---------------------------------------------------------------------------

async function synthesizeResults(
  config: AiClientConfig,
  originalTask: string,
  results: SubTaskResult[],
  signal?: AbortSignal,
): Promise<string> {
  const resultsBlock = results
    .map((r, i) => `## Subtask ${i + 1}: ${r.description}\n${r.summary}`)
    .join("\n\n");

  const prompt = `I delegated a task to several sub-agents. Synthesize their individual results into a coherent summary. Focus on what was accomplished, what was created or modified, and any unresolved issues.

Original task: ${originalTask}

Sub-agent results:
${resultsBlock}

Provide a concise, organized summary of the overall outcome.`;

  let collected = "";

  try {
    const result = await streamChatCompletionWithRetry(
      config,
      [
        { role: "system" as const, content: "You synthesize multi-agent work into clear summaries." },
        { role: "user" as const, content: prompt },
      ],
      [],
      {
        onText: (delta) => { collected += delta; },
      },
      signal,
      2,
    );

    return result.message?.content || collected;
  } catch (e) {
    return results
      .map((r) => `**${r.description}**: ${r.summary}`)
      .join("\n\n");
  }
}

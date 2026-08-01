import { useSession } from "@/store/session";
import type { ToolResult } from "./types";
import { uuid } from "@/lib/utils";

async function toolAskUserInput(args: Record<string, unknown>): Promise<ToolResult> {
  // Check if there are already pending questions — don't overlay them
  if (useSession.getState().pendingQuestions !== null) {
    return {
      ok: false,
      output: "用户还有未回答的问题，请等待用户先完成当前问答后再发起新的提问。",
      tool: "ask_user_input",
      args,
    };
  }
  const rawQuestions = args.questions as Array<Record<string, unknown>> | undefined;
  if (!Array.isArray(rawQuestions) || rawQuestions.length === 0) {
    return {
      ok: false,
      output: "ask_user_input requires at least one question in the 'questions' array.",
      tool: "ask_user_input",
      args,
    };
  }
  for (const q of rawQuestions) {
    if (!q.question || !q.type) {
      return {
        ok: false,
        output: `Invalid question: each question must have 'question' (string) and 'type' ("single_select"|"multi_select"|"text_input"). For single_select/multi_select, provide 'options' (array).`,
        tool: "ask_user_input",
        args,
      };
    }
    if ((q.type === "single_select" || q.type === "multi_select") && !Array.isArray(q.options)) {
      return {
        ok: false,
        output: `Invalid question "${q.question}": single_select and multi_select questions require an 'options' array.`,
        tool: "ask_user_input",
        args,
      };
    }
  }
  const panel = {
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
  };
  useSession.getState().setPendingQuestions(panel);
  return {
    ok: true,
    output: `[等待用户回答] 已展示 ${panel.questions.length} 个问题（request_id: ${panel.request_id}），等待用户提交答案…`,
    tool: "ask_user_input",
    args,
  };
}

export { toolAskUserInput };

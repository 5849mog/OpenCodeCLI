"use client";

import { useEffect, useState } from "react";
import type { QuestionPanelData } from "@/store/session";

// ---------------------------------------------------------------------------
// QuestionModal — modal overlay that wraps QuestionPanel
// Appears as a centered card with backdrop when AI calls ask_user_input.
// 支持 Esc/点击遮罩取消（此前弹出后只能提交，用户被锁死在表单里）。
// 取消时 AI 会收到一条「用户未作答」提示并自行决定下一步。
// ---------------------------------------------------------------------------

export function QuestionModal({
  panel,
  onSubmit,
  onCancel,
}: {
  panel: QuestionPanelData;
  onSubmit: (answers: Record<string, string | string[]>) => void;
  onCancel?: () => void;
}) {
  useEffect(() => {
    if (!onCancel) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="AI 提问"
      onClick={(e) => {
        if (e.target === e.currentTarget && onCancel) onCancel();
      }}
    >
      <div className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-xl border border-[#DEDEDE] bg-[#FFFFFF] shadow-2xl dark:border-[#333333] glass-surface">
        <QuestionPanel panel={panel} onSubmit={onSubmit} onCancel={onCancel} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// QuestionPanel — structured question form for ask_user_input tool
// ---------------------------------------------------------------------------

export function QuestionPanel({
  panel,
  onSubmit,
  onCancel,
}: {
  panel: QuestionPanelData;
  onSubmit: (answers: Record<string, string | string[]>) => void;
  onCancel?: () => void;
}) {
  const [answers, setAnswers] = useState<Record<string, string | string[]>>({});
  const [otherInputs, setOtherInputs] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});

  const setAnswer = (qId: string, value: string | string[]) => {
    setAnswers((prev) => ({ ...prev, [qId]: value }));
    // Clear error on change
    if (errors[qId]) setErrors((prev) => ({ ...prev, [qId]: "" }));
  };

  const toggleOption = (qId: string, optId: string) => {
    const current = (answers[qId] as string[]) ?? [];
    const next = current.includes(optId)
      ? current.filter((id) => id !== optId)
      : [...current, optId];
    setAnswer(qId, next);
  };

  const setOther = (qId: string, val: string) => {
    setOtherInputs((prev) => ({ ...prev, [qId]: val }));
  };

  const handleSubmit = () => {
    const newErrors: Record<string, string> = {};
    const finalAnswers: Record<string, string | string[]> = { ...answers };

    for (const q of panel.questions) {
      const val = finalAnswers[q.id];
      const hasOther = q.allow_other && (Array.isArray(val) ? val.includes("__other__") : val === "__other__");
      // Collect "other" text into answer
      if (hasOther && otherInputs[q.id]?.trim()) {
        if (Array.isArray(val)) {
          finalAnswers[q.id] = [
            ...val.filter((v) => v !== "__other__"),
            otherInputs[q.id].trim(),
          ];
        } else {
          finalAnswers[q.id] = otherInputs[q.id].trim();
        }
      }
      // Required validation
      if (q.required) {
        const answer = finalAnswers[q.id];
        if (!answer || (Array.isArray(answer) && answer.length === 0)) {
          newErrors[q.id] = "请回答此问题";
        }
      }
    }

    setErrors(newErrors);
    if (Object.keys(newErrors).length > 0) return;
    onSubmit(finalAnswers);
  };

  return (
    <div className="rounded-lg border border-[#E58F67]/30 bg-[#FFFFFF] shadow-sm dark:bg-[#161616]">
      {/* Header */}
      {panel.title && (
        <div className="border-b border-[#DEDEDE] px-5 py-3 dark:border-[#333333]">
          <h3 className="text-sm font-semibold text-[#262626] dark:text-zinc-100">{panel.title}</h3>
          {panel.description && (
            <p className="mt-0.5 text-xs text-[#8C8C8C] dark:text-zinc-400">{panel.description}</p>
          )}
        </div>
      )}

      {/* Questions */}
      <div className="space-y-4 px-5 py-4">
        {panel.questions.map((q, qi) => (
          <div key={q.id}>
            <div className="mb-2 text-sm font-medium text-[#262626] dark:text-zinc-200">
              <span>{qi + 1}. {q.question}</span>
              {q.required && <span className="ml-1 text-[#E54D2E]">*</span>}
            </div>

            {q.type === "single_select" ? (
              <div className="space-y-1.5">
                {q.options.map((opt) => {
                  const selected = answers[q.id] === opt.id;
                  return (
                    <label
                      key={opt.id}
                      className={`flex cursor-pointer items-start gap-2.5 rounded-md border px-3 py-2 text-sm transition-colors ${
                        selected
                          ? "border-[#E58F67] bg-[#E58F67]/8"
                          : "border-[#DEDEDE] bg-[#FAFAFA] hover:border-[#D4D4D4] dark:border-[#333333] dark:bg-[#0A0A0A] dark:hover:border-[#4D4D4D]"
                      }`}
                    >
                      <input
                        type="radio"
                        name={q.id}
                        value={opt.id}
                        checked={selected}
                        onChange={() => setAnswer(q.id, opt.id)}
                        className="mt-0.5 h-3.5 w-3.5 accent-[#E58F67]"
                      />
                      <div>
                        <div className="text-[#262626] dark:text-zinc-200">{opt.label}</div>
                        {opt.description && (
                          <div className="mt-0.5 text-[length:var(--font-size-ui-sm)] text-[#8C8C8C] dark:text-zinc-400">{opt.description}</div>
                        )}
                      </div>
                    </label>
                  );
                })}
                {q.allow_other && (
                  <div>
                    <label
                      className={`flex cursor-pointer items-start gap-2.5 rounded-md border px-3 py-2 text-sm transition-colors ${
                        answers[q.id] === "__other__"
                          ? "border-[#E58F67] bg-[#E58F67]/8"
                          : "border-[#DEDEDE] bg-[#FAFAFA] hover:border-[#D4D4D4] dark:border-[#333333] dark:bg-[#0A0A0A] dark:hover:border-[#4D4D4D]"
                      }`}
                    >
                      <input
                        type="radio"
                        name={q.id}
                        value="__other__"
                        checked={answers[q.id] === "__other__"}
                        onChange={() => setAnswer(q.id, "__other__")}
                        className="mt-0.5 h-3.5 w-3.5 accent-[#E58F67]"
                      />
                      <span className="text-[#262626] dark:text-zinc-200">其他</span>
                    </label>
                    {answers[q.id] === "__other__" && (
                      <input
                        type="text"
                        value={otherInputs[q.id] ?? ""}
                        onChange={(e) => setOther(q.id, e.target.value)}
                        placeholder="请输入…"
                        className="mt-1.5 ml-7 w-full rounded border border-[#DEDEDE] bg-[#FAFAFA] px-3 py-1.5 text-sm focus:border-[#E58F67] focus:outline-none dark:border-[#333333] dark:bg-[#0A0A0A] dark:text-zinc-100"
                        autoFocus
                      />
                    )}
                  </div>
                )}
              </div>
            ) : q.type === "multi_select" ? (
              // multi_select
              <div className="space-y-1.5">
                {q.options.map((opt) => {
                  const selected = ((answers[q.id] as string[]) ?? []).includes(opt.id);
                  return (
                    <label
                      key={opt.id}
                      className={`flex cursor-pointer items-start gap-2.5 rounded-md border px-3 py-2 text-sm transition-colors ${
                        selected
                          ? "border-[#E58F67] bg-[#E58F67]/8"
                          : "border-[#DEDEDE] bg-[#FAFAFA] hover:border-[#D4D4D4] dark:border-[#333333] dark:bg-[#0A0A0A] dark:hover:border-[#4D4D4D]"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={selected}
                        onChange={() => toggleOption(q.id, opt.id)}
                        className="mt-0.5 h-3.5 w-3.5 accent-[#E58F67]"
                      />
                      <div>
                        <div className="text-[#262626] dark:text-zinc-200">{opt.label}</div>
                        {opt.description && (
                          <div className="mt-0.5 text-[length:var(--font-size-ui-sm)] text-[#8C8C8C] dark:text-zinc-400">{opt.description}</div>
                        )}
                      </div>
                    </label>
                  );
                })}
                {q.allow_other && (
                  <div>
                    <label className="flex cursor-pointer items-start gap-2.5 rounded-md border border-[#DEDEDE] bg-[#FAFAFA] px-3 py-2 text-sm hover:border-[#D4D4D4] dark:border-[#333333] dark:bg-[#0A0A0A] dark:hover:border-[#4D4D4D]">
                      <input
                        type="checkbox"
                        checked={((answers[q.id] as string[]) ?? []).includes("__other__")}
                        onChange={() => toggleOption(q.id, "__other__")}
                        className="mt-0.5 h-3.5 w-3.5 accent-[#E58F67]"
                      />
                      <span className="text-[#262626] dark:text-zinc-200">其他</span>
                    </label>
                    {((answers[q.id] as string[]) ?? []).includes("__other__") && (
                      <input
                        type="text"
                        value={otherInputs[q.id] ?? ""}
                        onChange={(e) => setOther(q.id, e.target.value)}
                        placeholder="请输入…"
                        className="mt-1.5 ml-7 w-full rounded border border-[#DEDEDE] bg-[#FAFAFA] px-3 py-1.5 text-sm focus:border-[#E58F67] focus:outline-none dark:border-[#333333] dark:bg-[#0A0A0A] dark:text-zinc-100"
                        autoFocus
                      />
                    )}
                  </div>
                )}
              </div>
            ) : (
              // text_input
              <div>
                <textarea
                  value={(answers[q.id] as string) ?? ""}
                  onChange={(e) => setAnswer(q.id, e.target.value)}
                  placeholder="请输入…"
                  rows={3}
                  className="w-full resize-none rounded border border-[#DEDEDE] bg-[#FAFAFA] px-3 py-2 text-sm focus:border-[#E58F67] focus:outline-none dark:border-[#333333] dark:bg-[#0A0A0A] dark:text-zinc-100"
                />
              </div>
            )}

            {/* Error message */}
            {errors[q.id] && (
              <div className="mt-1 text-xs text-[#E54D2E]">{errors[q.id]}</div>
            )}
          </div>
        ))}
      </div>

      {/* Submit */}
      <div className="flex items-center gap-3 border-t border-[#DEDEDE] px-5 py-3 dark:border-[#333333]">
        <button
          onClick={handleSubmit}
          className="rounded-lg bg-[#E58F67] px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-[#C66B4A]"
        >
          {panel.submit_label}
        </button>
        {onCancel && (
          <button
            onClick={onCancel}
            className="rounded-lg px-3 py-2 text-sm text-[#8C8C8C] transition-colors hover:text-[#262626] dark:text-zinc-500 dark:hover:text-zinc-300"
          >
            跳过（不回答）
          </button>
        )}
      </div>
    </div>
  );
}

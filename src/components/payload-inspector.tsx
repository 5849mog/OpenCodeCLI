"use client";

/**
 * Payload inspector — view and edit the ACTUAL context that was sent to the
 * AI server on the last request (/inspect command).
 *
 * Design (per user requirements):
 *   - The system prompt and the workspace-context block are architectural /
 *     model-mandated — shown for context but READ-ONLY (grayed, not editable).
 *   - The conversation messages (the rest) are fully editable: content,
 *     reorder not needed — delete, edit, append new ones.
 *   - "Apply" writes the edited message list to `pendingOverrideMessages` in
 *     the session store; the NEXT send uses it in place of the live history
 *     (system + workspace context are rebuilt by send itself).
 */

import { useEffect, useState } from "react";
import { X, Eye, Plus, Trash2, RotateCcw, Check } from "lucide-react";
import { useSession } from "@/store/session";
import type { ChatMessage } from "@/lib/ai-client";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

const ROLE_LABEL: Record<ChatMessage["role"], string> = {
  system: "System",
  user: "User",
  assistant: "Assistant",
  tool: "Tool",
};

export function PayloadInspector({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const lastSentPayload = useSession((s) => s.lastSentPayload);
  const setPendingOverrideMessages = useSession((s) => s.setPendingOverrideMessages);

  // Local working copy of the editable messages (payload[2..] = conversation
  // history). Hydrated fresh whenever the dialog opens or the payload changes.
  const [editable, setEditable] = useState<ChatMessage[]>([]);

  useEffect(() => {
    if (open) {
      // The first two entries are system + workspace-context (read-only).
      setEditable(lastSentPayload && lastSentPayload.length > 0
        ? lastSentPayload.slice(2).map((m) => ({ ...m }))
        : []);
    }
  }, [open, lastSentPayload]);

  if (!open) return null;

  const systemMsg = lastSentPayload?.[0] ?? null;
  const contextMsg = lastSentPayload?.[1] ?? null;

  const updateMsg = (idx: number, patch: Partial<ChatMessage>) => {
    setEditable((prev) => prev.map((m, i) => (i === idx ? { ...m, ...patch } : m)));
  };
  const removeMsg = (idx: number) => {
    setEditable((prev) => prev.filter((_, i) => i !== idx));
  };
  const addMsg = (role: ChatMessage["role"]) => {
    setEditable((prev) => [...prev, { role, content: "" }]);
  };
  const resetAll = () => {
    if (lastSentPayload) setEditable(lastSentPayload.slice(2).map((m) => ({ ...m })));
  };
  const apply = () => {
    setPendingOverrideMessages(editable);
    toast.success("已应用修改——下一次发送将使用编辑后的上下文");
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-lg border border-[#E5E2D9] bg-[#FFFFFF] text-[#2D2B27] shadow-2xl dark:border-[#3a3731] dark:bg-[#1c1a17] dark:text-zinc-100">
        {/* Header */}
        <div className="flex items-center gap-2 border-b border-[#E5E2D9] px-5 py-4 dark:border-[#3a3731]">
          <Eye className="h-5 w-5 text-[#D97757]" />
          <h2 className="text-lg font-semibold">Payload Inspector · 发送给 AI 的上下文</h2>
          <button
            onClick={onClose}
            className="ml-auto rounded p-1.5 text-[#8B8884] hover:bg-[#F0EDE5] hover:text-[#3D3B37] dark:text-zinc-500 dark:hover:bg-[#2a2723] dark:hover:text-zinc-200"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Hint */}
        <div className="border-b border-[#E5E2D9] px-5 py-2 text-[11px] text-[#8B8884] dark:border-[#3a3731] dark:text-zinc-500">
          展示的是<b>上一次实际发送</b>给 AI 服务器的完整上下文。前两段（System / 工作区上下文）由系统生成，只读不可改；下方的对话消息可编辑、可增删——点「应用修改」后，下一次发送会使用编辑后的上下文。
        </div>

        {/* Message list */}
        <div className="flex-1 space-y-2 overflow-y-auto px-5 py-4 [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-[#D6D3CE] dark:[&::-webkit-scrollbar-thumb]:bg-[#3a3731]">
          {/* Read-only: system */}
          {systemMsg && (
            <ReadOnlyRow label="System (只读)" role="system" message={systemMsg} />
          )}
          {/* Read-only: workspace context */}
          {contextMsg && (
            <ReadOnlyRow label="工作区上下文 · Workspace context (只读)" role="user" message={contextMsg} />
          )}

          {/* Editable: conversation history */}
          {editable.length === 0 && (
            <div className="rounded border border-dashed border-[#E5E2D9] px-4 py-6 text-center text-xs text-[#8B8884] dark:border-[#3a3731] dark:text-zinc-500">
              没有可编辑的消息（上次发送的内容可能全部是系统部分，或尚未发送）。
            </div>
          )}
          {editable.map((m, i) => (
            <div key={i} className="rounded-lg border border-[#E5E2D9] bg-[#FAF9F7] dark:border-[#3a3731] dark:bg-[#161512]">
              <div className="flex items-center gap-2 px-3 py-1.5">
                <span className={cn(
                  "rounded px-1.5 py-0.5 text-[10px] font-semibold",
                  m.role === "user" && "bg-sky-100 text-sky-700 dark:bg-sky-950/50 dark:text-sky-300",
                  m.role === "assistant" && "bg-violet-100 text-violet-700 dark:bg-violet-950/50 dark:text-violet-300",
                  m.role === "tool" && "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300",
                  m.role === "system" && "bg-zinc-200 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400",
                )}>
                  {ROLE_LABEL[m.role]}
                </span>
                {m.name && <span className="font-mono text-[10px] text-[#8B8884] dark:text-zinc-500">{m.name}</span>}
                <span className="ml-auto text-[10px] text-[#A8A29E] dark:text-zinc-600">
                  {m.content ? `${m.content.length} chars` : "empty"}
                </span>
                <button
                  onClick={() => removeMsg(i)}
                  title="删除这条消息"
                  className="rounded p-1 text-[#8B8884] hover:bg-red-100 hover:text-red-600 dark:text-zinc-500 dark:hover:bg-red-950/40 dark:hover:text-red-400"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
              <div className="px-3 pb-3">
                <textarea
                  value={m.content ?? ""}
                  onChange={(e) => updateMsg(i, { content: e.target.value })}
                  rows={Math.max(2, Math.min(12, Math.ceil((m.content?.length ?? 0) / 80)))}
                  placeholder="消息内容…"
                  className="w-full resize-y rounded border border-[#E5E2D9] bg-[#FFFFFF] px-3 py-2 font-mono text-xs focus:border-[#D97757] focus:outline-none dark:border-[#3a3731] dark:bg-[#1c1a17] dark:text-zinc-100"
                />
              </div>
            </div>
          ))}

          {/* Add message */}
          <div className="flex items-center gap-2 rounded-lg border border-dashed border-[#E5E2D9] px-3 py-2 dark:border-[#3a3731]">
            <Plus className="h-4 w-4 text-[#8B8884] dark:text-zinc-500" />
            <span className="text-xs text-[#8B8884] dark:text-zinc-500">添加消息:</span>
            {(["user", "assistant", "tool"] as const).map((r) => (
              <button
                key={r}
                onClick={() => addMsg(r)}
                className="rounded border border-[#E5E2D9] px-2 py-0.5 text-[11px] text-[#3D3B37] hover:bg-[#F0EDE5] dark:border-[#3a3731] dark:text-zinc-300 dark:hover:bg-[#2a2723]"
              >
                {ROLE_LABEL[r]}
              </button>
            ))}
            <button
              onClick={resetAll}
              title="恢复为上次发送的内容"
              className="ml-auto flex items-center gap-1 rounded border border-[#E5E2D9] px-2 py-0.5 text-[11px] text-[#8B8884] hover:bg-[#F0EDE5] dark:border-[#3a3731] dark:text-zinc-500 dark:hover:bg-[#2a2723]"
            >
              <RotateCcw className="h-3 w-3" /> 重置
            </button>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-[#E5E2D9] px-5 py-3 dark:border-[#3a3731]">
          <div className="text-xs text-[#8B8884] dark:text-zinc-500">
            {editable.length} 条可编辑消息 · 应用到下一次发送（不写入历史）
          </div>
          <button
            onClick={apply}
            className="flex items-center gap-1.5 rounded bg-[#D97757] px-4 py-2 text-sm font-medium text-white hover:bg-[#C66B4A]"
          >
            <Check className="h-4 w-4" /> 应用修改
          </button>
        </div>
      </div>
    </div>
  );
}

/** Read-only message row — used for the system prompt and workspace context. */
function ReadOnlyRow({
  label,
  role,
  message,
}: {
  label: string;
  role: ChatMessage["role"];
  message: ChatMessage;
}) {
  const [expanded, setExpanded] = useState(false);
  const content = message.content ?? "";
  const preview = content.length > 200 ? content.slice(0, 200) + "…" : content;
  return (
    <div className="rounded-lg border border-dashed border-[#D6D3CE] bg-[#F5F3EE] dark:border-[#52504b] dark:bg-[#201e1a]">
      <div className="flex items-center gap-2 px-3 py-1.5">
        <span className="rounded bg-zinc-200 px-1.5 py-0.5 text-[10px] font-semibold text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
          {ROLE_LABEL[role]}
        </span>
        <span className="text-[11px] font-medium text-[#8B8884] dark:text-zinc-500">{label}</span>
        <span className="ml-auto text-[10px] text-[#A8A29E] dark:text-zinc-600">
          {content.length} chars · 锁定
        </span>
        <button
          onClick={() => setExpanded((e) => !e)}
          className="rounded border border-[#E5E2D9] px-2 py-0.5 text-[11px] text-[#8B8884] hover:bg-[#F0EDE5] dark:border-[#3a3731] dark:text-zinc-500 dark:hover:bg-[#2a2723]"
        >
          {expanded ? "收起" : "展开"}
        </button>
      </div>
      {expanded && (
        <div className="max-h-64 overflow-y-auto px-3 pb-3">
          <pre className="whitespace-pre-wrap break-words font-mono text-xs text-[#3D3B37] dark:text-zinc-300">
            {content}
          </pre>
        </div>
      )}
      {!expanded && (
        <div className="px-3 pb-3">
          <pre className="whitespace-pre-wrap break-words font-mono text-xs text-[#8B8884] dark:text-zinc-500">
            {preview}
          </pre>
        </div>
      )}
    </div>
  );
}

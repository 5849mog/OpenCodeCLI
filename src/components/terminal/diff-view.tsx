"use client";

import { cn } from "@/lib/utils";
import { lineDiff } from "@/lib/diff";

// ---------------------------------------------------------------------------
// Diff view — line based, like Open Code
// ---------------------------------------------------------------------------

export function DiffView({ before, after }: { before: string; after: string }) {
  // 新文件（before 为空）：不要显示"幽灵空行删除"，只显示新增行。
  const beforeLines = before.length === 0 ? [] : before.split("\n");
  const afterLines = after.split("\n");
  const diff = lineDiff(beforeLines, afterLines);

  return (
    <div className="overflow-x-auto rounded border border-[#DEDEDE] bg-[#FFFFFF] text-[length:var(--font-size-code)] [&::-webkit-scrollbar]:h-2 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-[#D4D4D4] dark:border-[#333333] dark:bg-[#0d0d0b] dark:[&::-webkit-scrollbar-thumb]:bg-[#333333]">
      <table className="min-w-full border-collapse font-mono">
        <tbody>
          {diff.map((row, i) => (
            <tr
              key={i}
              className={cn(
                row.type === "add" && "bg-[#E58F67]/10",
                row.type === "del" && "bg-red-950/30",
              )}
            >
              <td className="w-8 select-none border-r border-[#DEDEDE] px-1 text-right text-[#A6A6A6] dark:border-[#333333] dark:text-zinc-500">
                {row.leftNum ?? ""}
              </td>
              <td className="w-8 select-none border-r border-[#DEDEDE] px-1 text-right text-[#A6A6A6] dark:border-[#333333] dark:text-zinc-500">
                {row.rightNum ?? ""}
              </td>
              <td
                className={cn(
                  "whitespace-pre-wrap break-all px-2",
                  row.type === "add" && "text-emerald-300 dark:text-[#6ee7b7]",
                  row.type === "del" && "text-[#E54D2E]",
                  row.type === "ctx" && "text-[#6B6B6B] dark:text-zinc-400",
                )}
              >
                <span className="select-none mr-1">
                  {row.type === "add" ? "+" : row.type === "del" ? "-" : " "}
                </span>
                {row.text}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

"use client";

/**
 * confirm / prompt 弹窗 — Promise 风格 API，替换原生 window.confirm/prompt。
 *
 * 原生弹窗阻塞主线程、浅色主题与全站深色 UI 冲突。用法：
 *   const ok = await confirmDialog({ title: "删除文件？", destructive: true });
 *   const name = await promptDialog({ title: "重命名会话", initial: "新会话" });
 *
 * 需要在根组件挂载一次 <DialogHost />（page.tsx 已挂）。
 */

import { useEffect, useRef, useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";

interface DialogRequest {
  title: string;
  description?: string;
  confirmText?: string;
  cancelText?: string;
  destructive?: boolean;
  /** 输入模式（prompt）：initial 为初始值，返回 null 表示取消 */
  input?: { initial?: string; placeholder?: string; maxLength?: number };
  resolve: (value: boolean | string | null) => void;
}

let dispatchRequest: ((req: DialogRequest) => void) | null = null;

export function confirmDialog(opts: {
  title: string;
  description?: string;
  confirmText?: string;
  cancelText?: string;
  destructive?: boolean;
}): Promise<boolean> {
  return new Promise((resolve) => {
    dispatchRequest?.({
      ...opts,
      resolve: (v) => resolve(v === true),
    });
  });
}

export function promptDialog(opts: {
  title: string;
  description?: string;
  confirmText?: string;
  input?: { initial?: string; placeholder?: string; maxLength?: number };
}): Promise<string | null> {
  return new Promise((resolve) => {
    dispatchRequest?.({
      ...opts,
      resolve: (v) => resolve(typeof v === "string" ? v : null),
    });
  });
}

export function DialogHost() {
  const [req, setReq] = useState<DialogRequest | null>(null);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    dispatchRequest = (r) => {
      setReq(r);
      setDraft(r.input?.initial ?? "");
    };
    return () => {
      dispatchRequest = null;
    };
  }, []);

  const finish = (value: boolean | string | null) => {
    req?.resolve(value);
    setReq(null);
  };

  return (
    <AlertDialog
      open={req !== null}
      onOpenChange={(open) => {
        // Esc / 遮罩关闭 = 取消
        if (!open && req) finish(req.input ? null : false);
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{req?.title}</AlertDialogTitle>
          {req?.description && (
            <AlertDialogDescription>{req.description}</AlertDialogDescription>
          )}
        </AlertDialogHeader>
        {req?.input && (
          <input
            ref={inputRef}
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && draft.trim()) finish(draft);
            }}
            placeholder={req.input.placeholder}
            maxLength={req.input.maxLength}
            className="w-full rounded-md border border-[#DEDEDE] bg-transparent px-3 py-2 text-sm outline-none focus:border-[#E58F67] dark:border-[#3F3F46] dark:text-zinc-200"
          />
        )}
        <AlertDialogFooter>
          <AlertDialogCancel onClick={() => finish(req?.input ? null : false)}>
            {req?.cancelText ?? "取消"}
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={() => finish(req?.input ? draft : true)}
            disabled={req?.input ? !draft.trim() : false}
            className={cn(
              req?.destructive &&
                "bg-[#E54D2E] text-white hover:bg-[#C93E22] dark:bg-[#E54D2E] dark:text-white dark:hover:bg-[#C93E22]",
            )}
          >
            {req?.confirmText ?? "确定"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

"use client";

/**
 * zip-picker.tsx — zip 工具的"工具→UI"桥（仿 ask_user_input）。
 *
 *   ZipDownloadBridge: zip_archive 工具产出的真实 zip blob → 触发浏览器下载。
 *   ZipPickerModal:    unzip_archive 工具 → 弹文件选择，选完解压写 VFS，结果以 user 消息回流。
 */

import { useEffect, useRef } from "react";
import { useSession } from "@/store/session";
import { useVfsView } from "@/store/vfs-view";
import { vfs } from "@/lib/vfs";
import { toast } from "sonner";
import { extractZipFile, summarizeExtractResult } from "@/lib/tools/zip";
import { downloadBlob } from "@/lib/download";

/** zip_archive 工具产物 → 触发浏览器下载。无 pending 时返回 null。 */
export function ZipDownloadBridge() {
  const pending = useSession((s) => s.pendingDownload);
  const clear = useSession((s) => s.setPendingDownload);

  useEffect(() => {
    if (!pending) return;
    downloadBlob(pending.blob, pending.filename);
    clear(null);
  }, [pending, clear]);

  return null;
}

/** unzip_archive 工具 → 弹文件选择，选完解压写 VFS，结果以 user 消息回流。 */
export function ZipPickerModal() {
  const pending = useSession((s) => s.pendingZipRequest);
  const isStreaming = useSession((s) => s.isStreaming);
  const send = useSession((s) => s.send);
  const setPendingZipRequest = useSession((s) => s.setPendingZipRequest);
  const inputRef = useRef<HTMLInputElement>(null);

  // 尽力自动弹出文件选择器；可能被浏览器拦截，模态里有可见按钮兜底
  useEffect(() => {
    if (pending) inputRef.current?.click();
  }, [pending]);

  if (!pending) return null;

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    // Agent 运行中拒绝处理但不清 pending——避免"解压了但 AI 不知道"
    if (isStreaming) {
      toast.warning("Agent 仍在运行，请稍后再选择");
      return;
    }
    const reqId = pending.requestId;
    setPendingZipRequest(null);
    try {
      vfs.takeSnapshot(`unzip_archive: ${f.name}`); // 供 /undo
      const res = await extractZipFile(f);
      useVfsView.getState().bump();
      send(`[用户已选择 zip 文件: ${f.name}] (request_id: ${reqId})\n${summarizeExtractResult(res)}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`解压失败: ${msg}`);
      send(`[用户选择 zip 文件后解压失败] ${f.name}: ${msg}`);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-md rounded-xl border border-[#E5E2D9] bg-[#FFFFFF] p-4 shadow-2xl dark:border-[#3a3731] dark:bg-[#1c1a17]">
        <div className="mb-3 font-semibold dark:text-zinc-100">AI 请求解压 zip 文件</div>
        <p className="mb-3 text-sm text-[#6B6862] dark:text-zinc-400">
          选择一个本地 .zip，解压内容会写入文件袋。（request_id: {pending.requestId}）
        </p>
        <input ref={inputRef} type="file" accept=".zip,application/zip" className="hidden" onChange={handleFile} />
        {isStreaming ? (
          <p className="text-sm text-[#A8A29E] dark:text-zinc-500">Agent 仍在运行，请稍候…</p>
        ) : (
          <button
            onClick={() => inputRef.current?.click()}
            className="w-full rounded-lg bg-[#D97757] px-3 py-2 text-sm font-medium text-white hover:bg-[#C9633F]"
          >
            选择 zip 文件
          </button>
        )}
        <button
          onClick={() => setPendingZipRequest(null)}
          className="mt-2 w-full rounded-lg border px-3 py-2 text-sm text-[#6B6862] hover:bg-gray-50 dark:border-[#3a3731] dark:text-zinc-400 dark:hover:bg-[#2a2723]"
        >
          取消
        </button>
      </div>
    </div>
  );
}

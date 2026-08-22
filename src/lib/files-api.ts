/**
 * DeepSeek Files API client (https://api-docs.deepseek.com/zh-cn/guides/files_api).
 *
 * Uploads an image once and gets back a `file_id` that can be referenced in
 * chat content blocks: { type: "file", file_id } — so every later turn carries
 * just the ID (a few dozen bytes) instead of re-sending the base64 image.
 *
 * Only images (JPEG/PNG/GIF/WebP) are supported by the API; single file up to
 * 64 MiB. The file is stored in the caller's DeepSeek account (25 GiB quota)
 * and persists until deleted (we don't pass expires_after → permanent).
 *
 * CORS note: this is a direct browser fetch to api.deepseek.com. If the gateway
 * doesn't allow cross-origin POST /files, callers must fall back to inline
 * base64 (image_url content part) — that's handled by the upload path in
 * terminal.tsx.
 */

export interface UploadFileResult {
  ok: boolean;
  fileId?: string;
  error?: string;
}

/** A file object as returned by the DeepSeek Files API. */
export interface DeepSeekFileInfo {
  id: string;
  object: string;
  bytes: number;
  created_at: number;
  filename: string;
  purpose: string;
  expires_at?: number;
}

export interface ListFilesResult {
  ok: boolean;
  files?: DeepSeekFileInfo[];
  error?: string;
}

export interface DeleteFileResult {
  ok: boolean;
  deleted?: boolean;
  error?: string;
}

/** DeepSeek Files API lives at the API root, NOT under /v1 (OpenAI shim path). */
function filesBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/v\d+(?=\/|$)/i, "").replace(/\/+$/, "");
}

async function authFetch(
  url: string,
  apiKey: string,
  init: RequestInit = {},
): Promise<Response> {
  return fetch(url, {
    ...init,
    headers: { Authorization: `Bearer ${apiKey}`, ...(init.headers ?? {}) },
  });
}

/**
 * Upload a single file to the DeepSeek Files API.
 * @param baseUrl  Provider base URL (e.g. https://api.deepseek.com/v1) — the
 *                 /v1 suffix is stripped automatically.
 * @param file     The image File/Blob to upload.
 * @param apiKey   The DeepSeek API key (from apiKeyVault).
 */
export async function uploadFileToDeepSeek(
  baseUrl: string,
  file: Blob,
  apiKey: string,
): Promise<UploadFileResult> {
  if (!apiKey) {
    return { ok: false, error: "没有配置 API key，无法上传图片到 Files API。" };
  }
  const url = `${filesBaseUrl(baseUrl)}/files`;
  const form = new FormData();
  form.append("purpose", "user_data");
  form.append("file", file, file instanceof File ? file.name : "upload.bin");

  try {
    const resp = await authFetch(url, apiKey, {
      method: "POST",
      body: form, // browser sets multipart boundary automatically
    });
    const data = (await resp.json().catch(() => null)) as
      | { id?: string; error?: { message?: string } }
      | null;
    if (!resp.ok) {
      return {
        ok: false,
        error: data?.error?.message ?? `Files API 上传失败 (HTTP ${resp.status})`,
      };
    }
    if (!data?.id) {
      return { ok: false, error: "Files API 响应缺少 file_id。" };
    }
    return { ok: true, fileId: data.id };
  } catch (e) {
    return {
      ok: false,
      error: `Files API 网络错误: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
}

/**
 * List files uploaded to the DeepSeek Files API for this API key.
 * @param baseUrl  Provider base URL (the /v1 suffix is stripped automatically).
 * @param apiKey   The DeepSeek API key (from apiKeyVault).
 */
export async function listDeepSeekFiles(
  baseUrl: string,
  apiKey: string,
): Promise<ListFilesResult> {
  if (!apiKey) {
    return { ok: false, error: "没有配置 API key，无法列出 Files API 文件。" };
  }
  const url = `${filesBaseUrl(baseUrl)}/files?limit=1000`;
  try {
    const resp = await authFetch(url, apiKey, { method: "GET" });
    const data = (await resp.json().catch(() => null)) as
      | { data?: DeepSeekFileInfo[]; error?: { message?: string } }
      | null;
    if (!resp.ok) {
      return {
        ok: false,
        error: data?.error?.message ?? `Files API 列表失败 (HTTP ${resp.status})`,
      };
    }
    return { ok: true, files: data?.data ?? [] };
  } catch (e) {
    return {
      ok: false,
      error: `Files API 网络错误: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
}

/**
 * Delete a file from the DeepSeek Files API by its file_id.
 * @param baseUrl  Provider base URL (the /v1 suffix is stripped automatically).
 * @param apiKey   The DeepSeek API key (from apiKeyVault).
 * @param fileId   The file_id to delete (e.g. "file-api-xxxx").
 */
export async function deleteDeepSeekFile(
  baseUrl: string,
  apiKey: string,
  fileId: string,
): Promise<DeleteFileResult> {
  if (!apiKey) {
    return { ok: false, error: "没有配置 API key，无法删除 Files API 文件。" };
  }
  const url = `${filesBaseUrl(baseUrl)}/files/${encodeURIComponent(fileId)}`;
  try {
    const resp = await authFetch(url, apiKey, { method: "DELETE" });
    const data = (await resp.json().catch(() => null)) as
      | { deleted?: boolean; error?: { message?: string } }
      | null;
    if (!resp.ok) {
      return {
        ok: false,
        error: data?.error?.message ?? `Files API 删除失败 (HTTP ${resp.status})`,
      };
    }
    return { ok: true, deleted: data?.deleted ?? true };
  } catch (e) {
    return {
      ok: false,
      error: `Files API 网络错误: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
}

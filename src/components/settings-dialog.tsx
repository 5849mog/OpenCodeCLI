"use client";

/**
 * Settings dialog — configure the AI provider (OpenAI-compatible).
 * Settings persist to localStorage.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { X, Settings, Eye, EyeOff, Zap, Download, Upload, Lock, RefreshCw, Trash2, FileText, Loader2, ChevronDown, Check } from "lucide-react";
import { useSession } from "@/store/session";
import { fetchModels, fetchBalance, type BalanceResult } from "@/lib/ai-client";
import { apiKeyVault } from "@/lib/api-key-vault";
import { listDeepSeekFiles, deleteDeepSeekFile, type DeepSeekFileInfo } from "@/lib/files-api";
import {
  loadAllSessions,
  saveSession,
  wipeAllSessions,
  type PersistedSession,
} from "@/lib/session-storage";
import { toast } from "sonner";

const PRESETS: Array<{
  name: string;
  baseUrl: string;
  models: string[];
  hint: string;
  vision?: boolean;
}> = [
  {
    name: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    models: ["gpt-4o", "gpt-4o-mini", "gpt-4.1", "gpt-4.1-mini", "o3-mini"],
    hint: "Official OpenAI API",
  },
  {
    name: "DeepSeek",
    baseUrl: "https://api.deepseek.com/v1",
    models: ["deepseek-v4-flash", "deepseek-v4-pro", "deepseek-v4-flash-vision-exp"],
    hint: "deepseek-v4-flash / deepseek-v4-pro / vision-exp（视觉）",
    vision: true,
  },
  {
    name: "Zhipu (智谱)",
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    models: ["glm-4-plus", "glm-4-air", "glm-4-flash", "glm-4.6"],
    hint: "智谱 GLM 系列",
  },
  {
    name: "Moonshot (Kimi)",
    baseUrl: "https://api.moonshot.cn/v1",
    models: ["moonshot-v1-128k", "moonshot-v1-32k", "moonshot-v1-8k"],
    hint: "Kimi K1.5 / Moonshot",
  },
  {
    name: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
    models: [
      "anthropic/claude-3.5-sonnet",
      "openai/gpt-4o",
      "google/gemini-flash-1.5",
    ],
    hint: "Aggregator — supports Claude, Gemini, etc.",
  },
  {
    name: "Groq",
    baseUrl: "https://api.groq.com/openai/v1",
    models: ["llama-3.3-70b-versatile", "llama-3.1-8b-instant"],
    hint: "Ultra-fast Llama inference",
  },
];

export function SettingsDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const config = useSession((s) => s.config);
  const setConfig = useSession((s) => s.setConfig);
  const refreshSessionList = useSession((s) => s.refreshSessionList);
  const setAvailableModels = useSession((s) => s.setAvailableModels);
  const availableModels = useSession((s) => s.availableModels);
  const [showKey, setShowKey] = useState(false);
  const [testing, setTesting] = useState(false);
  const [importing, setImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // API key is held in a LOCAL state variable — NOT in the Zustand store.
  // On save, it goes to the apiKeyVault (private closure), not localStorage.
  const [keyInput, setKeyInput] = useState(() => apiKeyVault.getKey() ?? "");
  const [keyDirty, setKeyDirty] = useState(false);

  // ── Web & Search state ──
  const [showSearchKey, setShowSearchKey] = useState(false);
  const [searchKeyInput, setSearchKeyInput] = useState(() => apiKeyVault.getSearchKey() ?? "");
  const [searchKeyDirty, setSearchKeyDirty] = useState(false);

  // ── Models fetched live from the provider (merged into the datalist) ──
  const [fetchedModels, setFetchedModels] = useState<string[]>([]);
  // ── DeepSeek account balance ──
  const [balance, setBalance] = useState<BalanceResult | null>(null);
  const [balanceLoading, setBalanceLoading] = useState(false);
  const [balanceError, setBalanceError] = useState<string | null>(null);

  // ── DeepSeek Files API 管理 ──
  const [files, setFiles] = useState<DeepSeekFileInfo[] | null>(null);
  const [filesLoading, setFilesLoading] = useState(false);
  const [filesError, setFilesError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // ── 模型选择器：可见可点的模型列表（替代原生 datalist） ──
  const [showModelList, setShowModelList] = useState(false);
  const modelChoices = useMemo(
    () =>
      Array.from(
        new Set([
          ...(PRESETS.find((p) => p.baseUrl === config.baseUrl)?.models ?? []),
          ...fetchedModels,
          ...(config.model ? [config.model] : []),
        ]),
      ),
    [config.baseUrl, config.model, fetchedModels],
  );

  // The /user/balance endpoint is DeepSeek-specific — only surface the card
  // when the configured base URL points at deepseek.com.
  let isDeepSeek = false;
  try {
    isDeepSeek = new URL(config.baseUrl).hostname.includes("deepseek.com");
  } catch { /* malformed URL → not deepseek */ }

  const queryBalance = async () => {
    const key = apiKeyVault.getKey();
    if (!key) {
      setBalanceError("未配置 LLM API Key，无法查询余额");
      return;
    }
    setBalanceLoading(true);
    setBalanceError(null);
    try {
      const result = await fetchBalance({ baseUrl: config.baseUrl, apiKey: key });
      setBalance(result);
    } catch (e) {
      setBalanceError(e instanceof Error ? e.message : String(e));
      setBalance(null);
    } finally {
      setBalanceLoading(false);
    }
  };

  const loadFiles = async () => {
    const key = apiKeyVault.getKey();
    if (!key) {
      setFilesError("未配置 LLM API Key，无法读取 Files API 文件");
      setFiles(null);
      return;
    }
    setFilesLoading(true);
    setFilesError(null);
    try {
      const res = await listDeepSeekFiles(config.baseUrl, key);
      if (res.ok) {
        setFiles(res.files ?? []);
      } else {
        setFilesError(res.error ?? "读取文件列表失败");
        setFiles(null);
      }
    } finally {
      setFilesLoading(false);
    }
  };

  const deleteFile = async (fileId: string) => {
    const key = apiKeyVault.getKey();
    if (!key) return;
    setDeletingId(fileId);
    setFilesError(null);
    try {
      const res = await deleteDeepSeekFile(config.baseUrl, key, fileId);
      if (res.ok) {
        setFiles((prev) => (prev ? prev.filter((f) => f.id !== fileId) : prev));
        toast.success(`已删除 ${fileId}`);
      } else {
        setFilesError(res.error ?? "删除失败");
      }
    } finally {
      setDeletingId(null);
    }
  };

  const clearAllFiles = async () => {
    if (!files || files.length === 0) return;
    if (!confirm(`确定要删除全部 ${files.length} 个已上传文件吗？此操作不可撤销。`)) return;
    const key = apiKeyVault.getKey();
    if (!key) return;
    setFilesError(null);
    for (const f of [...files]) {
      await deleteDeepSeekFile(config.baseUrl, key, f.id);
    }
    setFiles([]);
    toast.success("已清空 Files API 文件");
  };

  // Auto-query balance + models when the dialog opens with a key configured.
  useEffect(() => {
    if (open && apiKeyVault.getKey()) {
      void loadModels(true);
      if (isDeepSeek) {
        void queryBalance();
        void loadFiles();
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, config.baseUrl]);

  if (!open) return null;

  const loadModels = async (silent = false): Promise<string[]> => {
    const key = apiKeyVault.getKey();
    if (!key || !config.baseUrl) return [];
    try {
      const models = await fetchModels({
        baseUrl: config.baseUrl,
        apiKey: key,
      });
      setFetchedModels(models);
      setAvailableModels(models);
      if (models.length > 0 && (!config.model || !models.includes(config.model))) {
        setConfig({ model: models[0] });
        if (!silent) toast.info(`Auto-set model to: ${models[0]}`);
      }
      return models;
    } catch (e) {
      if (!silent) toast.error(e instanceof Error ? e.message : String(e));
      return [];
    }
  };

  const testConnection = async () => {
    setTesting(true);
    try {
      // Save key to vault before testing
      if (keyDirty && keyInput) {
        await apiKeyVault.setKey(keyInput);
        setConfig({ hasApiKey: true });
        setKeyDirty(false);
      }
      const models = await loadModels();
      if (models.length > 0) {
        toast.success(`Connection OK — ${models.length} models available`);
      } else {
        toast.warning("Connection works, but no models returned");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setTesting(false);
    }
  };

  // ── Session export / import (全量) ──
  // Export NEVER includes API keys — they live in the encrypted localStorage
  // vault, not in session records; config is exported minus any credential.
  const handleExportAll = async () => {
    try {
      const sessions = await loadAllSessions();
      const safeConfig = {
        baseUrl: config.baseUrl,
        model: config.model,
        temperature: config.temperature,
        maxTokens: config.maxTokens,
        tokenBudget: config.tokenBudget,
        thinkingEnabled: config.thinkingEnabled,
        reasoningEffort: config.reasoningEffort,
        searchProvider: config.searchProvider,
        useJinaReader: config.useJinaReader,
        corsProxyUrl: config.corsProxyUrl,
        customInstructions: config.customInstructions,
      };
      const payload = {
        kind: "opencode-sessions-export",
        version: 1,
        exportedAt: new Date().toISOString(),
        sessions,
        config: safeConfig,
      };
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `opencode-all-sessions-${Date.now()}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success(`已导出 ${sessions.length} 个会话（不含任何 API 密钥）`);
    } catch (e) {
      toast.error(`导出失败：${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const handleImportFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = async () => {
      setImporting(true);
      try {
        const parsed = JSON.parse(String(reader.result));
        if (parsed.kind !== "opencode-sessions-export" || parsed.version !== 1) {
          toast.error("不是有效的 OpenCode 会话导出文件（kind/version 不符）");
          return;
        }
        const sessions: PersistedSession[] = Array.isArray(parsed.sessions) ? parsed.sessions : [];
        const confirmed = window.confirm(
          `导入将覆盖本地全部 ${sessions.length ? `${sessions.length} 个` : ""}历史会话（全量覆盖，不可撤销）。继续？`,
        );
        if (!confirmed) return;
        // 全量覆盖：清空旧会话，写入导入的会话。
        await wipeAllSessions();
        for (const rec of sessions) {
          await saveSession({
            id: rec.id,
            title: rec.title || "导入会话",
            messages: rec.messages ?? [],
            events: rec.events ?? [],
            totalTokens: rec.totalTokens ?? 0,
            lastUsage: rec.lastUsage ?? null,
            compactedReleases: rec.compactedReleases ?? 0,
            compactCount: rec.compactCount ?? 0,
            agentPreset: rec.agentPreset ?? "full",
            createdAt: rec.createdAt ?? Date.now(),
            updatedAt: rec.updatedAt ?? Date.now(),
          });
        }
        // 导入配置（不含凭据——只覆盖非敏感项，API key 不受影响）
        if (parsed.config && typeof parsed.config === "object") {
          const c = parsed.config as Record<string, unknown>;
          setConfig({
            baseUrl: typeof c.baseUrl === "string" ? c.baseUrl : config.baseUrl,
            model: typeof c.model === "string" ? c.model : config.model,
            temperature: typeof c.temperature === "number" ? c.temperature : config.temperature,
            maxTokens: typeof c.maxTokens === "number" ? c.maxTokens : config.maxTokens,
            tokenBudget: typeof c.tokenBudget === "number" ? c.tokenBudget : config.tokenBudget,
            thinkingEnabled: typeof c.thinkingEnabled === "boolean" ? c.thinkingEnabled : config.thinkingEnabled,
            reasoningEffort: typeof c.reasoningEffort === "string" ? c.reasoningEffort : config.reasoningEffort,
          });
        }
        // 让 store 的 refreshSessionList 重新读取 IndexedDB；活动会话指针保持。
        await refreshSessionList();
        toast.success(`已导入 ${sessions.length} 个会话并覆盖本地历史`);
      } catch (e) {
        toast.error(`导入失败：${e instanceof Error ? e.message : String(e)}`);
      } finally {
        setImporting(false);
      }
    };
    reader.onerror = () => toast.error("读取文件失败");
    reader.readAsText(file);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-lg border border-[#DEDEDE] bg-[#FFFFFF] text-[#262626] dark:text-zinc-200 shadow-2xl dark:border-[#333333] dark:bg-[#161616] dark:text-zinc-100">
        {/* Header */}
        <div className="flex items-center gap-2 border-b border-[#DEDEDE] px-5 py-4 dark:border-[#333333]">
          <Settings className="h-5 w-5 text-[#E58F67]" />
          <h2 className="text-lg font-semibold">Settings · AI Provider</h2>
          <button
            onClick={onClose}
            className="ml-auto rounded p-1.5 text-[#8C8C8C] dark:text-zinc-500 hover:bg-[#F0F0F0] hover:text-[#383838] dark:text-zinc-300 dark:hover:bg-[#2A2A2A] dark:hover:text-zinc-200"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-[#D4D4D4] dark:[&::-webkit-scrollbar-thumb]:bg-[#333333]">
          {/* Presets */}
          <div className="mb-5">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-[#8C8C8C] dark:text-zinc-500 dark:text-zinc-500">
              Quick presets
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {PRESETS.map((p) => (
                <button
                  key={p.name}
                  onClick={() =>
                    setConfig({
                      baseUrl: p.baseUrl,
                      model: p.models[0],
                      supportVision: p.vision ?? false,
                    })
                  }
                  className={`rounded border px-3 py-2 text-left text-xs transition ${
                    config.baseUrl === p.baseUrl
                      ? "border-[#E58F67] bg-emerald-950/30 dark:bg-emerald-950/40"
                      : "border-[#DEDEDE] bg-[#FFFFFF] hover:border-zinc-600 dark:border-[#333333] dark:bg-[#0A0A0A] dark:hover:border-zinc-500"
                  }`}
                >
                  <div className="font-semibold text-[#262626] dark:text-zinc-200 dark:text-zinc-200">{p.name}</div>
                  <div className="mt-0.5 text-[10px] text-[#8C8C8C] dark:text-zinc-500 dark:text-zinc-500">
                    {p.hint}
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Base URL */}
          <Field label="Base URL" hint="OpenAI-compatible endpoint (without /chat/completions)">
            <input
              value={config.baseUrl}
              onChange={(e) => setConfig({ baseUrl: e.target.value })}
              placeholder="https://api.openai.com/v1"
              className="w-full rounded border border-[#DEDEDE] bg-[#FAFAFA] dark:border-[#333333] dark:bg-[#0A0A0A] px-3 py-2 font-mono text-sm focus:border-[#E58F67] focus:outline-none dark:text-zinc-100"
            />
          </Field>

          {/* API Key */}
          <Field label="API Key" hint="Encrypted with AES-GCM and persisted locally (survives refresh / new tabs). Not stored in React state, not included in session exports.">
            <div className="flex gap-2">
              <input
                type={showKey ? "text" : "password"}
                value={keyInput}
                onChange={(e) => {
                  setKeyInput(e.target.value);
                  setKeyDirty(true);
                }}
                placeholder={config.hasApiKey && !keyDirty ? "•••••••• (key is set, type to change)" : "sk-…"}
                className="flex-1 rounded border border-[#DEDEDE] bg-[#FAFAFA] dark:border-[#333333] dark:bg-[#0A0A0A] px-3 py-2 font-mono text-sm focus:border-[#E58F67] focus:outline-none"
              />
              <button
                onClick={() => setShowKey(!showKey)}
                className="rounded border border-[#DEDEDE] px-3 text-[#6B6B6B] dark:text-zinc-400 hover:bg-[#F0F0F0] dark:border-[#333333] dark:hover:bg-[#2A2A2A]"
              >
                {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            {config.hasApiKey && !keyDirty && (
              <div className="mt-1 text-[11px] text-[#E58F67]">
                ✓ API key is set (encrypted & persisted locally)
              </div>
            )}
          </Field>

          {/* Model */}
          <Field label="Model" hint="点下方模型名直接选择；也可手动输入任意模型名">
            <div className="flex gap-2">
              <input
                value={config.model}
                onChange={(e) => {
                  const m = e.target.value;
                  // 视觉能力随模型推断：模型名含 vision / 已知视觉模型 → 开启；
                  // 否则保留当前设置（用户可在下方手动开关）。
                  const visionLike = /vision|gpt-4o|gemini|claude/i.test(m);
                  setConfig(
                    visionLike
                      ? { model: m, supportVision: true }
                      : { model: m },
                  );
                }}
                placeholder="gpt-4o"
                className="flex-1 rounded border border-[#DEDEDE] bg-[#FAFAFA] dark:border-[#333333] dark:bg-[#0A0A0A] px-3 py-2 font-mono text-sm focus:border-[#E58F67] focus:outline-none"
              />
              <button
                onClick={testConnection}
                disabled={testing || !keyInput}
                className="flex items-center gap-1.5 rounded border border-[#DEDEDE] px-3 text-sm text-[#383838] dark:text-zinc-300 hover:bg-[#F0F0F0] dark:border-[#333333] dark:hover:bg-[#2A2A2A] disabled:opacity-40"
                title="测试连接并拉取可用模型列表"
              >
                <Zap className="h-3.5 w-3.5" />
                {testing ? "Testing…" : "Test"}
              </button>
              <button
                onClick={() => {
                  setShowModelList((v) => !v);
                  if (fetchedModels.length === 0 && apiKeyVault.getKey()) void loadModels(true);
                }}
                disabled={testing}
                className="flex items-center gap-1.5 rounded border border-[#DEDEDE] px-2.5 text-sm text-[#383838] hover:bg-[#F0F0F0] dark:border-[#333333] dark:text-zinc-300 dark:hover:bg-[#2A2A2A] disabled:opacity-40"
                title="显示可选模型列表"
              >
                <ChevronDown className="h-3.5 w-3.5" />
                {showModelList ? "收起" : "模型列表"}
              </button>
            </div>
            {showModelList && (
              <div className="mt-2 max-h-48 overflow-y-auto rounded border border-[#DEDEDE] bg-[#FFFFFF] dark:border-[#333333] dark:bg-[#161616]">
                {modelChoices.length === 0 ? (
                  <div className="px-3 py-2 text-xs text-[#A6A6A6] dark:text-zinc-500">
                    {fetchedModels.length === 0 && !apiKeyVault.getKey()
                      ? "先填入 API key，点 Test 拉取模型列表。"
                      : "暂无模型——点 Test 尝试拉取。"}
                  </div>
                ) : (
                  modelChoices.map((m) => (
                    <button
                      key={m}
                      onClick={() => {
                        const visionLike = /vision|gpt-4o|gemini|claude/i.test(m);
                        setConfig(visionLike ? { model: m, supportVision: true } : { model: m });
                        setShowModelList(false);
                      }}
                      className={`flex w-full items-center gap-2 px-3 py-1.5 text-left font-mono text-xs transition-colors ${
                        m === config.model
                          ? "bg-[#E58F67]/10 text-[#E58F67]"
                          : "text-[#383838] hover:bg-[#F5F5F5] dark:text-zinc-300 dark:hover:bg-[#262626]"
                      }`}
                    >
                      <span className="min-w-0 flex-1 truncate">{m}</span>
                      {m === config.model && <Check className="h-3 w-3 shrink-0" />}
                    </button>
                  ))
                )}
              </div>
            )}
            {fetchedModels.length > 0 && (
              <div className="mt-1 text-[11px] text-[#A6A6A6] dark:text-zinc-500">
                {fetchedModels.length} 个可用模型已拉取
              </div>
            )}
          </Field>

          {/* Temperature + max tokens */}
          <div className="grid grid-cols-2 gap-3">
            <Field label="Temperature">
              <input
                type="number"
                step="0.1"
                min="0"
                max="2"
                value={config.temperature}
                onChange={(e) =>
                  setConfig({ temperature: parseFloat(e.target.value) || 0 })
                }
                className="w-full rounded border border-[#DEDEDE] bg-[#FAFAFA] dark:border-[#333333] dark:bg-[#0A0A0A] px-3 py-2 font-mono text-sm focus:border-[#E58F67] focus:outline-none"
              />
            </Field>
            <Field label="Max tokens">
              <input
                type="number"
                step="256"
                min="256"
                max="65536"
                value={config.maxTokens}
                onChange={(e) =>
                  setConfig({ maxTokens: parseInt(e.target.value, 10) || 1024 })
                }
                className="w-full rounded border border-[#DEDEDE] bg-[#FAFAFA] dark:border-[#333333] dark:bg-[#0A0A0A] px-3 py-2 font-mono text-sm focus:border-[#E58F67] focus:outline-none"
              />
            </Field>
          </div>

          {/* 上下文发送预算 */}
          <div className="mt-3">
            <Field
              label="上下文发送预算 (token)"
              hint="单次请求发给模型的上下文上限。超出自动截断旧历史 / 压缩工具结果。默认 60000；高上下文模型（如 DeepSeek 100 万）可调大，但会提高单次成本与延迟。必留输出余量，别贴满模型窗口。"
            >
              <input
                type="number"
                step="10000"
                min="4000"
                max="1000000"
                value={config.tokenBudget}
                onChange={(e) =>
                  setConfig({ tokenBudget: parseInt(e.target.value, 10) || 60_000 })
                }
                className="w-full rounded border border-[#DEDEDE] bg-[#FAFAFA] dark:border-[#333333] dark:bg-[#0A0A0A] px-3 py-2 font-mono text-sm focus:border-[#E58F67] focus:outline-none"
              />
            </Field>
          </div>

          {/* 自动压缩 */}
          <div className="mt-3">
            <label className="flex cursor-pointer select-none items-start gap-2">
              <input
                type="checkbox"
                checked={config.autoCompact}
                onChange={(e) => setConfig({ autoCompact: e.target.checked })}
                className="mt-0.5 h-4 w-4 accent-[#E58F67]"
              />
              <span>
                <span className="block text-sm text-[#262626] dark:text-zinc-100">自动压缩对话历史</span>
                <span className="block text-[10px] text-[#8C8C8C] dark:text-zinc-500">
                  真分词器估算超预算 85% 时自动用 LLM 摘要压缩（保留信息，需消耗一次摘要调用）；关闭则只丢弃旧消息。距上次压缩 ≥10 条新消息才再次触发。
                </span>
              </span>
            </label>
          </div>

          {/* DeepSeek V4: thinking + reasoning */}
          <div className="mb-4 rounded border border-[#DEDEDE] bg-[#FAFAFA] dark:border-[#333333] dark:bg-[#0A0A0A] px-4 py-3">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-[#6B6B6B] dark:text-zinc-400">
              DeepSeek V4 · Thinking / Reasoning
            </div>
            <div className="flex flex-wrap gap-4">
              {/* Thinking toggle */}
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={config.thinkingEnabled}
                  onChange={(e) => setConfig({ thinkingEnabled: e.target.checked })}
                  className="h-4 w-4 accent-[#E58F67]"
                />
                <span className="text-sm text-[#383838] dark:text-zinc-300">Thinking mode</span>
              </label>
              {/* Reasoning effort */}
              <label className="flex items-center gap-2">
                <span className="text-xs text-[#8C8C8C] dark:text-zinc-500">Effort:</span>
                <select
                  value={config.reasoningEffort}
                  onChange={(e) => setConfig({ reasoningEffort: e.target.value })}
                  className="rounded border border-[#DEDEDE] bg-white dark:bg-[#0A0A0A] dark:text-zinc-100 px-2 py-1 text-sm font-mono focus:border-[#E58F67] focus:outline-none"
                >
                  <option value="low">low</option>
                  <option value="high">high</option>
                  <option value="xhigh">xhigh</option>
                  <option value="max">max</option>
                </select>
              </label>
            </div>
            <div className="mt-1.5 text-[11px] text-[#A6A6A6] dark:text-zinc-500">
              For DeepSeek V4 models. On sends <code className="text-[#E58F67]">thinking=enabled</code> + <code className="text-[#E58F67]">reasoning_effort</code>; off sends <code className="text-[#E58F67]">thinking=disabled</code>. Valid efforts: low/high/xhigh/max. Note: thinking &amp; answer share the Max tokens budget.
            </div>
          </div>

          {/* Vision / Image input */}
          <div className="mb-4 rounded border border-[#DEDEDE] bg-[#FAFAFA] dark:border-[#333333] dark:bg-[#0A0A0A] px-4 py-3">
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={config.supportVision}
                onChange={(e) => setConfig({ supportVision: e.target.checked })}
                className="h-4 w-4 accent-[#E58F67]"
              />
              <span>
                <span className="block text-sm text-[#262626] dark:text-zinc-100">支持图片输入（Vision）</span>
                <span className="block text-[10px] text-[#8C8C8C] dark:text-zinc-500">
                  开启后随消息上传的图片会作为视觉输入传给模型（优先 DeepSeek Files API，失败自动转 base64 内联）。仅视觉模型支持（如 deepseek-v4-flash-vision-exp）；非视觉模型带图会报错。
                </span>
              </span>
            </label>
          </div>

          {/* 运行模式（新会话默认，会话创建时锁定） */}
          <div className="mb-4 rounded border border-[#DEDEDE] bg-[#FAFAFA] dark:border-[#333333] dark:bg-[#0A0A0A] px-4 py-3">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-[#6B6B6B] dark:text-zinc-400">
              运行模式 · 新会话默认
            </div>
            <div className="flex flex-col gap-2">
              {(
                [
                  {
                    id: "full",
                    name: "完整模式",
                    desc: "全部工具 + 完整提示词（含探索/成本/说教指南）。功能最全，固定开销 ~26K tokens。",
                  },
                  {
                    id: "light",
                    name: "精简模式",
                    desc: "核心开发工具集 + 精简提示词（保留安全边界与失败协议，去掉说教段）。固定开销 ~10K tokens。",
                  },
                  {
                    id: "minimal",
                    name: "极简模式",
                    desc: "仅 bash + read_file + edit_file + glob + 一句话 persona（对标 DeepSeek Harness 极简模式）。固定开销 ~2K tokens。",
                  },
                ] as const
              ).map((p) => (
                <label key={p.id} className="flex cursor-pointer items-start gap-2.5 rounded border border-[#DEDEDE] px-3 py-2 dark:border-[#333333]">
                  <input
                    type="radio"
                    name="agentPreset"
                    checked={config.defaultPreset === p.id}
                    onChange={() => setConfig({ defaultPreset: p.id })}
                    className="mt-0.5 h-3.5 w-3.5 accent-[#E58F67]"
                  />
                  <span>
                    <span className="block text-sm text-[#262626] dark:text-zinc-100">{p.name}</span>
                    <span className="block text-[10px] text-[#8C8C8C] dark:text-zinc-500">{p.desc}</span>
                  </span>
                </label>
              ))}
            </div>
            <div className="mt-1.5 text-[11px] text-[#A6A6A6] dark:text-zinc-600">
              该模式在新建会话时锁定，会话内不可切换（保证提示词前缀稳定，持续命中 API 前缀缓存）。切换需新建会话。
            </div>
          </div>

          {/* ── DeepSeek account balance (provider-specific /user/balance) ── */}
          {isDeepSeek && (
            <div className="mb-4 rounded border border-[#DEDEDE] bg-[#FAFAFA] dark:border-[#333333] dark:bg-[#0A0A0A] px-4 py-3">
              <div className="mb-2 flex items-center justify-between">
                <div className="text-xs font-semibold uppercase tracking-wider text-[#6B6B6B] dark:text-zinc-400">
                  DeepSeek · 账户余额
                </div>
                <button
                  onClick={() => void queryBalance()}
                  disabled={balanceLoading}
                  className="flex items-center gap-1.5 rounded border border-[#DEDEDE] px-2 py-1 text-[11px] text-[#383838] dark:text-zinc-300 hover:bg-[#F0F0F0] dark:border-[#333333] dark:hover:bg-[#2A2A2A] disabled:opacity-40"
                >
                  <RefreshCw className={`h-3 w-3 ${balanceLoading ? "animate-spin" : ""}`} />
                  {balanceLoading ? "查询中…" : "刷新"}
                </button>
              </div>
              {balanceError ? (
                <div className="text-xs text-[#E54D2E]">{balanceError}</div>
              ) : balance && balance.balance_infos.length > 0 ? (
                <div className="space-y-1.5">
                  <div className="flex items-center gap-2 text-xs">
                    <span className="text-[#8C8C8C] dark:text-zinc-500">账户可用</span>
                    <span className={balance.is_available ? "text-emerald-600 dark:text-emerald-400" : "text-[#E54D2E]"}>
                      {balance.is_available ? "✓ 可用" : "✗ 不可用"}
                    </span>
                  </div>
                  {balance.balance_infos.map((b) => (
                    <div key={b.currency} className="flex items-baseline justify-between gap-3 text-sm">
                      <span className="font-mono text-[#8C8C8C] dark:text-zinc-500">
                        {b.currency} 总额
                      </span>
                      <span className="font-mono text-[#262626] dark:text-zinc-100">
                        {b.total_balance}
                        <span className="ml-1.5 text-[10px] text-[#A6A6A6] dark:text-zinc-600">
                          赠送 {b.granted_balance} · 充值 {b.topped_up_balance}
                        </span>
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-xs text-[#A6A6A6] dark:text-zinc-500">正在查询…</div>
              )}
            </div>
          )}

          {/* ── DeepSeek Files API 管理（图片上传占用的云端文件） ── */}
          {isDeepSeek && (
            <div className="mb-4 rounded border border-[#DEDEDE] bg-[#FAFAFA] dark:border-[#333333] dark:bg-[#0A0A0A] px-4 py-3">
              <div className="mb-2 flex items-center justify-between">
                <div className="text-xs font-semibold uppercase tracking-wider text-[#6B6B6B] dark:text-zinc-400">
                  DeepSeek · Files API 文件
                </div>
                <div className="flex items-center gap-1.5">
                  {files && files.length > 0 && (
                    <button
                      onClick={() => void clearAllFiles()}
                      disabled={filesLoading}
                      className="flex items-center gap-1.5 rounded border border-[#DEDEDE] px-2 py-1 text-[11px] text-[#E54D2E] hover:bg-[#E54D2E]/10 disabled:opacity-40 dark:border-[#333333]"
                    >
                      <Trash2 className="h-3 w-3" />
                      清空
                    </button>
                  )}
                  <button
                    onClick={() => void loadFiles()}
                    disabled={filesLoading}
                    className="flex items-center gap-1.5 rounded border border-[#DEDEDE] px-2 py-1 text-[11px] text-[#383838] hover:bg-[#F0F0F0] dark:border-[#333333] dark:text-zinc-300 dark:hover:bg-[#2A2A2A] disabled:opacity-40"
                  >
                    <RefreshCw className={`h-3 w-3 ${filesLoading ? "animate-spin" : ""}`} />
                    {filesLoading ? "读取中…" : "刷新"}
                  </button>
                </div>
              </div>
              {filesError ? (
                <div className="text-xs text-[#E54D2E]">{filesError}</div>
              ) : files === null ? (
                <div className="text-xs text-[#A6A6A6] dark:text-zinc-500">正在读取…</div>
              ) : files.length === 0 ? (
                <div className="text-xs text-[#A6A6A6] dark:text-zinc-500">暂无已上传文件</div>
              ) : (
                <div className="max-h-48 space-y-1 overflow-y-auto">
                  {files.map((f) => (
                    <div key={f.id} className="flex items-center gap-2 text-xs">
                      <FileText className="h-3 w-3 shrink-0 text-[#C08A5F] dark:text-[#E8A87C]" />
                      <span className="min-w-0 flex-1 truncate font-mono" title={`${f.id} · ${f.filename}`}>
                        {f.filename}
                      </span>
                      <span className="shrink-0 text-[#A6A6A6] dark:text-zinc-500">
                        {(f.bytes / 1024).toFixed(1)} KB
                      </span>
                      <span className="shrink-0 text-[10px] text-[#A6A6A6] dark:text-zinc-600">
                        {new Date(f.created_at * 1000).toLocaleDateString()}
                      </span>
                      <button
                        onClick={() => void deleteFile(f.id)}
                        disabled={deletingId === f.id}
                        className="shrink-0 rounded p-1 text-[#A6A6A6] hover:bg-[#E54D2E]/10 hover:text-[#E54D2E] disabled:opacity-40"
                        title={`删除 ${f.filename}（${f.id}）`}
                      >
                        {deletingId === f.id ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <Trash2 className="h-3 w-3" />
                        )}
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <div className="mt-2 text-[10px] text-[#A6A6A6] dark:text-zinc-600">
                上传的图片文件永久保存在你的 DeepSeek 账户（25 GiB 配额）。删除可释放空间。
              </div>
            </div>
          )}

          {/* ── Web & Search ── */}
          <div className="mb-4 border-t border-[#DEDEDE] pt-5 dark:border-[#333333]">
            <div className="flex items-center gap-1.5 mb-3">
              <span className="text-xs font-semibold uppercase tracking-wider text-[#6B6B6B] dark:text-zinc-400">
                Web &amp; Search
              </span>
            </div>

            {/* Search provider selector */}
            <Field label="Search provider" hint="Tavily returns full page content; Brave returns snippets. Both have free tiers.">
              <div className="flex gap-2">
                {(["tavily", "brave"] as const).map((p) => (
                  <button
                    key={p}
                    onClick={() => setConfig({ searchProvider: p })}
                    className={`flex-1 rounded border px-3 py-2 text-xs transition ${
                      config.searchProvider === p
                        ? "border-[#E58F67] bg-emerald-950/30 dark:bg-emerald-950/40"
                        : "border-[#DEDEDE] bg-[#FFFFFF] hover:border-zinc-600 dark:border-[#333333] dark:bg-[#0A0A0A] dark:hover:border-zinc-500"
                    }`}
                  >
                    <div className="font-semibold text-[#262626] dark:text-zinc-200">
                      {p === "tavily" ? "Tavily" : "Brave Search"}
                    </div>
                    <div className="mt-0.5 text-[10px] text-[#8C8C8C] dark:text-zinc-500">
                      {p === "tavily" ? "Recommended · 1k/mo free" : "2k/mo free"}
                    </div>
                  </button>
                ))}
              </div>
            </Field>

            {/* Search API Key */}
            <Field label="Search API Key" hint={`Your ${config.searchProvider === "brave" ? "Brave" : "Tavily"} API key — encrypted the same way as your LLM key.`}>
              <div className="flex gap-2">
                <input
                  type={showSearchKey ? "text" : "password"}
                  value={searchKeyInput}
                  onChange={(e) => {
                    setSearchKeyInput(e.target.value);
                    setSearchKeyDirty(true);
                  }}
                  placeholder={
                    config.hasSearchKey && !searchKeyDirty
                      ? "•••••••• (key is set, type to change)"
                      : `Enter your ${config.searchProvider} API key…`
                  }
                  className="flex-1 rounded border border-[#DEDEDE] bg-[#FAFAFA] dark:border-[#333333] dark:bg-[#0A0A0A] px-3 py-2 font-mono text-sm focus:border-[#E58F67] focus:outline-none"
                />
                <button
                  onClick={() => setShowSearchKey(!showSearchKey)}
                  className="rounded border border-[#DEDEDE] px-3 text-[#6B6B6B] dark:text-zinc-400 hover:bg-[#F0F0F0] dark:border-[#333333] dark:hover:bg-[#2A2A2A]"
                >
                  {showSearchKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              {apiKeyVault.hasSearchKey() && !searchKeyDirty ? (
                <div className="mt-1 text-[11px] text-[#E58F67]">
                  ✓ 已配置自定义 Key（加密持久化存储）
                </div>
              ) : !apiKeyVault.hasSearchKey() && !searchKeyDirty && !searchKeyInput ? (
                <div className="mt-1 text-[11px] text-[#8C8C8C] dark:text-zinc-500">
                  未配置搜索 API Key — web_search 暂不可用。填入上方的 Tavily 或 Brave Key 后即可开启（两者都有免费额度）。
                </div>
              ) : null}
            </Field>

            {/* URL Fetch options */}
            <div className="mb-4 rounded border border-[#DEDEDE] bg-[#FAFAFA] dark:border-[#333333] dark:bg-[#0A0A0A] px-4 py-3">
              <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-[#6B6B6B] dark:text-zinc-400">
                URL Fetch options
              </div>

              {/* Jina AI Reader toggle */}
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={config.useJinaReader}
                  onChange={(e) => setConfig({ useJinaReader: e.target.checked })}
                  className="h-4 w-4 accent-[#E58F67]"
                />
                <span className="text-sm text-[#383838] dark:text-zinc-300">
                  Use Jina AI Reader <span className="text-[#A6A6A6] dark:text-zinc-500">(r.jina.ai)</span>
                </span>
              </label>
              <div className="mt-1 text-[11px] text-[#A6A6A6] dark:text-zinc-500">
                Free CORS proxy that converts web pages to LLM-friendly markdown. No API key needed.
                Disable if you want to use a custom CORS proxy instead.
              </div>

              {/* Custom CORS proxy */}
              <div className="mt-3">
                <label className="mb-1.5 block text-xs text-[#8C8C8C] dark:text-zinc-500">
                  Custom CORS proxy URL <span className="text-[#A6A6A6] dark:text-zinc-500">(optional)</span>
                </label>
                <input
                  value={config.corsProxyUrl}
                  onChange={(e) => setConfig({ corsProxyUrl: e.target.value })}
                  placeholder="http://localhost:81/cors-proxy/"
                  className="w-full rounded border border-[#DEDEDE] bg-white dark:bg-[#0A0A0A] dark:text-zinc-100 px-3 py-2 font-mono text-sm focus:border-[#E58F67] focus:outline-none"
                />
                <div className="mt-0.5 text-[11px] text-[#A6A6A6] dark:text-zinc-500">
                  Only needed if Jina Reader is disabled and the target site blocks CORS.
                </div>
              </div>
            </div>
          </div>

          {/* ── Security ── */}
          <div className="mb-4 border-t border-[#DEDEDE] pt-5 dark:border-[#333333]">
            <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-[#6B6B6B] dark:text-zinc-400">
              <Lock className="h-3.5 w-3.5" />
              Security · 密钥安全
            </div>

            {/* Auto-restore note — key persists locally, normally no re-entry needed */}
            {apiKeyVault.llmNeedsReentry() && (
              <div className="mb-3 rounded border border-amber-300/60 bg-amber-50 px-3 py-2 text-[11px] text-amber-800 dark:border-amber-500/30 dark:bg-amber-950/30 dark:text-amber-300">
                检测到 LLM API Key 的加密数据，但未能自动解密（主密钥可能已损坏）——请在上方重新输入 Key。
              </div>
            )}
            {apiKeyVault.searchNeedsReentry() && (
              <div className="mb-3 rounded border border-amber-300/60 bg-amber-50 px-3 py-2 text-[11px] text-amber-800 dark:border-amber-500/30 dark:bg-amber-950/30 dark:text-amber-300">
                检测到 Search API Key 的加密数据，但未能自动解密——请在上方重新输入。
              </div>
            )}

            <div className="rounded border border-[#DEDEDE] bg-[#FAFAFA] px-4 py-3 dark:border-[#333333] dark:bg-[#0A0A0A]">
              <div className="mb-1.5 text-[11px] text-[#8C8C8C] dark:text-zinc-500">
                密钥用 AES-GCM 加密后持久化在本地浏览器存储，刷新 / 关闭重开可自动恢复、无需重填。离开设备前可一键清除密钥。
              </div>
              <button
                onClick={() => {
                  apiKeyVault.lockAll();
                  setConfig({ hasApiKey: false, hasSearchKey: false });
                  setKeyInput("");
                  setSearchKeyInput("");
                  setKeyDirty(false);
                  setSearchKeyDirty(false);
                  toast.success("已清除全部 API 密钥（内存 + 本地加密存储）");
                }}
                className="rounded border border-[#E54D2E]/40 px-3 py-1.5 text-xs font-medium text-[#E54D2E] hover:bg-[#E54D2E]/10"
              >
                立即锁定并清除密钥
              </button>
            </div>

            <div className="mt-3 rounded border border-[#DEDEDE] bg-[#FAFAFA] px-4 py-3 dark:border-[#333333] dark:bg-[#0A0A0A]">
              <label className="mb-1 flex items-center gap-2 text-sm text-[#383838] dark:text-zinc-300">
                <input
                  type="checkbox"
                  checked={(config.idleLockMinutes ?? 0) > 0}
                  onChange={(e) => setConfig({ idleLockMinutes: e.target.checked ? 30 : 0 })}
                  className="h-4 w-4 accent-[#E58F67]"
                />
                空闲自动锁定
              </label>
              {(config.idleLockMinutes ?? 0) > 0 && (
                <div className="mt-2 flex items-center gap-2">
                  <span className="text-xs text-[#8C8C8C] dark:text-zinc-500">闲置</span>
                  <input
                    type="number"
                    min={1}
                    max={480}
                    value={config.idleLockMinutes}
                    onChange={(e) =>
                      setConfig({ idleLockMinutes: Math.max(1, parseInt(e.target.value, 10) || 1) })
                    }
                    className="w-20 rounded border border-[#DEDEDE] bg-white dark:bg-[#0A0A0A] dark:text-zinc-100 px-2 py-1 text-sm font-mono focus:border-[#E58F67] focus:outline-none"
                  />
                  <span className="text-xs text-[#8C8C8C] dark:text-zinc-500">分钟后自动清除密钥</span>
                </div>
              )}
            </div>
          </div>

          {/* Custom instructions */}
          <Field label="Custom instructions" hint="Extra instructions appended to the system prompt (optional)">
            <textarea
              value={config.customInstructions}
              onChange={(e) => setConfig({ customInstructions: e.target.value })}
              rows={3}
              placeholder="e.g. Always use TypeScript. Prefer functional components. Use Tailwind for styling."
              className="w-full resize-none rounded border border-[#DEDEDE] bg-[#FAFAFA] dark:border-[#333333] dark:bg-[#0A0A0A] px-3 py-2 text-sm focus:border-[#E58F67] focus:outline-none"
            />
          </Field>

          {/* ── 会话导出 / 导入（全量） ── */}
          <div className="mb-4 border-t border-[#DEDEDE] pt-5 dark:border-[#333333]">
            <div className="mb-1 text-xs font-semibold uppercase tracking-wider text-[#6B6B6B] dark:text-zinc-400">
              会话 · Session backup
            </div>
            <div className="mb-2 text-[11px] text-[#A6A6A6] dark:text-zinc-500">
              导出全部历史会话为 JSON 文件（可在换浏览器 / 清缓存后导入恢复）。
              导出文件<b>绝不包含 API 密钥</b>（密钥只存在会话内的加密存储中）。
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={handleExportAll}
                className="flex items-center gap-1.5 rounded border border-[#DEDEDE] px-3 py-2 text-xs text-[#383838] hover:bg-[#F0F0F0] dark:border-[#333333] dark:text-zinc-300 dark:hover:bg-[#2A2A2A]"
              >
                <Download className="h-3.5 w-3.5" /> 导出全部会话
              </button>
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={importing}
                className="flex items-center gap-1.5 rounded border border-[#DEDEDE] px-3 py-2 text-xs text-[#383838] hover:bg-[#F0F0F0] disabled:opacity-50 dark:border-[#333333] dark:text-zinc-300 dark:hover:bg-[#2A2A2A]"
              >
                <Upload className="h-3.5 w-3.5" /> {importing ? "导入中…" : "导入并覆盖全部"}
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="application/json,.json"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleImportFile(f);
                  e.target.value = "";
                }}
              />
            </div>
          </div>

          {/* Privacy note */}
          <div className="mt-4 rounded border border-[#DEDEDE] bg-[#FAFAFA] dark:border-[#333333] dark:bg-[#0A0A0A] px-3 py-2 text-[11px] text-[#8C8C8C] dark:text-zinc-500">
            <span className="font-semibold text-[#6B6B6B] dark:text-zinc-400">Security:</span> Your
            API key is encrypted with AES-GCM (Web Crypto API) under a master key derived via
            PBKDF2; both the ciphertext and the master key live in localStorage so keys survive
            refresh / new tabs without re-entry. The plaintext key is never in React state, never
            in the Zustand store, and never in session exports. All API requests go directly from
            your browser to the provider. The 文件袋 is stored locally in IndexedDB.
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-[#DEDEDE] px-5 py-3">
          <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-[#8C8C8C] dark:text-zinc-500">
            {config.hasApiKey ? (
              <span className="text-[#E58F67]">● Key configured</span>
            ) : (
              <span className="text-[#B87B5A]">● No API key</span>
            )}
            {config.hasSearchKey ? (
              <span className="text-[#E58F67]">● Search configured</span>
            ) : (
              <span className="text-[#8C8C8C] dark:text-zinc-500">● No search key</span>
            )}
          </div>
          <button
            onClick={async () => {
              // Save LLM key to vault before closing
              if (keyDirty) {
                if (keyInput) {
                  await apiKeyVault.setKey(keyInput);
                  setConfig({ hasApiKey: true });
                } else {
                  apiKeyVault.clear();
                  setConfig({ hasApiKey: false });
                }
              }
              // Save search key to vault before closing
              if (searchKeyDirty) {
                if (searchKeyInput) {
                  await apiKeyVault.setSearchKey(searchKeyInput);
                  setConfig({ hasSearchKey: true });
                } else {
                  apiKeyVault.clearSearchKey();
                  setConfig({ hasSearchKey: false });
                }
              }
              onClose();
            }}
            className="rounded bg-[#E58F67] px-4 py-2 text-sm font-medium text-white hover:bg-[#C66B4A]"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-4">
      <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-[#6B6B6B] dark:text-zinc-400">
        {label}
      </label>
      {children}
      {hint && <div className="mt-1 text-[11px] text-[#A6A6A6] dark:text-zinc-500">{hint}</div>}
    </div>
  );
}

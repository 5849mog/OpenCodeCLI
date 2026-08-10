"use client";

/**
 * Settings dialog — configure the AI provider (OpenAI-compatible).
 * Settings persist to localStorage.
 */

import { useState } from "react";
import { X, Settings, Eye, EyeOff, Zap } from "lucide-react";
import { useSession } from "@/store/session";
import { fetchModels } from "@/lib/ai-client";
import { apiKeyVault } from "@/lib/api-key-vault";
import { toast } from "sonner";

const PRESETS: Array<{
  name: string;
  baseUrl: string;
  models: string[];
  hint: string;
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
    models: ["deepseek-v4-flash", "deepseek-v4-pro"],
    hint: "deepseek-v4-flash / deepseek-v4-pro",
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
  const [showKey, setShowKey] = useState(false);
  const [testing, setTesting] = useState(false);
  // API key is held in a LOCAL state variable — NOT in the Zustand store.
  // On save, it goes to the apiKeyVault (private closure), not localStorage.
  const [keyInput, setKeyInput] = useState(() => apiKeyVault.getKey() ?? "");
  const [keyDirty, setKeyDirty] = useState(false);

  // ── Web & Search state ──
  const [showSearchKey, setShowSearchKey] = useState(false);
  const [searchKeyInput, setSearchKeyInput] = useState(() => apiKeyVault.getSearchKey() ?? "");
  const [searchKeyDirty, setSearchKeyDirty] = useState(false);

  if (!open) return null;

  const testConnection = async () => {
    setTesting(true);
    try {
      // Save key to vault before testing
      if (keyDirty && keyInput) {
        await apiKeyVault.setKey(keyInput);
        setConfig({ hasApiKey: true });
        setKeyDirty(false);
      }
      const models = await fetchModels({
        baseUrl: config.baseUrl,
        apiKey: apiKeyVault.getKey() ?? "",
      });
      if (models.length > 0) {
        toast.success(`Connection OK — ${models.length} models available`);
        // Suggest the first model if the current model is empty or invalid
        if (!config.model || !models.includes(config.model)) {
          setConfig({ model: models[0] });
          toast.info(`Auto-set model to: ${models[0]}`);
        }
      } else {
        toast.warning("Connection works, but no models returned");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-lg border border-[#E5E2D9] bg-[#FFFFFF] text-[#2D2B27] shadow-2xl">
        {/* Header */}
        <div className="flex items-center gap-2 border-b border-[#E5E2D9] px-5 py-4">
          <Settings className="h-5 w-5 text-[#D97757]" />
          <h2 className="text-lg font-semibold">Settings · AI Provider</h2>
          <button
            onClick={onClose}
            className="ml-auto rounded p-1.5 text-[#8B8884] hover:bg-[#F0EDE5] hover:text-[#3D3B37]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-[#D6D3CE]">
          {/* Presets */}
          <div className="mb-5">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-[#8B8884]">
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
                    })
                  }
                  className={`rounded border px-3 py-2 text-left text-xs transition ${
                    config.baseUrl === p.baseUrl
                      ? "border-[#D97757] bg-emerald-950/30"
                      : "border-[#E5E2D9] bg-[#FFFFFF] hover:border-zinc-600"
                  }`}
                >
                  <div className="font-semibold text-[#2D2B27]">{p.name}</div>
                  <div className="mt-0.5 text-[10px] text-[#8B8884]">
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
              className="w-full rounded border border-[#E5E2D9] bg-[#FAF9F7] px-3 py-2 font-mono text-sm focus:border-[#D97757] focus:outline-none"
            />
          </Field>

          {/* API Key */}
          <Field label="API Key" hint="Encrypted in memory + sessionStorage (AES-GCM). NOT in localStorage. NOT in React state. Cleared when browser closes.">
            <div className="flex gap-2">
              <input
                type={showKey ? "text" : "password"}
                value={keyInput}
                onChange={(e) => {
                  setKeyInput(e.target.value);
                  setKeyDirty(true);
                }}
                placeholder={config.hasApiKey && !keyDirty ? "•••••••• (key is set, type to change)" : "sk-…"}
                className="flex-1 rounded border border-[#E5E2D9] bg-[#FAF9F7] px-3 py-2 font-mono text-sm focus:border-[#D97757] focus:outline-none"
              />
              <button
                onClick={() => setShowKey(!showKey)}
                className="rounded border border-[#E5E2D9] px-3 text-[#6B6862] hover:bg-[#F0EDE5]"
              >
                {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            {config.hasApiKey && !keyDirty && (
              <div className="mt-1 text-[11px] text-[#D97757]">
                ✓ API key is set (encrypted in sessionStorage)
              </div>
            )}
          </Field>

          {/* Model */}
          <Field label="Model" hint="Must be a model name your provider supports">
            <div className="flex gap-2">
              <input
                value={config.model}
                onChange={(e) => setConfig({ model: e.target.value })}
                placeholder="gpt-4o"
                list="model-suggestions"
                className="flex-1 rounded border border-[#E5E2D9] bg-[#FAF9F7] px-3 py-2 font-mono text-sm focus:border-[#D97757] focus:outline-none"
              />
              <datalist id="model-suggestions">
                {PRESETS.find((p) => p.baseUrl === config.baseUrl)?.models.map(
                  (m) => <option key={m} value={m} />,
                )}
              </datalist>
              <button
                onClick={testConnection}
                disabled={testing || !keyInput}
                className="flex items-center gap-1.5 rounded border border-[#E5E2D9] px-3 text-sm text-[#3D3B37] hover:bg-[#F0EDE5] disabled:opacity-40"
              >
                <Zap className="h-3.5 w-3.5" />
                {testing ? "Testing…" : "Test"}
              </button>
            </div>
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
                className="w-full rounded border border-[#E5E2D9] bg-[#FAF9F7] px-3 py-2 font-mono text-sm focus:border-[#D97757] focus:outline-none"
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
                className="w-full rounded border border-[#E5E2D9] bg-[#FAF9F7] px-3 py-2 font-mono text-sm focus:border-[#D97757] focus:outline-none"
              />
            </Field>
          </div>

          {/* DeepSeek V4: thinking + reasoning */}
          <div className="mb-4 rounded border border-[#E5E2D9] bg-[#FAF9F7] px-4 py-3">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-[#6B6862]">
              DeepSeek V4 · Thinking / Reasoning
            </div>
            <div className="flex flex-wrap gap-4">
              {/* Thinking toggle */}
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={config.thinkingEnabled}
                  onChange={(e) => setConfig({ thinkingEnabled: e.target.checked })}
                  className="h-4 w-4 accent-[#D97757]"
                />
                <span className="text-sm text-[#3D3B37]">Thinking mode</span>
              </label>
              {/* Reasoning effort */}
              <label className="flex items-center gap-2">
                <span className="text-xs text-[#8B8884]">Effort:</span>
                <select
                  value={config.reasoningEffort}
                  onChange={(e) => setConfig({ reasoningEffort: e.target.value })}
                  className="rounded border border-[#E5E2D9] bg-white px-2 py-1 text-sm font-mono focus:border-[#D97757] focus:outline-none"
                >
                  <option value="low">low</option>
                  <option value="high">high</option>
                  <option value="xhigh">xhigh</option>
                  <option value="max">max</option>
                </select>
              </label>
            </div>
            <div className="mt-1.5 text-[11px] text-[#A8A29E]">
              For DeepSeek V4 models. On sends <code className="text-[#D97757]">thinking=enabled</code> + <code className="text-[#D97757]">reasoning_effort</code>; off sends <code className="text-[#D97757]">thinking=disabled</code>. Valid efforts: low/high/xhigh/max. Note: thinking &amp; answer share the Max tokens budget.
            </div>
          </div>

          {/* ── Web & Search ── */}
          <div className="mb-4 border-t border-[#E5E2D9] pt-5">
            <div className="flex items-center gap-1.5 mb-3">
              <span className="text-xs font-semibold uppercase tracking-wider text-[#6B6862]">
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
                        ? "border-[#D97757] bg-emerald-950/30"
                        : "border-[#E5E2D9] bg-[#FFFFFF] hover:border-zinc-600"
                    }`}
                  >
                    <div className="font-semibold text-[#2D2B27]">
                      {p === "tavily" ? "Tavily" : "Brave Search"}
                    </div>
                    <div className="mt-0.5 text-[10px] text-[#8B8884]">
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
                  className="flex-1 rounded border border-[#E5E2D9] bg-[#FAF9F7] px-3 py-2 font-mono text-sm focus:border-[#D97757] focus:outline-none"
                />
                <button
                  onClick={() => setShowSearchKey(!showSearchKey)}
                  className="rounded border border-[#E5E2D9] px-3 text-[#6B6862] hover:bg-[#F0EDE5]"
                >
                  {showSearchKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              {apiKeyVault.hasSearchKey() && !searchKeyDirty ? (
                <div className="mt-1 text-[11px] text-[#D97757]">
                  ✓ 已配置自定义 Key（加密存储在 sessionStorage）
                </div>
              ) : !apiKeyVault.hasSearchKey() && !searchKeyDirty && !searchKeyInput ? (
                <div className="mt-1 text-[11px] text-[#8B8884]">
                  未配置搜索 API Key — web_search 暂不可用。填入上方的 Tavily 或 Brave Key 后即可开启（两者都有免费额度）。
                </div>
              ) : null}
            </Field>

            {/* URL Fetch options */}
            <div className="mb-4 rounded border border-[#E5E2D9] bg-[#FAF9F7] px-4 py-3">
              <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-[#6B6862]">
                URL Fetch options
              </div>

              {/* Jina AI Reader toggle */}
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={config.useJinaReader}
                  onChange={(e) => setConfig({ useJinaReader: e.target.checked })}
                  className="h-4 w-4 accent-[#D97757]"
                />
                <span className="text-sm text-[#3D3B37]">
                  Use Jina AI Reader <span className="text-[#A8A29E]">(r.jina.ai)</span>
                </span>
              </label>
              <div className="mt-1 text-[11px] text-[#A8A29E]">
                Free CORS proxy that converts web pages to LLM-friendly markdown. No API key needed.
                Disable if you want to use a custom CORS proxy instead.
              </div>

              {/* Custom CORS proxy */}
              <div className="mt-3">
                <label className="mb-1.5 block text-xs text-[#8B8884]">
                  Custom CORS proxy URL <span className="text-[#A8A29E]">(optional)</span>
                </label>
                <input
                  value={config.corsProxyUrl}
                  onChange={(e) => setConfig({ corsProxyUrl: e.target.value })}
                  placeholder="http://localhost:81/cors-proxy/"
                  className="w-full rounded border border-[#E5E2D9] bg-white px-3 py-2 font-mono text-sm focus:border-[#D97757] focus:outline-none"
                />
                <div className="mt-0.5 text-[11px] text-[#A8A29E]">
                  Only needed if Jina Reader is disabled and the target site blocks CORS.
                </div>
              </div>
            </div>
          </div>

          {/* Custom instructions */}
          <Field label="Custom instructions" hint="Extra instructions appended to the system prompt (optional)">
            <textarea
              value={config.customInstructions}
              onChange={(e) => setConfig({ customInstructions: e.target.value })}
              rows={3}
              placeholder="e.g. Always use TypeScript. Prefer functional components. Use Tailwind for styling."
              className="w-full resize-none rounded border border-[#E5E2D9] bg-[#FAF9F7] px-3 py-2 text-sm focus:border-[#D97757] focus:outline-none"
            />
          </Field>

          {/* Privacy note */}
          <div className="mt-4 rounded border border-[#E5E2D9] bg-[#FAF9F7] px-3 py-2 text-[11px] text-[#8B8884]">
            <span className="font-semibold text-[#6B6862]">Security:</span> Your
            API key is encrypted with AES-GCM (Web Crypto API) and stored in
            sessionStorage — it is NEVER in localStorage, NEVER in React state,
            and NEVER in the Zustand store. The encrypted blob is cleared when
            the browser tab closes. All API requests go directly from your
            browser to the provider. The 文件袋 is stored locally in IndexedDB.
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-[#E5E2D9] px-5 py-3">
          <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-[#8B8884]">
            {config.hasApiKey ? (
              <span className="text-[#D97757]">● Key configured</span>
            ) : (
              <span className="text-[#B87B5A]">● No API key</span>
            )}
            {config.hasSearchKey ? (
              <span className="text-[#D97757]">● Search configured</span>
            ) : (
              <span className="text-[#8B8884]">● No search key</span>
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
            className="rounded bg-[#D97757] px-4 py-2 text-sm font-medium text-white hover:bg-[#C66B4A]"
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
      <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-[#6B6862]">
        {label}
      </label>
      {children}
      {hint && <div className="mt-1 text-[11px] text-[#A8A29E]">{hint}</div>}
    </div>
  );
}

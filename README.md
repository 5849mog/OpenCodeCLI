<div align="center">

# Open Code Web 🧠✨

**把你的 iPad 变成 AI 编程工作站 — 纯浏览器，无需服务器**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Next.js](https://img.shields.io/badge/Next.js-16-black?logo=next.js)](https://nextjs.org)
[![React](https://img.shields.io/badge/React-19-61DAFB?logo=react)](https://react.dev)
[![Deploy](https://img.shields.io/badge/Deploy-GitHub_Pages-8A2BE2)]()

---

</div>

## 🌟 它在解决什么问题？

> 你躺在沙发上，手里只有一台 iPad。突然想到一个代码思路想试试——SSH 到电脑？太慢。开笔记本？太沉。算了吧。

**Open Code Web** 就是为了这个时刻而生的。

它把 AI 编程助手完整地搬进了浏览器。打开网页就能用——不需要服务器、不需要 SSH、不需要保持电脑开机。iPad、手机、Chromebook，只要有浏览器和网络，你就有了一台 AI 工作站。

---

## 🎯 核心特性

| 特性 | 一句话说明 |
|------|-----------|
| 📁 **文件袋 (VFS)** | 所有文件在浏览器内存 + IndexedDB 中运作，支持快照和一键回滚（`/undo`） |
| 🖥️ **原生引擎** | 真正的 WASM 引擎：Lua 5.4、JavaScript (QuickJS)、GNU awk、GNU sed、bc——不是 JS 模拟，是原生二进制 |
| 🧠 **子智能体 (Explore)** | AI 可以把多文件探索委派给专用子代理，独立上下文、只回传结论，主对话保持干净 |
| 🌗 **深色模式** | 黑底白字的 ZCode 风格界面，Markdown 渲染精调——告别刺眼的浅色青绿 |
| 🔒 **密钥自持** | API Key 用 AES-GCM 加密存在 sessionStorage，标签页一关就消失 |
| 🗣️ **结构化问答** | AI 可以弹出单选/多选/文本输入面板，等你填完再继续 |
| 📋 **计划跟踪** | AI 通过 `update_plan` 维护进度，自动注入 System Prompt，永不健忘 |
| 🌐 **联网搜索** | `web_search` 开箱即用（内置 Tavily 开发密钥），`fetch_url` 获取网页内容 |
| 🧠 **双模式切换** | **Plan** 模式只读不写，**Bypass** 模式全自动执行。按 `Shift+Tab` 随时切换 |
| 🗜️ **上下文压缩** | `/compact` 用 LLM 把旧对话压缩为摘要，释放上下文，带进行中动画 |
| 💰 **Token 透明** | `/tokens` 看实时用量，`/cost` 估算花费，`/export` 导出会话 |

---

## 🚀 快速开始

### 1. 克隆并安装

```bash
git clone https://github.com/5849mog/OpenCodeCLI.git
cd OpenCodeCLI
npm install
```

### 2. 配置 API Key

启动后会自动弹出设置面板。支持所有 OpenAI 兼容的 API：

**OpenAI · DeepSeek · Zhipu · OpenRouter · Groq · Ollama（本地）**

> 💡 不想填 Key？用 Groq 的免费额度，或者本地跑 Ollama（需开启 CORS）。

### 3.（可选）配置联网能力

`web_search` **开箱即用**——内置 Tavily 开发密钥，无需任何配置。想要更高额度可在 **Settings → Web & Search** 填入自己的 Tavily / Brave Key。[👉 查看详细配置教程](WEB_TOOLS_GUIDE.md)。`fetch_url` 也开箱即用（可选启用 Jina AI Reader 代理）。

### 4. 启动

```bash
npm run dev
```

打开 **http://localhost:3000**，上传你的项目文件夹，开始跟 AI 对话。

---

## 📦 部署到生产（iPad 可用）

纯前端静态应用，部署到任意静态托管服务：

```bash
# 1. 修改 next.config.ts，添加 output: 'export'
# 2. 构建
npm run build
# 3. 将 out/ 目录部署到 Vercel / Netlify / Cloudflare Pages
```

部署后在 iPad 上打开链接，**添加到主屏幕**，就像原生 App 一样使用。

---

## 🛠️ 技术栈

| 类别 | 技术 |
|------|------|
| ⚛️ 框架 | Next.js 16 + React 19 |
| 📦 状态 | Zustand 5 |
| ✏️ 编辑器 | CodeMirror 6 |
| 🧠 引擎 | Lua 5.4 / JavaScript (QuickJS) / GNU awk / GNU sed / bc — WebAssembly |
| 🎯 AI | OpenAI 兼容 API（DeepSeek / OpenRouter / Groq / Ollama…） |
| 💾 持久化 | IndexedDB + idb |
| 🎨 样式 | Tailwind CSS 4 + shadcn/ui（深色主题） |
| 📎 文件操作 | JSZip（导入/导出） |
| 📝 Markdown | react-markdown + remark-gfm + KaTeX + Mermaid |
| 🌀 动画 | Framer Motion |

---

## ⚠️ 诚实说明

- **没有真实 OS** — 终端是 WASM 模拟的，`awk`/`sed`/`lua`/`bc`/`printf` 等是原生编译（Emscripten），但 `npm install`、`git`、`ps` 等系统级命令不支持
- **大文件（>5MB）** 自动转为占位符，防止 AI 消耗过多 Token
- **纯前端** — 没有后端数据库、没有用户系统，所有数据只在你的浏览器里
- **API Key 安全** — 虽然加密存储，XSS 攻击仍可能导致泄露。建议用 API 网关代理（如 Cloudflare Workers）做二次保护

---

## 📖 常用命令

| 命令 | 作用 |
|------|------|
| `/help` | 显示所有 Slash 命令 |
| `/clear` | 清空会话（保留文件袋） |
| `/model <name>` | 切换 AI 模型 |
| `/tokens` | 显示 Token 用量 |
| `/cost` | 估算花费（USD） |
| `/export` | 导出会话为 Markdown |
| `/undo` | 撤销上一次 AI 文件编辑 |
| `/diff` | 显示所有文件变更 |
| `/run <command>` | 直接执行 Bash（不经过 AI） |
| `/compact` | 用 LLM 把旧对话压缩为摘要，释放上下文（带进行中动画） |

---

## 🤝 贡献

目前个人维护，欢迎 Issue 和 PR。

对「浏览器端 Agent」感兴趣？想在任何设备上随时编程？来一起聊。

---

## 📄 许可证

MIT

---

## 🙏 致谢

- [Open Code](https://github.com/sindresorhus/open-code) — 原版 CLI 项目
- [Claude Code](https://claude.ai/code) — 交互设计灵感
- Vercel — 部署平台

---

<div align="center">

**这个项目不是为了替代 VSCode 或 Cursor。**

**它是为了让你在只有 iPad 的时刻，依然能带着一个「懂代码的副驾驶」上路。** 🚗💨

</div>

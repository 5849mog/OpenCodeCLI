<div align="center">

# Open Code Web 🧠✨

**把你的 iPad 变成 AI 编程工作站 — 纯浏览器，无需服务器**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Next.js](https://img.shields.io/badge/Next.js-16-black?logo=next.js)](https://nextjs.org)
[![React](https://img.shields.io/badge/React-19-61DAFB?logo=react)](https://react.dev)
[![Zustand](https://img.shields.io/badge/Zustand-5-673AB8?logo=zustand)](https://github.com/pmndrs/zustand)
[![Deploy](https://img.shields.io/badge/Deploy-GitHub_Pages-8A2BE2)](.github/workflows/deploy.yml)
[![Changelog](https://img.shields.io/badge/成长日志-Changelog-E58F67)](CHANGELOG.md)

</div>

## 📑 目录

- [它解决什么问题？](#它解决什么问题)
- [核心特性](#核心特性)
- [快速开始](#快速开始)
- [部署到生产](#部署到生产ipad-可用)
- [技术栈](#技术栈)
- [Slash 命令与图形入口](#slash-命令与图形入口)
- [诚实说明与已知限制](#诚实说明与已知限制)
- [常见问题](#常见问题)
- [成长日志](#-成长日志)
- [贡献](#贡献)
- [许可证](#许可证)
- [致谢](#致谢)

---

## 🌟 它解决什么问题？

> 你躺在沙发上，手里只有一台 iPad。突然想到一个代码思路想试试——SSH 到电脑？太慢。开笔记本？太沉。算了吧。

**Open Code Web** 就是为了这个时刻而生的。

它把 AI 编程助手完整地搬进了浏览器。打开网页就能用——不需要服务器、不需要 SSH、不需要保持电脑开机。iPad、手机、Chromebook，只要有浏览器和网络，你就有了一台 AI 工作站。

---

## 🎯 核心特性

| 特性 | 一句话说明 |
|------|-----------|
| 📁 **文件袋 (VFS)** | 所有文件在浏览器内存 + IndexedDB 中运作，支持快照与一键回滚（`/undo`，含 bash 写入） |
| 🖥️ **原生引擎** | 真正的 WASM 引擎：Lua 5.4、JavaScript (QuickJS)、POSIX awk (onetrueawk)、GNU sed、bc——不是 JS 模拟，是原生二进制 |
| 📊 **数据工具** | YAML / CSV 解析、JSONata 查询、mathjs 数学（矩阵/单位/统计）——浏览器内直接处理数据文件 |
| 🔧 **代码引擎** | esbuild-wasm 转译 / 语法检查 + 本地 **Git**（isomorphic-git + lightning-fs）——状态/日志/提交，全在浏览器内 |
| 📈 **可视化** | Mermaid + Graphviz (DOT, WASM) + Chart.js——Markdown 代码块直接渲染流程图/复杂图/数据图表 |
| 🧩 **Skill 技能** | AI 可浏览、按需加载内置与自定义 Skill，并**自行创建 / 删除**，自定义技能独立持久化 |
| 🧠 **子智能体 (Explore)** | AI 把多文件探索委派给专用子代理，独立上下文、只回传结论，主对话保持干净 |
| 🌗 **深色模式** | 黑底白字的 ZCode 风格界面，Markdown 渲染精调（GFM + KaTeX + Mermaid） |
| 🔒 **密钥自持** | API Key 用 AES-GCM 加密，主密钥持久化到 localStorage，**刷新页面自动恢复、不必重填**；支持一键锁定与空闲自动锁定 |
| 🗣️ **结构化问答** | AI 可以弹出单选/多选/文本输入面板，等你填完再继续 |
| 📋 **计划跟踪** | AI 通过 `update_plan` 维护进度，自动注入 System Prompt，永不健忘 |
| 🌐 **联网搜索** | `web_search` / `fetch_url`（需自配 Tavily 或 Brave Key，均有免费额度） |
| 🧠 **双模式切换** | **Plan** 模式只读不写，**Bypass** 模式全自动执行。按 `Shift+Tab` 随时切换 |
| 🗜️ **上下文压缩** | `/compact` 用 LLM 把旧对话压缩为摘要，释放上下文，带进行中动画 |
| 💰 **Token 透明** | Token 面板 / `/tokens` 看实时用量与压缩释放，`/cost` 估算花费 |

---

## 🚀 快速开始

### 1. 克隆并安装

```bash
git clone https://github.com/5849mog/OpenCodeCLI.git
cd OpenCodeCLI
npm install
```

### 2. 配置 API Key

首次使用时自动弹出设置面板（之后刷新/重开不再弹，Key 本地持久化自动恢复），支持所有 OpenAI 兼容的 API，内置以下预设：

**OpenAI · DeepSeek · 智谱 (Zhipu) · Moonshot (Kimi) · OpenRouter · Groq**

> 💡 没有现成 Key？用 **Groq** 的免费额度最省事；或本地跑 **Ollama**（在 Settings 里手工填 baseUrl，如 `http://localhost:11434/v1`，需开启 CORS）。

### 3.（可选）配置联网能力

`web_search` **需要自配一个搜索 API Key**（Settings → **Web & Search**，填入 Tavily 或 Brave Key，两者都有免费额度）；`fetch_url` 开箱即用（可选启用 Jina AI Reader 代理）。
👉 [查看详细配置教程](WEB_TOOLS_GUIDE.md)

### 4. 启动

```bash
npm run dev
```

打开 **http://localhost:3000**，上传你的项目文件夹，开始跟 AI 对话。

---

## 📦 部署到生产（iPad 可用）

纯前端静态应用，**静态导出已内置**（`next.config.ts` 已配置 `output: 'export'`），构建后直接部署 `out/` 目录：

```bash
# 1. 构建（生成静态站点到 out/）
npm run build
# 2. 将 out/ 部署到任意静态托管：GitHub Pages / Vercel / Netlify / Cloudflare Pages
```

> 💡 **子路径部署**（如 `username.github.io/repo-name/`）：构建时设置环境变量 `REPO_NAME` 即可自动带上 basePath：
> ```bash
> REPO_NAME=OpenCodeCLI npm run build
> ```
> 本仓库的 GitHub Actions（`.github/workflows/deploy.yml`）已自动完成构建 + 部署到 GitHub Pages。

部署后在 iPad 上打开链接，**添加到主屏幕**，就像原生 App 一样使用。

---

## 🛠️ 技术栈

| 类别 | 技术 |
|------|------|
| ⚛️ 框架 | Next.js 16 + React 19 |
| 📦 状态 | Zustand 5 |
| ✏️ 编辑器 | CodeMirror 6 |
| 🧠 引擎 | Lua 5.4 / JavaScript (QuickJS) / POSIX awk (onetrueawk) / GNU sed / bc / esbuild（转译+语法检查）— WebAssembly |
| 📊 数据工具 | YAML / PapaParse (CSV) / JSONata (JSON 查询) / mathjs — 浏览器内纯 JS |
| 📈 可视化 | Mermaid / Graphviz (DOT, WASM) / Chart.js — Markdown 代码块直接渲染 |
| 🎯 AI | OpenAI 兼容 API（DeepSeek / OpenRouter / Groq / Ollama…） |
| 💾 持久化 | IndexedDB + idb（文件袋 / 会话 / 自定义 Skill），lightning-fs（本地 Git 底层） |
| 🧬 版本控制 | isomorphic-git — 本地 init / status / commit / log（无远程） |
| 🎨 样式 | Tailwind CSS 4 + shadcn/ui（深色主题） |
| 📎 文件操作 | JSZip（导入/导出） |
| 📝 Markdown | react-markdown + remark-gfm + KaTeX + Mermaid |
| 🌀 动画 | Framer Motion |

---

## 📖 Slash 命令与图形入口

### Slash 命令

| 命令 | 作用 |
|------|------|
| `/help` | 显示所有 Slash 命令 |
| `/clear` · `/reset` | 清空会话（保留文件袋） |
| `/model <name>` | 切换 AI 模型 |
| `/tokens` | 显示 Token 用量 |
| `/compact` | 用 LLM 压缩旧对话为摘要，释放上下文（带动画） |
| `/export` | 导出会话为 Markdown（`/export json` 导出为 JSON） |
| `/cost` | 估算花费（USD） |
| `/undo` | 撤销上一次 AI 文件编辑 / bash 写入 |
| `/diff` | 显示所有文件变更 |
| `/skills` | 列出可用的 Skill 技能包 |

### 图形化入口（不必敲命令）

| 入口 | 位置 | 打开什么 |
|------|------|----------|
| 📜 上下文按钮 | Terminal header | Payload 查看器（查看/编辑发给 AI 的完整上下文） |
| 📊 用量按钮 | Terminal header | Token 用量面板（= `/tokens`） |
| 💬 Token 计数 | 输入区下方，点击 | Token 用量面板 |
| ✨ 技能按钮 | 侧边栏（Sparkles） | Skills 技能面板（浏览 / 管理 Skill） |
| ⚙️ 设置 | 侧边栏底部 | Settings（含会话导出/导入） |
| 📖 帮助 | 侧边栏底部 | Help 对话框（= `/help`） |
| 👥 子智能体角标 | 右侧栏「文件」Tab | 该次任务已产出的子代理数 |

> 💡 **右侧栏三个面板 Tab**：**文件 / 变更 / 文件袋** 已图形化，带滑动下划线指示当前面板，文件树收进其中，浏览与回溯无需再敲 slash 命令。

---

## ⚠️ 诚实说明与已知限制

- **没有真实 OS** — 终端 bash 是沙箱模拟的，`awk`/`sed`/`lua`/`js`/`bc` 等是原生编译（Emscripten / WASM），但 `npm install`、`ps` 等系统级命令不支持；Git 由内置 **isomorphic-git 引擎**提供（非系统 `git`），仅支持 init / status / add / commit / log / diff，**无远程 push / clone**
- **bash 是"模拟 shell"而非真实 bash** — 无 shell 变量（除 for 循环体内 `$f`）、参数不做 glob 展开（`echo *` 输出字面 `*`）、`2>/dev/null` 静默忽略、`echo`/`printf` 不自动加尾换行、无 heredoc、for 循环仅单层（不支持嵌套 / glob 列表 / break / continue）
- **大文件（>5 MiB）** 自动转为占位符，防止 AI 消耗过多 Token
- **纯前端** — 没有后端数据库、没有用户系统，所有数据只在你的浏览器里
- **API Key 安全** — 密钥用 AES-GCM 加密（密文+盐+IV 存 sessionStorage，主密钥持久化到 localStorage），**刷新页面自动恢复、无需重填**；支持一键锁定与可选空闲自动锁定。这是「刷新不丢」与「本地可解」的权衡：XSS 攻击仍可读主密钥而解密 Key。建议用 API 网关代理（如 Cloudflare Workers）做二次保护

---

## ❓ 常见问题

### 会话数据存在哪里？清缓存会不会丢？

所有会话与文件袋都存在浏览器的 IndexedDB 里。**清除浏览器站点数据会导致数据丢失**——建议在 Settings → **会话备份** 中定期「导出全部会话」为 JSON 文件；换浏览器 / 清缓存后「导入并覆盖全部」即可完整恢复。注意：API Key 不随导出文件迁移（安全约束），换环境后需重新填写。

### 为什么不用后端服务器？

纯前端的意义在于：任何设备、任何地点，打开网页就能用，没有服务端成本、没有账号系统、你的代码永远只在你自己的浏览器里。

### 上下文用满了怎么办？

两种方式：**`/compact`** 用 LLM 把旧对话压缩为摘要（Token 面板可看到压缩次数与累计释放量）；或 send 时超过 ~60K token 预算会自动截断较旧消息并压缩工具结果。

### `fetch_url` 报 "Failed to fetch"？

目标网站通常不支持 CORS。`fetch_url` 会自动尝试 Jina Reader 回退，仍失败可配置自定义 CORS 代理——详见 [WEB_TOOLS_GUIDE.md](WEB_TOOLS_GUIDE.md)。

### 如何撤销一次错误的写入？

`/undo` 或让 AI 调用 `undo_edit`。**bash 写入**（`>`/`>>`/mkdir/touch/cp/mv/`sed -i` 等）同样可撤销。

---

## 🤝 贡献

目前个人维护，欢迎 Issue 和 PR。

对「浏览器端 Agent」感兴趣？想在任何设备上随时编程？来一起聊。

---

## 🚀 成长日志

这个项目的每一次提交都被记录在 [**CHANGELOG.md**](CHANGELOG.md) —— 从 2026-07-28 立项至今的完整成长轨迹：新功能、缺陷修复、UI 打磨，按日期倒序，每条都可点击跳转到对应的 GitHub commit。点击下方按钮查看：

[![📖 打开完整成长日志](https://img.shields.io/badge/📖_打开_完整_成长日志-CHANGELOG.md-E58F67?style=for-the-badge)](CHANGELOG.md)

> 日志由 `gen-changelog.mjs` 从 Git 历史自动生成，新增提交时可一键重新生成（`node gen-changelog.mjs`）。

---

## 📄 许可证

[MIT](LICENSE)

---

## 🙏 致谢

- [Open Code](https://github.com/sindresorhus/open-code) — 界面与交互的灵感来源
- [Claude Code](https://claude.ai/code) — 交互设计灵感
- [One True Awk](https://github.com/onetrueawk/awk) — POSIX awk 引擎
- [quickjs-emscripten](https://github.com/justjake/quickjs-emscripten) — JavaScript 引擎

---

<div align="center">

**这个项目不是为了替代 VSCode 或 Cursor。**

**它是为了让你在只有 iPad 的时刻，依然能带着一个「懂代码的副驾驶」上路。** 🚗💨

</div>

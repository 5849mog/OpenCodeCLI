<div align="center">

# Open Code Web 🧠✨

**将尔之 iPad 化为 AI 编程之工作台 — 纯任浏览器，无需服务器**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Next.js](https://img.shields.io/badge/Next.js-16-black?logo=next.js)](https://nextjs.org)
[![React](https://img.shields.io/badge/React-19-61DAFB?logo=react)](https://react.dev)
[![Zustand](https://img.shields.io/badge/Zustand-5-673AB8?logo=zustand)](https://github.com/pmndrs/zustand)
[![Deploy](https://img.shields.io/badge/Deploy-GitHub_Pages-8A2BE2)](.github/workflows/deploy.yml)
[![Changelog](https://img.shields.io/badge/成长日志-Changelog-E58F67)](CHANGELOG.md)

</div>

## 📑 目次

- [缘起何故](#缘起何故)
- [核心特性](#核心特性)
- [速启之法](#速启之法)
- [布于生产](#布于生产ipad-可用)
- [技术之栈](#技术之栈)
- [Slash 之令与图形之径](#slash-之令与图形之径)
- [诚言与所限](#诚言与所限)
- [问难答疑](#问难答疑)
- [成长日志](#-成长日志)
- [共襄](#共襄)
- [许可](#许可)
- [鸣谢](#鸣谢)

---

## 🌟 缘起何故？

> 闲卧榻上，手中唯余一 iPad，忽有一思涌上心头，欲一试为快——SSH 归电脑乎？太慢。启笔记本乎？太重。遂作罢。

**Open Code Web**，正为此刻而生。

其将 AI 编程之助尽数迁入浏览器：开卷即用——毋需服务器、毋需 SSH、毋需电脑长守开机。无论 iPad、手机抑或 Chromebook，但得浏览器与网络，便自有一方随身可携之 AI 工作台。

---

## 🎯 核心特性

| 特性 | 一言以蔽 |
|------|-----------|
| 📁 **文件袋 (VFS)** | 诸文件皆在浏览器内存 + IndexedDB 中运作，持快照与一键回滚（`/undo`，含 bash 写入） |
| 🖥️ **原生引擎** | 真 WASM 引擎：Lua 5.4、JavaScript (QuickJS)、POSIX awk (onetrueawk)、GNU sed、bc——原生二进制，非 JS 之拟 |
| 📊 **数据之具** | YAML / CSV 解析、JSONata 之询、mathjs 数学（矩阵/单位/统计）——浏览器内径理数据之件 |
| 🔧 **代码之擎** | esbuild-wasm 转译/语法之检 + 本地 **Git**（isomorphic-git + lightning-fs）——状态/日志/提交，全在浏览器内 |
| 📈 **可视之绘** | Mermaid + Graphviz（DOT、WASM）+ Chart.js——Markdown 代码块径渲流程之图、繁复之图与数据之图表 |
| 🧩 **Skill 之技** | AI 可浏览、按需载内置与自定 Skill，并**自行创建/删除**，自定之技独立久存 |
| 🧠 **子智能体 (Explore)** | AI 将多文件之探委于专用子代理，独立上下文、只回结论，主对话常保澄澈 |
| 🌗 **深色之模** | 黑底白字之 ZCode 风界面，Markdown 渲染精调（GFM + KaTeX + Mermaid） |
| 🔒 **密钥自持** | API Key 以 AES-GCM 加密，主密钥久存于 localStorage，**刷新自动复、毋需重填**；持一键锁定与闲时自动锁定 |
| 🗣️ **结构之问** | AI 可弹单选/多选/文本之盘，俟君填毕方续 |
| 📋 **计划之随** | AI 凭 `update_plan` 维进度，自动注 System Prompt，永不失忆 |
| 🌐 **联网之索** | `web_search` / `fetch_url`（需自配 Tavily 或 Brave Key，皆有免费之额） |
| 🧠 **双模之换** | **Plan** 之模只读不写，**Bypass** 之模全自动为，以 `Shift+Tab` 随时相易 |
| 🗜️ **上下文之缩** | `/compact` 以 LLM 将旧谈缩为摘要，释上下文，附进行中动画 |
| 💰 **Token 之明** | Token 之盘 / `/tokens` 观实时之量与压缩所释，`/cost` 度其耗 |

---

## 🚀 速启之法

### 其一、克隆而装

```bash
git clone https://github.com/5849mog/OpenCodeCLI.git
cd OpenCodeCLI
npm install
```

### 其二、置 API Key

初度使用自弹设置之盘（此后刷新/重开不再弹，Key 本地久存而自复）。凡 OpenAI 兼容之 API 皆可，内置以下预设：

**OpenAI · DeepSeek · 智谱 (Zhipu) · Moonshot (Kimi) · OpenRouter · Groq**

> 💡 岁无余钥，**Groq** 之免费之额最是省事；或于本地起「**Ollama**」（至 Settings 手书 baseUrl，如 `http://localhost:11434/v1`，须开 CORS）。

### 其三、（可省）置联网之能

`web_search` **需自配搜索 API Key**（Settings → **Web & Search**，填 Tavily 或 Brave Key，二者皆有免费之额）；`fetch_url` 开箱即用（可省启 Jina AI Reader 代理）。
👉 [观详细配置之教](WEB_TOOLS_GUIDE.md)

### 其四、启之

```bash
npm run dev
```

开 **http://localhost:3000**，上传尔之项目之夹，始与 AI 对谈。

---

## 📦 布于生产（iPad 可用）

本为纯前端静态之应用，**已内置静态导出**（`next.config.ts` 中已设 `output: 'export'`），构建后，取 `out/` 之目录布于任意静态托管即可：

```bash
# 其一、构建（生成静态之站于 out/）
npm run build
# 其二、将 out/ 布于 GitHub Pages / Vercel / Netlify / Cloudflare Pages
```

> 💡 **子路径之布**（如 `username.github.io/repo-name/`）：构建时设环境之变 `REPO_NAME` 即自动携 basePath：
> ```bash
> REPO_NAME=OpenCodeCLI npm run build
> ```
> 本仓之 GitHub Actions（`.github/workflows/deploy.yml`）已自动成构建而布于 GitHub Pages。

部署讫，于 iPad 上启其链，**添至主屏**，便可如原生 App 般所用。

---

## 🛠️ 技术之栈

| 类别 | 技术 |
|------|------|
| ⚛️ 框架 | Next.js 16 + React 19 |
| 📦 状态 | Zustand 5 |
| ✏️ 编辑器 | CodeMirror 6 |
| 🧠 引擎 | Lua 5.4 / JavaScript (QuickJS) / POSIX awk (onetrueawk) / GNU sed / bc / esbuild（转译+语法检）— WebAssembly |
| 📊 数据之具 | YAML / PapaParse (CSV) / JSONata (JSON 询) / mathjs — 浏览器内纯 JS |
| 📈 可视之绘 | Mermaid / Graphviz (DOT, WASM) / Chart.js — 径于浏览器内渲染 Markdown 代码块 |
| 🎯 AI | OpenAI 兼容 API（DeepSeek / OpenRouter / Groq / Ollama…） |
| 💾 持久 | IndexedDB + idb（文件袋 / 会话 / 自定 Skill），lightning-fs（本地 Git 之底） |
| 🧬 版之控 | isomorphic-git — 本地 init / status / commit / log（无远程） |
| 🎨 样式 | Tailwind CSS 4 + shadcn/ui（深色之题） |
| 📎 文件之操 | JSZip（导入/导出） |
| 📝 Markdown | react-markdown + remark-gfm + KaTeX + Mermaid |
| 🌀 动画 | Framer Motion |

---

## 📖 Slash 之令与图形之径

### Slash 之令

| 命令 | 其用 |
|------|------|
| `/help` | 示所有 Slash 之令 |
| `/clear` · `/reset` | 清空会话（留文件袋） |
| `/model <name>` | 易 AI 之模 |
| `/tokens` | 示 Token 之量 |
| `/compact` | 以 LLM 缩旧谈为摘要，释上下文（带动画） |
| `/export` | 出会话为 Markdown（`/export json` 出为 JSON） |
| `/cost` | 度其耗（USD） |
| `/undo` | 撤上一次 AI 文件之编 / bash 之书 |
| `/diff` | 示所有文件之易 |
| `/skills` | 列可用之 Skill 技包 |

### 图形之径（毋须敲令）

| 径口 | 其位 | 所启 |
|------|------|----------|
| 📜 上下文之钮 | Terminal 顶栏 | Payload 观器（观/编发予 AI 之全上下文） |
| 📊 用量之钮 | Terminal 顶栏 | Token 用量之盘（= `/tokens`） |
| 💬 Token 计数 | 输入区之下，点击 | Token 用量之盘 |
| ✨ 技之钮 | 侧边栏（Sparkles） | Skills 技之盘（览/管 Skill） |
| ⚙️ 设置 | 侧边栏之底 | Settings（含会话导出入） |
| 📖 帮助 | 侧边栏之底 | Help 之谈（= `/help`） |
| 👥 子智能体之标 | 右侧栏「文件」Tab | 示本次之任所产之子代理数 |

> 💡 **右侧栏三面板 Tab**：**文件 / 变更 / 文件袋** 已尽数图形化，带滑之下线示当前之盘，文件树纳于其中，览与溯皆毋需再敲 slash 之令。

---

## ⚠️ 诚言与所限

- **无真实 OS** — 终端 bash 乃沙箱之拟；`awk`/`sed`/`lua`/`js`/`bc` 等乃原生之编（Emscripten / WASM），然 `npm install`、`ps` 等系统级之令不支；Git 由内置 **isomorphic-git 引擎**所供（非系统 `git`），仅支 init / status / add / commit / log / diff，**无远程 push / clone**
- **bash 乃"拟 shell"而非真 bash** — 无 shell 之变（唯 for 循环体内 `$f`）、参数不作 glob 之展（`echo *` 出字面 `*`）、`2>/dev/null` 被默然所略、`echo`/`printf` 不自补尾换行、无 heredoc、for 循环仅单层（不支嵌套 / glob 列 / break / continue）
- **大文件（>5 MiB）** 自动转占位之符，防 AI 耗 Token 过甚
- **纯前端** — 无后端数据库、无用户之系，诸数据唯存于尔之浏览器
- **API Key 之安** — 密钥以 AES-GCM 加密（密文 + 盐 + IV 存于 sessionStorage，主密钥久存于 localStorage），**刷新自动复、毋需重填**；持一键锁定与可省闲时自动锁定。此乃「刷新不失」与「本地可解」相权之衡：若逢 XSS，主密钥犹可被读而借以解钥。宜以 API 网关之代（如 Cloudflare Workers）作二重之护

---

## ❓ 问难答疑

### 会话之数据存于何处？清缓存可会遗乎？

诸会话与文件袋皆存于浏览器之 IndexedDB。**清浏览器站点之数据则数据尽失**——宜于 Settings → **会话备份** 中，按「导出全部会话」定期为 JSON 之件；换浏览器 / 清缓存后，依「导入并覆盖全部」即可完璧复归。慎之：缘于安全之束，API Key 不随导出之件而迁，易境之后须重书。

### 何以不用后端之器？

纯前端之妙，在：任何设备、任何地点，开卷即用——无服务端之费、无账号之系，君之代码终其一生唯存于己之浏览器中。

### 上下文用满，奈何？

有二法：**`/compact`** 以 LLM 将旧谈缩为摘要（Token 之盘可查缩次与累计所释之量）；或发时若超 ~60K token 之约，自动断较旧之信而缩工具之果。

### `fetch_url` 何以报 "Failed to fetch"？

所访之站多不允 CORS。`fetch_url` 自动试 Jina Reader 之回；若仍不济，可置自定 CORS 之代——详见 [WEB_TOOLS_GUIDE.md](WEB_TOOLS_GUIDE.md)。

### 何以撤一次误书？

以 `/undo`，或令 AI 呼 `undo_edit`。**bash 之书**（`>`/`>>`/mkdir/touch/cp/mv/`sed -i` 等）同可追悔。

---

## 🤝 共襄

此物今为一人之独养，广纳四方 Issue 与 PR。

亦好「浏览器端 Agent」之道？欲随时随地操琴而写码？愿与君共话。

---

## 🚀 成长日志

自 2026-07-28 立项至今，每番提交皆录于 [**CHANGELOG.md**](CHANGELOG.md)——新功、补漏、UI 之雕琢，一朝一夕尽收眼底，按日期倒序罗列，每条皆可点触而达其 GitHub commit。按下方之钮以观：

[![📖 打开完整成长日志](https://img.shields.io/badge/📖_打开_完整_成长日志-CHANGELOG.md-E58F67?style=for-the-badge)](CHANGELOG.md)

> 日志由 `gen-changelog.mjs` 自 Git 史章自动生成，新添之提交可一键重造（`node gen-changelog.mjs`）。

---

## 📄 许可

[MIT](LICENSE)

---

## 🙏 鸣谢

- [Open Code](https://github.com/sindresorhus/open-code) — 界面与交互之灵感所出
- [Claude Code](https://claude.ai/code) — 交互设计之灵感所出
- [One True Awk](https://github.com/onetrueawk/awk) — POSIX awk 之引擎
- [quickjs-emscripten](https://github.com/justjake/quickjs-emscripten) — JavaScript 之引擎

---

<div align="center">

**此物非为替 VSCode 或 Cursor 而作。**

**唯愿君孤居掌中有 iPad 之际，犹能携一位「通晓代码之副驾」同途。** 🚗💨

</div>

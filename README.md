<div align="center">

# Open Code Web

**浏览器里的 AI 编程副驾 — 打开即用，无需服务器，iPad 也能写代码**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Next.js](https://img.shields.io/badge/Next.js-16-black?logo=next.js)](https://nextjs.org)
[![React](https://img.shields.io/badge/React-19-61DAFB?logo=react)](https://react.dev)
[![Zustand](https://img.shields.io/badge/Zustand-5-673AB8?logo=zustand)](https://github.com/pmndrs/zustand)
[![Deploy](https://img.shields.io/badge/Deploy-GitHub_Pages-8A2BE2)](.github/workflows/deploy.yml)
[![Changelog](https://img.shields.io/badge/成长日志-CHANGELOG-E58F67)](CHANGELOG.md)

</div>

---

## 这是什么

睡在沙发上，手里只有一台 iPad，想改两行代码——开电脑太重，SSH 太慢，怎么办？

**Open Code Web** 把整个 AI 编程工作台搬进了浏览器：克隆代码、安装依赖、配置一个 API Key，然后——你的 iPad / 手机 / Chromebook 就拥有了一位「通晓代码的副驾」。所有文件、会话、密钥都保存在你自己的浏览器里，**没有任何服务器，没有任何账号**。

- 🗂️ **纯前端静态部署**：构建产物直接扔到 GitHub Pages / Vercel / Netlify，随时访问
- 🔌 **自带** 一套完整的「原生」工具链（Lua / JS / awk / sed / git / zip……全部 WASM 跑在浏览器里）
- 🧮 内置 **DeepSeek 官方真分词器**，token 消耗精准到字节
- 🎨 界面 **像素级对标 ZCode**：深色主题、对话框、全屏设置页、整轮对话折叠

---

## ✨ 功能亮点

### 🧠 智能体能力

| 能力 | 说明 |
|------|------|
| **多步 Agent 循环** | 自主思考 → 计划 → 调用工具 → 观察结果 → 迭代，最多 44 个工具可选 |
| **子智能体 (Explore)** | 多文件探索委派给专用子代理，独立上下文、只回结论，主对话保持清爽 |
| **实时思考流** | 思考过程逐字实时显示，完成后自动闭合为「思考过程 持续了几秒」 |
| **整轮对话折叠** | 每个任务只显示「已工作 X 分 X 秒 ⌄」+ 最终总结；点击向下弹出完整执行轨迹（全部叙述、思考、工具步骤、diff），完成后自动收起 |
| **Plan / Bypass 双模式** | `Shift+Tab` 随时切换：Plan 模式只读不改文件，Bypass 全自动执行 |
| **计划进度跟踪** | AI 用 `update_plan` 维护计划，自动注入系统提示词，永不「失忆」 |
| **结构化问答** | AI 弹出现场问题（单选 / 多选 / 文本），你答完才继续 |
| **Skill 技能包** | AI 能浏览、按需加载内置与自定义 Skill，甚至**自己创建/删除**；自定义技能独立持久保存 |
| **联网搜索 & 抓取** | `web_search`（Tavily / Brave，均有免费额度）+ `fetch_url`（自带 Jina Reader 代理，跨站也能抓） |
| **运行模式** | 完整 / 精简 / 极简三档提示词：同样的任务，极简档固定开销从 ~26K 降到 ~2K tokens |

### 🔧 浏览器里的「原生」工具箱

不是 JS 模拟，是真正的原生引擎编译成 WASM：

| 工具 | 引擎 |
|------|------|
| **bash** | 沙箱化命令行（`pipe` / `$VAR` / for 循环，含限制见下） |
| **Lua 5.4 / JavaScript / awk / sed / bc** | 官方解释器 + Emscripten/WASM 编译 |
| **Git** | isomorphic-git + lightning-fs：init / status / add / commit / log / diff，全在浏览器内 |
| **esbuild** | 转译 + 语法检查，TypeScript / JSX 一键校验 |
| **数据工具** | YAML / CSV (PapaParse) / JSONata / mathjs——矩阵、单位、统计一站搞定 |
| **文件编辑** | `edit_file` / `multi_edit` / `apply_patch` / `insert_at` / `undo_edit`，带 diff 预览与真实 `+N -M` 行数统计 |
| **ZIP** | 上传 `.zip` **自动解压**入工作区；`zip_archive` / `unzip_archive` 随心打包解析 |
| **可视化** | Markdown 代码块直接渲染 **Mermaid** / **Graphviz (DOT, WASM)** / **Chart.js** / KaTeX 数学公式 |

### 🎨 界面：像素级对标 ZCode

- **深色中性主题**：纯黑主区 + 灰阶分层 + 橙色点睛（完全访问徽标、当前会话圆点、开关）
- **侧栏**：新建任务 `⌘N` / 搜索 `⌘K` / Skill / 文件袋，平铺会话列表，当前会话高亮置顶；底部用户区（头像 + 设置）
- **两层命令框**：输入区 + 底部工具栏（`+` 附件、橙色「完全访问」徽标、`⚙ 模型`、`⚡ 思考强度`、圆形发送键），首页配问候语、快捷建议、功能卡片与装饰 Logo
- **对话**：用户消息圆角气泡 + 原地编辑（铅笔改写、发送后替换并从该消息重建）；AI 回复带复制 / 点赞 / 点踩 / 重新生成 / 时间戳
- **全屏设置页**：左测分类导航（基础设置 / Agent 能力 / 数据与统计）+ 右侧卡片化内容页，全部开关 ZCode 式圆角拨杆
- **Chat 即文档**：GFM 表格 / 任务列表 / PPT、代码高亮（Prism）、点击工具结果中的文件路径直接打开 CodeMirror 编辑器（`Ctrl+S` 保存）

### 🧮 DeepSeek 真分词器（本项目独有）

不是拍脑袋估算，是 **DeepSeek-V3 官方 128k BPE 词表**（`@huggingface/tokenizers` WASM 运行时，与 Python `transformers` 同引擎，**逐字节一致**）：

- **实时输入计数**：打字时输入框实时显示 `≈N tokens`（输入文本 + 文本/代码类附件内容精确分词，图片按 vision 计费 384 tokens/张）
- **自动压缩引擎**：真分词器估算超预算 85% 时自动用 LLM 摘要压缩旧上下文；发送前按预算精确截断
- **Token 面板**：`/tokens` 精确统计当前上下文占用（prompt + completion + 预算余量）
- `/compact` 压缩前后 token 对比，全部走真分词器
- 智能降级：词表加载完成前自动用字符启发式估算（±15%），首条消息零延迟，加载完成后自动升级为精确计数（LRU 缓存，同一文本重复计算零成本）

### 🔒 安全设计

- **API Key 从不出境**：AES-GCM 加密（Master Key 由 PBKDF2 派生），密文与主密钥都留在 `localStorage`——刷新 / 重开自动恢复，**从不需要重新输入**
- 一键清除密钥 + **闲时自动锁定**（默认 30 分钟）
- 会话导出文件**绝不包含 API 密钥**，密钥只活在你自己的浏览器里
- AI 请求 URL 白名单校验：拒绝 `localhost`、环回、私有与保留地址（防 SSRF）
- Plan 模式下 bash 只读，AI 改文件前必须经过你批准的计划

### 💾 数据与持久化

- **文件袋 (VFS)**：全部文件存于浏览器内存 + IndexedDB，任意时刻 `/undo` 一键回滚包括 bash、sed、git 写入在内的所有变更
- **会话管理**：多会话、标题搜索、重命名、删除；`/export` 导出 Markdown 或 JSON，Settings 支持整库**导出 / 导入覆盖**（换浏览器 / 清缓存之前记得备份）
- **审计面板**：每次工具调用、文件变更（含真实 `+N -M`）、token 消耗、成本估算（USD）全图表化
- **Token 账本**：累计 / 本轮真实 API 用量，按 main / 子代理 / 编排分源记录

---

## 🚀 快速开始

### 1. 克隆并安装

```bash
git clone https://github.com/5849mog/OpenCodeCLI.git
cd OpenCodeCLI
npm install
```

### 2. 配置 API Key

首次打开自动弹出设置页：填一个 **OpenAI 兼容** 的 API Key + Base URL 即可。内置快速预设：

**OpenAI · DeepSeek · 智谱 (Zhipu) · Moonshot (Kimi) · OpenRouter · Groq**

> 💡 没有付费 Key？**Groq** 免费额度很够用；或者本地跑个 **Ollama**，在设置里手填 `http://localhost:11434/v1`（需要开 CORS）。

### 3. （可选）联网搜索

`web_search` 需要在设置 → 搜索与抓取里填 Tavily 或 Brave 的 Key（都有免费额度）；`fetch_url` 开箱即用，详见 [WEB_TOOLS_GUIDE.md](WEB_TOOLS_GUIDE.md)。

### 4. 启动

```bash
npm run dev
```

打开 http://localhost:3000，上传你的项目文件夹（或让 AI 创建），开聊。

---

## 📦 部署（iPad 也能用）

项目是**纯静态导出**（`next.config.ts` 已设 `output: "export"`），构建后 `out/` 目录可扔到任何静态托管：

```bash
npm run build
```

- 子路径部署（如 `username.github.io/OpenCodeCLI/`）：构建时设环境变量 `REPO_NAME=OpenCodeCLI` 即可自动带上 basePath
- 仓库自带 GitHub Actions（`.github/workflows/deploy.yml`），push 到 `main` 自动构建并发布 GitHub Pages

部署后在 iPad 上用 Safari 打开链接 → **添加到主屏幕**，就像原生 App 一样。

---

## ⌨️ Slash 命令速查

| 命令 | 用途 |
|------|------|
| `/help` | 查看全部命令 |
| `/clear` / `/reset` | 清空会话（保留文件袋） |
| `/model <name>` | 不打开设置直接换模型 |
| `/compact` | 用 LLM 把旧对话压缩成摘要，释放上下文 |
| `/export` | 把对话导出为 Markdown（`/export json` 导 JSON） |
| `/cost` | 估算累计 API 费用（USD） |
| `/tokens` | 查看真实 token 用量 + 当前上下文精确占用 |
| `/skills` | 列出可用的 Skill 技能包 |
| `/undo` | 撤销上一次 AI 文件/命令写入（快照恢复） |
| `/diff` | 查看本次会话全部文件变更 |

图形入口：右上角按钮打开 **Payload 查看器**（查看/编辑发给 AI 的完整上下文）与 **Token 用量面板**；侧栏打开 **Skills** / **设置 / 帮助**；右下工具栏点击「累计 / 本轮」直达 Token 面板。

---

## ⚠️ 已知限制（老实说）

- **没有真实操作系统**：bash 是沙箱模拟——没有环境变量（仅 for 循环内 `$f`）、参数不做 glob 展开（`echo *` 输出字面 `*`）、`2>/dev/null` 被忽略、无 heredoc、for 循环不支持嵌套 / 中断；`npm install`、`ps` 等系统级命令不支持
- **Git 是内嵌引擎**（isomorphic-git）：支持 init / status / add / commit / log / diff，**不支持远程 `push` / `clone`**
- **大文件（>5 MiB）** 自动转成占位符，防止 AI 烧 token
- **纯前端**：无后端、无账号，所有数据在你的浏览器里——清站点数据 = 数据清空，记得定期设置 → 会话与备份 → 导出全部会话
- **API Key 安全性权衡**：「刷新自动恢复」意味着主密钥存于本地，若宿主环境被 XSS 仍可能被读取——生产使用建议套一层 API 网关（如 Cloudflare Workers）

---

## ❓ 常见问题

**数据存在哪？清缓存会丢吗？**
所有会话和文件袋存在浏览器 IndexedDB。清站点数据会全丢——请定期「导出全部会话」，换设备后「导入并覆盖」。

**上下文用满了怎么办？**
两个办法：手动 `/compact` 让 LLM 把旧对话缩成摘要；或打开自动压缩（真分词器估算超预算 85% 时自动触发）。发送前也会按预算自动截断旧历史并压缩工具结果。

**`fetch_url` 提示 "Failed to fetch"？**
目标站点禁了 CORS。`fetch_url` 会自动尝试 Jina Reader 代理；仍失败就配置自定义 CORS 代理（设置 → 网页抓取）。

**想换模型但不想进设置？**
输入框里直接 `/model gpt-4o`，或用模型选择器下拉（展示所有 provider 分组 + 上拉实时拉取模型列表）。

---

## 🚀 成长日志

自 2026-07-28 立项，188 次提交全记录在 [**CHANGELOG.md**](CHANGELOG.md)——按日期倒序，每条可点击直达 commit：

[![📖 打开完整成长日志](https://img.shields.io/badge/📖_打开_完整_成长日志-CHANGELOG.md-E58F67?style=for-the-badge)](CHANGELOG.md)

> 由 `gen-changelog.mjs` 自动生成：`node gen-changelog.mjs` 随时一键重造。

---

## 📄 许可 & 鸣谢

[MIT](LICENSE)

灵感与致敬：
- [Open Code](https://github.com/sindresorhus/open-code) — 界面与交互灵感
- [Claude Code](https://claude.ai/code) — 交互设计启发
- [One True Awk](https://github.com/onetrueawk/awk)、[quickjs-emscripten](https://github.com/justjake/quickjs-emscripten) — WASM 原生引擎
- **ZCode** — 界面像素级复刻与对话折叠的样板

---

<div align="center">

**这不是 VSCode 或 Cursor 的替代品。**

**它只想在你的 iPad 上，陪你写一会儿代码。** 🚗💨

</div>

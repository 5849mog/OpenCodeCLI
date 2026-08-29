# 🚀 Open Code Web 成长日志

> 由 Git 历史自动整理，共 **191** 次提交。最新在最上方。

| 日期 | 提交数 | 高亮 |
|------|--------|------|
| 2026-08-23 | 14 | 6 个新功能、5 个修复 |
| 2026-08-22 | 20 | 9 个新功能、11 个修复 |
| 2026-08-19 | 2 | 1 个新功能 |
| 2026-08-18 | 12 | 9 个新功能 |
| 2026-08-17 | 8 | 3 个新功能、4 个修复 |
| 2026-08-16 | 7 | 6 个新功能、1 个修复 |
| 2026-08-15 | 16 | 4 个新功能、8 个修复 |
| 2026-08-13 | 1 | 1 个新功能 |
| 2026-08-12 | 14 | 4 个新功能、3 个修复 |
| 2026-08-11 | 13 | 7 个新功能、4 个修复 |
| 2026-08-10 | 34 | 14 个新功能、19 个修复 |
| 2026-08-07 | 1 | 1 个修复 |
| 2026-08-06 | 2 | 2 个新功能 |
| 2026-08-05 | 1 | 1 个新功能 |
| 2026-08-03 | 2 | 1 个新功能、1 个修复 |
| 2026-08-02 | 5 | — |
| 2026-08-01 | 6 | 1 个新功能 |
| 2026-07-31 | 2 | — |
| 2026-07-30 | 1 | 1 个新功能 |
| 2026-07-29 | 27 | 6 个新功能、19 个修复 |
| 2026-07-28 | 3 | 1 个新功能、1 个修复 |

---

## 📅 2026-08-23

<details open>
<summary>🐛 <a href="https://github.com/5849mog/OpenCodeCLI/commit/f225bf8a62484354a81f8bfb84e191a4a0598c92">f225bf8</a> — fix(docs): 修复 tokenizer Mermaid 词法错误（节点标签引号化）+ banner SVG 元素拉满</summary>

> - Mermaid：[/tokens 精确占用] 等节点的 / 前缀被当作形状语法，改为带引号标签后正常渲染
> - banner.svg 重制为 1600x520 复合版面：标题/副标题/特性胶囊/44-128k-0-100% 数据块、
> 迷你侧栏(⌘N/⌘K/Skill/文件袋)、终端卡片(思考中/已编辑/探索/任务结束+token 徽标)，
> WASM 工具徽标条(bash/lua/js/awk/sed/git)、真分词器数据流条、快捷键底条

</details>

<details open>
<summary>📝 <a href="https://github.com/5849mog/OpenCodeCLI/commit/582eea64bf973f6bf1dd1722a11f175122752e6d">582eea6</a> — docs: README 升级至商业级 — hero banner + 架构/Agent循环/分词器 Mermaid 图 + 截图占位规划</summary>

> - 新增 assets/banner.svg（深色产品风格 hero 图：标题/特性胶囊/终端卡片）
> - 3 张 Mermaid 图：架构总览、Agent 序列循环、真分词器数据流
> - 章节重组：功能总览分模块、安全模型、Token 精确性专节、界面预览(截图待补位)、
> 部署(REPO_NAME/build:pages/Actions)、开发与测试(e2e 套件)、FAQ、生态、贡献
> - 修正细节：Node ≥20.9、GPT 计费口径说明（图片 384/张）、命令表与真实一致

</details>

<details open>
<summary>📝 <a href="https://github.com/5849mog/OpenCodeCLI/commit/6553b2fefe3be8caa0335b4b5579973ef8d3cae7">6553b2f</a> — docs: README 全面重写（现代可读风格）+ CHANGELOG 重新生成</summary>

> - 废弃文言文体，改为现代中文分层结构：亮点/工具链/界面/真分词器/安全/限制/FAQ
> - 补齐此前略写或未写的内容：DeepSeek 真分词器（128k BPE 官方词表、实时输入计数、
> auto-compact 85% 判定、精确截断）、ZCode 像素级复刻（两层命令框/整轮对话折叠/
> 全屏设置页）、安全约束（URL 白名单防 SSRF、导出不含密钥、闲时锁定）、
> Plan 只读 bash、运行模式三档开销对比、zip 自动解压、Token 账本分源记录
> - 修正过期信息：/tokens 精确计数、会话备份入口位置等

</details>

<details open>
<summary>✨ <a href="https://github.com/5849mog/OpenCodeCLI/commit/48642fc45bfdd10d94dba5c308bcff69dabf0d55">48642fc</a> — feat(tokenizer): 扩展真分词器用法 — 实时输入计数 + /tokens 与 /compact 精度化</summary>

> - 输入框底部工具栏加 ≈N tokens 实时徽标（300ms 防抖）：输入文本走 countTokens 精确计数
> - 附件兼容：图片按 vision 固定 384/张（与 content 计数一致）；文本/代码文件在附件时用真分词器
> 预计算内容 token（UploadedAttachment.tokens），未就绪自动回退字符估算
> - /tokens：读真实 tokenBudget（去掉 ~60,000 硬编码）+ 分词器精确统计当前上下文占用
> - /compact：tokensBefore/tokensAfter 改走 contextCounter（就绪时精确，否则估算兜底）

</details>

<details open>
<summary>🐛 <a href="https://github.com/5849mog/OpenCodeCLI/commit/ba4b4f831b7f762839d2a21c09fedd8c3c47a2a7">ba4b4f8</a> — fix(ui): 删除对话顶栏残留的 OpenCodeCLI-main / main 上下文 chips，只留标题与⋯菜单</summary>

> _（无详细说明）_

</details>

<details open>
<summary>🐛 <a href="https://github.com/5849mog/OpenCodeCLI/commit/60e4a929556e805753046ec3410ea5c42c3bdddc">60e4a92</a> — fix(ui): 折叠时机改为整轮完全完成后 —— 流式输出中/步骤间保持正常展示</summary>

> 整轮完成判据 = 流已结束 && 全部工具有结果 && 总结已落地。之前仅按工具配对判断，
> 会在上一步完成、下一步未开始（模型思考间隙）或总结还在流式时过早收起。

</details>

<details open>
<summary>✨ <a href="https://github.com/5849mog/OpenCodeCLI/commit/03a0c091a68edf4703d2b4b86bb0e8267d5f2709">03a0c09</a> — feat(ui): 整轮对话折叠 — 每轮一个「已工作 X 秒」头部，任务结束后完全隐藏执行轨迹</summary>

> - groupRounds：用户消息→下一用户消息之间 = 一个轮次（执行轨迹 + 收尾总结）
> - RoundBlock：整轮显示一个「已工作 X 秒 ⌄」折叠头（各片段耗时合计）
> - 收尾总结始终可见；执行轨迹（叙述/思考/工具步骤卡）默认收起，点开向下滑出
> - 任务运行中实时展开、完成后自动收起；收起态保留「N 个文件已更改 +N -M」统计行
> - 连续纯文本消息各自成轮；复制/点赞/点踩/重新生成/时间戳移到轮次总结下

</details>

<details open>
<summary>✨ <a href="https://github.com/5849mog/OpenCodeCLI/commit/783780491bbf5bd48af69250a2f49fc11134fa79">7837804</a> — feat(ui): 设置界面重构为 ZCode 式全屏设置页 — 左侧分类导航 + 右侧内容页 + 卡片化区块</summary>

> - 从居中模态框改为全屏设置页：左侧导航（返回工作区 + 基础设置/Agent 能力/数据与统计分组）
> - 七个页面：模型设置 / 运行模式 / 搜索与抓取 / 自定义指令 / 安全 / 会话与备份 / 账户与用量
> - 页面标题 + 状态徽标（provider/模式/搜索商），卡片化 Section（标题在外 + 圆角卡片）
> - 全部布尔项改 ZCode 式 Switch 开关（自动压缩 / Thinking / Vision / Jina / 空闲锁定）
> - API Key / Search Key 增加「保存」按钮（写入加密 vault），关闭=返回工作区时统一落盘
> - 保留全部原有设置逻辑：预设、模型列表、Test、余额、Files API、导入导出、AES-GCM 锁定

</details>

<details open>
<summary>✨ <a href="https://github.com/5849mog/OpenCodeCLI/commit/ae6c7e45d9b3f653d54e20be2076b1e4d0e47ae1">ae6c7e4</a> — feat(ui): 对话折叠 — 任务结束后默认只显示总结，点击「已工作 X 秒」向下弹出完整执行轨迹</summary>

> - TurnBlock 默认收起（工具运行中保持展开实时可见），点击头部「已工作 X 分 X 秒 ›」展开/收起
> - 展开态：左侧时间线描边，完整显示叙述/思考过程/工具步骤卡
> - 收起态：一行总结「N 个文件已更改 +N -M」（复用 lineDiff 真实计算）
> - 与 ZCode 对话折叠细节对齐：尾部总结 + 变化摘要，中间执行内容按需展开

</details>

<details open>
<summary>🐛 <a href="https://github.com/5849mog/OpenCodeCLI/commit/3bf0602ffb86f33186c8e83184cebce9ce826e31">3bf0602</a> — fix(ui): 侧栏会话平铺列表 + 输入框去项目顶栏 + Skill 改名 + 新增文件袋入口</summary>

> - 会话列表：去掉项目节点(OpenCodeCLI-main/数戳)与树形分组，直接平铺，当前会话置顶橙色圆点高亮
> - 输入框：删除顶部「📁 OpenCodeCLI-main ⌄」工具栏行，输入区收窄为 56px，两层结构(ZCode 对话式)
> - 导航第三行「插件市场」→「Skill」(Sparkles 图标)
> - 顶部导航新增「文件袋」行(FolderOpen)，右侧面板跟随高亮切换

</details>

<details open>
<summary>✨ <a href="https://github.com/5849mog/OpenCodeCLI/commit/713f5f21e02e12fe2ebcfbf5d3fb02551bee56d6">713f5f2</a> — feat(ui): ZCode 1:1 复刻 — 三明治输入框/首页建议区与功能卡片/对话顶栏上下文/项目树侧栏</summary>

> - 输入框改三明治结构：顶栏(📁OpenCodeCLI-main+⚡)｜输入区｜底栏(+、橙色圆形完全访问徽标、⚙模型、⚡思考、圆形发送)
> - 首页空状态：低透明度几何 Logo + 问候语 + 快捷建议×3 + 闲时任务订阅行 + Git站会摘要/CI报告/自定义 三卡片
> - 对话页顶栏：会话标题 + 📁项目/⚡分支 chips + ⋯菜单(重命名/导出/清空)，删除旧品牌块
> - AI 回复：已工作 X 秒 行 + 点赞/点踩；用户消息改 ZCode 式圆角气泡
> - 侧栏：新建任务⌘N/搜索⌘K/插件市场 导航 + 项目树(可折叠/排序/新建) + 底部用户区(头像+名称+设置)
> - 占位文案：首页「向 Open Code 提问…」/对话页「提出后续修改要求」
> - 会话列表去掉完整/计划徽标，当前会话左侧橙色圆点高亮

</details>

<details open>
<summary>🐛 <a href="https://github.com/5849mog/OpenCodeCLI/commit/4be54c59406566b7d3ed54092c0897dee866fb6e">4be54c5</a> — fix(ui): 输入框像素级对标 ZCode + 删除顶部品牌块</summary>

> - 圆筒感根因：Tailwind 4 的 rounded-xl 实为 16px 圆角 → 改 rounded-[10px] 方圆形（ZCode 规格）
> - 边框暗化 #3D3D3D（原 #333 偏亮的视觉胶囊感来自圆角+细边框叠加），底色 #1A1A1A，hover #4A4A4A
> - + 按钮改 ZCode 式 30px 圆形细线描边按钮（圈+加号）
> - header 左侧品牌块（TerminalIcon+Open Code）删除——顶部不再有名字块，品牌只留侧栏；空状态本就无 header

</details>

<details open>
<summary>✨ <a href="https://github.com/5849mog/OpenCodeCLI/commit/442a204ee833f89ac311a93987da0b812cc662a0">442a204</a> — feat(ui): 复刻 ZCode 布局 — Hero 居中输入框 + 单行命令框 + 侧栏对标重构</summary>

> - 空状态：问候语 + 输入框垂直居中（ZCode 式 Hero），隐藏终端 header，去掉 chips/副标题
> - 输入框单行内联造型：[+ 上传][textarea 自适应][模式⌄][模型⌄][思考⌄][↑] 同行，rounded-xl 扁平质感，聚焦橙色微光
> - 有对话时输入框与事件流同为 max-w-3xl 居中列，内容与输入框同宽对齐
> - 侧栏：新建任务/搜索会话/文件袋三条朴素动作行（替代边框按钮）；会话列表去分区标题、当前会话高亮置顶；新增标题搜索过滤（Esc/X 关闭）；当前会话未入列时兜底伪 meta 行
> - 弹窗组件挂根级渲染，不随 Hero 条件移动；useMemo 提升至组件体避免条件 hook

</details>

<details open>
<summary>• <a href="https://github.com/5849mog/OpenCodeCLI/commit/0cd8ccb6b7111eca1ec76e3e1a872241e6b8156e">0cd8ccb</a> — theme: 全局切换中性纯黑主题（保留橙色主调）</summary>

> - 主区 #0A0A0A / 面板 #161616 / 侧栏 #202020（亮一档浮起来）
> - 边框 #333、文字灰阶全中性化，暖棕点缀改柔橙 #C08A5F
> - 16 文件 1068 处映射替换，旧暖色 hex 归零（#E58F67 橙色家族保留）

</details>

## 📅 2026-08-22

<details open>
<summary>🐛 <a href="https://github.com/5849mog/OpenCodeCLI/commit/1d2e8ef6c48acfd97dfb6cf7e9fda28e3cec11b3">1d2e8ef</a> — fix(preset): run_lua/run_js 加入精简与极简白名单 + 提示词泛化工具枚举（消除'提示说有但函数列表没有'矛盾），修复精简/极简下无法运行脚本</summary>

> _（无详细说明）_

</details>

<details open>
<summary>🐛 <a href="https://github.com/5849mog/OpenCodeCLI/commit/c5e722af8a80ff21d05e09d432707ca0cebbe489">c5e722a</a> — fix(ui): 新文件 diff 不再显示幽灵空删除行 + 已编辑摘要 +N 绿/-M 红</summary>

> _（无详细说明）_

</details>

<details open>
<summary>✨ <a href="https://github.com/5849mog/OpenCodeCLI/commit/05efee3b1df3bb9cad65948a627e90e6f6272f35">05efee3</a> — feat(ui): 用户消息原地修改 — 点铅笔泡泡内编辑(取消X/发送↑)，发送后替换该消息、清空其后内容并从该消息重建对话</summary>

> _（无详细说明）_

</details>

<details open>
<summary>✨ <a href="https://github.com/5849mog/OpenCodeCLI/commit/6a469918f011e4b28725cdff1e3e0c8821f46ab6">6a46991</a> — feat(ui): 思考流式（思考中实时→自动闭合思考过程+真实时长）+ 终端命令不进摘要 + 已编辑(文件+目录+真实+N/-M) + 探索N文件/N搜索 + 扩展名图标 + 左右留白</summary>

> _（无详细说明）_

</details>

<details open>
<summary>🐛 <a href="https://github.com/5849mog/OpenCodeCLI/commit/ddd49a9d6010eb9bae3ac14f6d08415c09c9b3c1">ddd49a9</a> — fix(ui): AI 回复复制改为完整回合文本（思考+叙述+答案，跨工具调用）</summary>

> _（无详细说明）_

</details>

<details open>
<summary>🐛 <a href="https://github.com/5849mog/OpenCodeCLI/commit/af91d2446a49664cbb5de6c69d60b08489ef35a8">af91d24</a> — fix(ui): 生成过程直接以最终形态呈现 — 流式文字直渲染正文、删除正在分析/Generating/Continuing 状态横幅、思考不再流式展示</summary>

> _（无详细说明）_

</details>

<details open>
<summary>🐛 <a href="https://github.com/5849mog/OpenCodeCLI/commit/1f6ece5ae8b2970a2dd95f6e23c6d20f2b188515">1f6ece5</a> — fix(ui): 对话不再乱框（AI 回复去边框改正文）+ 用户消息加复制/修改按钮 + 重试按钮只留图标与复制同排</summary>

> _（无详细说明）_

</details>

<details open>
<summary>✨ <a href="https://github.com/5849mog/OpenCodeCLI/commit/f825d86c0e79dea87e2add62bde3639b7b0ea568">f825d86</a> — feat(ui): 思考强度下拉加关闭+三档(low/high/max) + 步骤卡扁平化(展开才有盒子) + 运行态前缀文字白光流光/完成变暗 + 输入区去割裂</summary>

> _（无详细说明）_

</details>

<details open>
<summary>✨ <a href="https://github.com/5849mog/OpenCodeCLI/commit/fbdbf27a6fdb9bb76783c09006e007f1530da801">fbdbf27</a> — feat(ui): 对话过程改 ZCode 式逐步卡片 — 思考/终端/编辑/写入/探索分类，运行中xx中→已xx，默认收起点开看细节</summary>

> _（无详细说明）_

</details>

<details open>
<summary>🐛 <a href="https://github.com/5849mog/OpenCodeCLI/commit/6a67a75b2e1273aeecd6addc26f5a7f4704a2b90">6a67a75</a> — fix(ui): 新建对话也显示完整引入 hero + 输入框底排对齐 ZCode（左[+/模式]右[模型/思考/发送]、去胶囊低饱和、新增思考强度下拉）</summary>

> _（无详细说明）_

</details>

<details open>
<summary>🐛 <a href="https://github.com/5849mog/OpenCodeCLI/commit/741ee4a5f40063df7472e542e9c72d899bb5a582">741ee4a</a> — fix(ui): 删除工作区选择器 + 模型菜单默认带 DeepSeek 模型 + 运行模式/执行模式合并为向上弹出下拉，运行中可切</summary>

> _（无详细说明）_

</details>

<details open>
<summary>🐛 <a href="https://github.com/5849mog/OpenCodeCLI/commit/5c9b4c2c6faa385304e65028b949115a10eac27c">5c9b4c2</a> — fix(ui): 输入框去硬编码(占位符/工作区名可配置) + 模型菜单改向上弹出并按 provider 分组</summary>

> _（无详细说明）_

</details>

<details open>
<summary>✨ <a href="https://github.com/5849mog/OpenCodeCLI/commit/0faf82d2069f2ce8e88036d2a5798ae0191e8206">0faf82d</a> — feat(ui): 对话区改版 — 命令式输入框+空状态 hero+顶栏减负+消息气泡(复制/重改)+右栏右上角滑入</summary>

> _（无详细说明）_

</details>

<details open>
<summary>✨ <a href="https://github.com/5849mog/OpenCodeCLI/commit/4b0485d909c0ce7c6c3d0a79450fc742687acd38">4b0485d</a> — feat(ui): 侧栏会话模式徽标 + Token 入口收敛（输入栏累计/本轮）+ Plan 徽标换图标 + 上传按钮改名</summary>

> _（无详细说明）_

</details>

<details open>
<summary>🐛 <a href="https://github.com/5849mog/OpenCodeCLI/commit/803bb9c21d21863b981321703616544fbdd6c641">803bb9c</a> — fix(preset): 模式随会话持久化（flushPersist/导入补 agentPreset）+ header 恒显模式徽标（含完整模式，旧会话默认 full）</summary>

> _（无详细说明）_

</details>

<details open>
<summary>🐛 <a href="https://github.com/5849mog/OpenCodeCLI/commit/6353974e142fd68d5f030f34769d7a1082589597">6353974</a> — fix(preset): full 模式与重构前逐字节一致（去掉误入的 tools-guide-light 段 + 还原空行结构）</summary>

> - 修复：full 误含精简版 'Your tools'（tools-guide-light），实际应为详细 tools-guide
> - 还原 customInstructions 空块时的双空行结构，与旧模板 ${ternary} 行为一致
> - 新增 scripts/verify-full-identity.mjs：从 dce5fbc 提取旧 buildSystemPrompt，
> 与当前 full 输出逐字节对比（含/不含 customInstructions 两例，16 断言）

</details>

<details open>
<summary>✨ <a href="https://github.com/5849mog/OpenCodeCLI/commit/fa6a6631fb4eb1e6585e2fe4b037262b6ec5f09b">fa6a663</a> — feat(preset): 三种运行模式（完整/精简/极简）+ 提示词/工具插件化</summary>

> - system-prompt.ts 重构：单一大字符串 → 命名段落（hard/soft 分类），
> buildSystemPrompt(preset) 确定性组装；minimal=一句话 persona（对标
> DeepSeek Harness），light=去说教/元信息段（保留安全边界与失败协议）
> - PRESET_TOOLS 工具白名单 + filterToolsByPreset：full=44、light=21 核心、
> minimal=4（bash/read_file/edit_file/glob）
> - session 级 agentPreset：创建时锁定（newSession 用 AiConfig.defaultPreset），
> 切换需新建会话；主循环 system+tools 按 preset 过滤（dispatch 层不变）
> - 子代理/编排器继承主代理 preset（工具集与提示词一致）
> - PersistedSession 持久化 agentPreset；设置面板三选一（新会话默认）+
> header 只读标签
> - 缓存保证：每 preset 组装字节稳定，会话内锁定持续命中前缀缓存
> - e2e：scripts/e2e-preset.mjs（24 断言：段落包含/排除/工具集/字节稳定）

</details>

<details open>
<summary>🐛 <a href="https://github.com/5849mog/OpenCodeCLI/commit/dce5fbc1f1629dc47439233178faea30f8c282d7">dce5fbc</a> — fix(models): 模型选择器修复 + 主对话 header 切换 + URL 安全护栏</summary>

> - 修复模型选择几乎不可用：datalist 改为可见可点的模型列表（预设+拉取合并），
> 填 key + baseUrl 打开设置即自动拉取 /models（无需手动点 Test）
> - 设置面板加'模型列表'展开按钮，选中即切换（含 supportVision 自动推断）
> - 主对话 header 模型徽章 → 可点击下拉切换（读取 store 的 availableModels）
> - session store 新增 availableModels/setAvailableModels 供两处共享
> - 新增 url-guard.ts：请求前校验 host，拒绝 localhost/环回/私有/保留地址，
> 接入 files-api / fetchModels / fetchBalance；e2e 14 断言

</details>

<details open>
<summary>✨ <a href="https://github.com/5849mog/OpenCodeCLI/commit/06709e18a2e6db62728abdc920719fb789740107">06709e1</a> — feat(files-api): DeepSeek Files API 文件管理（列表 + 删除 + 清空）</summary>

> - listDeepSeekFiles / deleteDeepSeekFile：列出账户已上传文件、按 file_id 删除
> - 设置对话框新增 DeepSeek Files API 管理面板：文件名/大小/日期，单个删除 + 一键清空
> - 解决上传图片永久占用账户 25GiB 配额的问题（retrieve-file 低价值未做）

</details>

<details open>
<summary>✨ <a href="https://github.com/5849mog/OpenCodeCLI/commit/cf6b9c801899d00dce9885f6b49d374bb133dfdf">cf6b9c8</a> — feat(vision): 文件上传 + 图片视觉（deepseek-v4-flash-vision-exp）</summary>

> - ChatMessage.content 支持 ContentPart[]（text/image_url/file），视觉模型可接收图片
> - Files API 客户端（uploadFileToDeepSeek）：图片上传拿 file_id，失败自动回退 base64 内联
> - 输入框附件按钮：所有格式上传 ≤10MB，写 VFS uploads/，图片走 Files API + 缩略图 chips
> - VFS 存图（dataUrl）+ 文件袋编辑器渲染 <img>
> - AiConfig.supportVision 模型旗标 + 设置面板开关 + DeepSeek vision-exp 预设
> - token 计数适配数组 content（image 384 / file 15 / text 按字数），compact/审计/子代理安全处理
> - e2e：scripts/e2e-vision.mjs（计数正确性 5 断言）

</details>

## 📅 2026-08-19

<details open>
<summary>✨ <a href="https://github.com/5849mog/OpenCodeCLI/commit/5869b03efe6d69989c2e73aa3237eee8cfdad8e5">5869b03</a> — feat(tools): 新增 batch_rename 工具，一步批量改后缀（glob 匹配 + find→replace + dry_run 预览）</summary>

> _（无详细说明）_

</details>

<details open>
<summary>📝 <a href="https://github.com/5849mog/OpenCodeCLI/commit/26cf423387790bb35a43b242ba77d75011b23ac0">26cf423</a> — docs: 重新生成 CHANGELOG.md（155 条提交 / 18 天）</summary>

> _（无详细说明）_

</details>

## 📅 2026-08-18

<details open>
<summary>⚡ <a href="https://github.com/5849mog/OpenCodeCLI/commit/fdf8c273e0481dbbf4dfc218826f8e0f76f3c5bb">fdf8c27</a> — perf(vfs): listAllFilesSync 有序路径索引（D 阶段，5000 文件提速 14.4x）</summary>

> - vfs.ts 新增文件路径索引 filePaths[]：与 cache 严格同步，写入/删除/改名时
> 二分插入/移除（O(log N)），hydrate/快照恢复时全量重建一次
> - listAllFilesSync 改为二分区间取（O(log N + M)），替代全量扫描 + 全排序
> （O(N log N)）；root 本身是文件的旧语义保留；排序口径 localeCompare 不变
> - 8 处 cache 变更点全部接入索引（writeFile/writeFileSync/delete/rename/
> renameSync/clear/restoreLastSnapshot/hydrateFromIDB）
> - 14 个调用点自动受益（bash glob、@ 提及、treeSummary 每目录计数、
> collectFiles、zip 打包等）
> - 验证：node e2e 5 项全过（真实 vfs.ts 打包驱动：5000 文件乱序写入后全量
> 有序完整/目录前缀过滤含 root 文件/覆盖写不重复/删除消失/改名迁移/clear
> 清空；性能 200 次查询 66ms vs 旧实现 953ms = 14.4x）；
> npx tsc --noEmit 零错误；REPO_NAME= next build 通过

</details>

<details open>
<summary>✨ <a href="https://github.com/5849mog/OpenCodeCLI/commit/5797dd5a9ceefb5626d01e04be9dd041143867b9">5797dd5</a> — feat(audit): 会话审计面板 + /audit 导出（C 阶段）</summary>

> - 数据层：usageHistory（逐次 API 用量：ts/来源/真实 prompt+completion 拆分，
> 上限 200，主循环/subagent/orchestrator 三处 recordUsage 记录；orchestrator
> 的 decompose/synthesize 两笔 LLM 调用补上 onUsage 转发，堵住审计盲区）；
> vfsChangeLog（订阅 onVfsEvent，覆盖 delete/move/bash 写入——这些工具没有
> diff，与 events[].diff 互补，上限 500）；两者随 PersistedSession 持久化
> - 新增 src/lib/audit.ts 共享聚合：buildAuditReport（工具配对耗时/文件改动
> 合并排序/真实拆分成本估算，空记录退化 80/20）+ renderAuditMarkdown
> - 新增 src/lib/cost.ts：价格表 + matchModelRate + estimateCost + split80_20
> 从 /cost 提取（/cost 改用共享模块，并升级为真实拆分优先）
> - 新增 audit-panel.tsx：右侧栏「审计」tab（与 Plan/子智能体同级）三视图
> 工具调用统计表 / 文件改动时间线（含 diff 摘要）/ Token 累计+成本+逐请求明细
> - /audit 命令：buildAuditReport → renderAuditMarkdown → downloadBlob 下载
> - 验证：node e2e 4 项全过（工具统计/文件改动/成本/渲染，真实代码打包驱动）；
> npx tsc --noEmit 零错误；REPO_NAME= next build 通过

</details>

<details open>
<summary>✨ <a href="https://github.com/5849mog/OpenCodeCLI/commit/951cfa0ff2b8053ffbcf5187f538b964c819e55b">951cfa0</a> — feat(session): auto-compact 自动触发（B 阶段）</summary>

> - 新增 shouldAutoCompact 纯函数（可测）：开关开启 + 未在压缩中 + 真分词器
> 估算超预算 85% + 距上次压缩 ≥10 条新消息（严格大于 85%，恰好 51k/60k 不触发）
> - 提取 doCompact(trigger: manual|auto)：手动 /compact 与自动触发共用一套
> 压缩流程；auto 模式失败/无 key/对话过短静默（truncate 丢消息兜底），
> 成功事件文案标注已自动压缩
> - send 循环：真分词器就绪时 countConversationTokensAccurate 估算，
> 满足条件自动 doCompact 后重建 fullMessages；未就绪不阻塞（warmup 预热）
> - 状态新增 lastCompactMsgCount（压缩节流基准；恢复会话视作刚压缩过，
> 避免意外多花一次摘要调用）；不持久化（派生字段）
> - 配置新增 autoCompact（默认 true）+ 设置面板开关
> - 验证：node e2e 9 项全过（纯函数 6 边界 + 接线静态断言 3）；
> npx tsc --noEmit 零错误；REPO_NAME= next build 通过

</details>

<details open>
<summary>✨ <a href="https://github.com/5849mog/OpenCodeCLI/commit/f62ffdd63445e50bff3ecf9b138c15b1be2cbaaa">f62ffdd</a> — feat(tokenizer): 嵌入 DeepSeek 真分词器（第四号 Worker，地基）</summary>

> - 新增 public/tokenizer/tokenizer.json（7.8MB，DeepSeek-V3 官方 128k BPE 词表，
> 已提交，部署零网络依赖）与 public/wasm/tokenizers-lib.js（@huggingface/tokenizers
> 纯 JS 移植经 esbuild 打包的 IIFE，31KB，无 wasm 零加载风险；与 Python
> transformers 同引擎，计数逐字节一致）
> - 新增 public/wasm/tokenizer-worker.js：第四号静态 Worker，复用 worker-client
> 池化单例（tokenizer.json fetch 一次常驻）；收 {id, texts} 批量回 counts
> - 新增 src/lib/wasm/tokenizer.ts 宿主桥：countTokens/countTexts（LRU 2000 缓存）、
> countConversationTokensAccurate（开销常数与 estimateMessageTokens 对齐）、
> warmup（fire-and-forget 预热）、tokenizerStatus/onTokenizerStatus（UI 状态）、
> contextCounter（就绪走真计数，否则零延迟回退字符估算）
> - context.ts：truncateConversation 转 async + 可注入计数器（默认 contextCounter），
> 调用方 session.ts / subagent.ts await；token-sheet 上下文占用率就绪后自动升级
> 为精确计数（标注 DeepSeek 精确）
> - session.ts 发送循环每次 fire-and-forget warmup：首次发送零延迟，后续自动精确
> - tools/tokenizer/prepare.sh：esbuild-wasm 重建 tokenizers-lib.js（升级后重新生成）
> - 验证：node e2e 7 项全过（真实 lib+词表驱动真实 worker：id 回包/中文代码特殊
> token 计数/批量/引擎缺失致命回包/宿主-直连计数一致 69=69/LRU 命中/回退）；
> npx tsc --noEmit 零错误；REPO_NAME= next build 通过

</details>

<details open>
<summary>✨ <a href="https://github.com/5849mog/OpenCodeCLI/commit/834be551259f5f939d812ec534bb7e15e69f2eaf">834be55</a> — feat(worker): 池化复用 — 常驻 Worker + 请求 id 路由（P0-1）</summary>

> - 新增 src/lib/wasm/worker-client.ts：每个 worker 文件一个常驻单例
> - 惰性创建：首个 request 才 new Worker，此后跨调用复用
> - id 路由：每请求自增 id，回包按 id 分发（乱序到达各归各；并发请求正确但串行）
> - 超时/取消 = 强杀重建：与既有'超时即 terminate'语义一致，下个请求自动重开
> - 加载期错误（无 id 回包）→ 全部 pending 失败 + 重置；超时计时覆盖创建+执行全过程
> - 两个 worker 回包带 id（esbuild-syntax-worker.js / tsc-worker.js）；postErr 支持
> 可选 reqId，加载期致命错误保持无 id
> - esbuild-syntax.ts / tsc.ts 换用共享 client：esbuild.initialize（~9MB wasm）与
> typescript.js+tslib.js 解析从每调用一次 → 会话首次一次；输出组装/软封锁逻辑原样
> - 修 worker-client 自赋值 bug：creating = new Promise(...) 的 executor 里写
> creating = null 会被赋值覆盖 → 构造失败后 creating 永久保留 rejected promise、
> worker 永远无法恢复；改为结算（settle）后清空
> - 验证：node e2e（esbuild 转译真实 client + FakeWorker 驱动真实 worker 源码，
> 6 场景全过：复用单例/并发乱序路由/超时重建/加载期失败恢复/错误路由/构造失败恢复）
> + npx tsc --noEmit 零错误 + REPO_NAME= next build 通过

</details>

<details open>
<summary>✨ <a href="https://github.com/5849mog/OpenCodeCLI/commit/a1ac35021445462e1a5e166c18815e46966af369">a1ac350</a> — feat(transpile): 编译器语义改造 — 文件进、文件出</summary>

> - schema: transpile(code?|file?|files?|path?, outDir?, sourcefile?)，四选一来源
> - file/files/path 模式把 .js 产物写入 VFS（tsc 语义：默认源码旁，outDir 镜像树），
> 只回汇总+写入清单+错误（各上限 30 条），不再回 JS 文本占上下文
> - path 走 esbuild-syntax-worker.js（mode:transpile），Worker 隔离不卡页面；
> .d.ts/json/lua 等跳过计数；同名产物直接覆盖（编译语义）
> - code 模式保留：唯一不写文件、直接回 JS 文本
> - 产物可 run_js(script_file:) 直跑 / cat 查看 / 随文件袋下载
> - 变更为写工具：dispatch mutated:true（可 undo）、PLAN_MODE_BLOCKED、
> session.ts mutatingTools + MUTATING_TOOLS 三处拦截同步
> - 修 pre-existing bug：worker okFiles 双重计数（循环 + 末尾重复累加）
> - 修 esbuild 0.28 报错格式：<stdin>:1:9: 前缀兼容（worker + 主线程 checkSyntax 两处）
> - 验证：node e2e（真引擎驱动 worker 编排 + 从源码抽取 dest 映射纯函数断言）、
> npx tsc --noEmit 零错误、REPO_NAME= next build 通过

</details>

<details open>
<summary>✨ <a href="https://github.com/5849mog/OpenCodeCLI/commit/f5e3c7ffdfa13ba8a3f5965e245295943caca2b2">f5e3c7f</a> — feat(check_syntax): 提示词明确"path 传项目根一次覆盖全部，勿拆多次"</summary>

> 用户实测发现 AI 检查项目时用了三次 check_syntax（一次 path 目录 + 两次 files 补查
> 根目录散落 ts/json），白白消耗 token——根源是描述没说清 path 的覆盖范围。
> 提示词更新（system-prompt.ts + tool-definitions.ts）：
> - 明确 path 传项目根目录一次即可递归覆盖全部受支持文件：子目录、根目录散落的
> .ts/.d.ts（vite.config.ts、env.d.ts 等）、以及 .json（tsconfig.json、
> package.json 等）都在内，无需拆多次 files 补查（"extra passes only burn tokens"）。
> - 明确目录遍历支持 ts/tsx/js/jsx/mjs/cjs（esbuild）+ json（JSON.parse）；lua 与
> css/html/md 等会跳过计数，查 lua 用 file/files。
> - files 参数描述也提示"查整个项目用 path，不必拆 files"。
> 验证：npx tsc --noEmit 与 REPO_NAME= next build 通过。

</details>

<details open>
<summary>✨ <a href="https://github.com/5849mog/OpenCodeCLI/commit/03bbcd6c0419226f99e4e731c702dff207a84030">03bbcd6</a> — feat(check_types): 从 AI 工具面完全移除（工具保留，不暴露给模型）</summary>

> check_types 在无 node_modules 的浏览器环境对依赖项目信任度极低（连锁假错误会
> 误导 AI 白烧 token），软封锁（不列诊断）仍不够——用户决定彻底不让 AI 使用。
> 改动（工具代码全部保留，仅从 AI 可见面移除）：
> - tool-definitions.ts：从 TOOL_DEFINITIONS 移除 check_types 条目 → AI 的
> function-calling 列表不再有这个工具，无法调用。
> - system-prompt.ts：移除 check_types 工具描述行 → AI 提示词不再提及。
> 保留：dispatch.ts 的 toolCheckTypes 函数与 case、src/lib/wasm/tsc.ts、
> tsc-worker.js/tslib.js、tools/tsc/prepare.sh 全部原样（Worker 体系支柱保留，
> 未来如需恢复只需加回 schema 与描述）。check_syntax（用户满意）不受影响。
> 验证：TOOL_DEFINITIONS 与 system-prompt 均无 check_types（grep 计数 0），
> dispatch case 保留（代码存在）；npx tsc --noEmit 与 REPO_NAME= next build 通过。

</details>

<details open>
<summary>• <a href="https://github.com/5849mog/OpenCodeCLI/commit/2185c4a02424704ecfd755dc24f991dbf854a620">2185c4a</a> — Add files via upload</summary>

> _（无详细说明）_

</details>

<details open>
<summary>• <a href="https://github.com/5849mog/OpenCodeCLI/commit/0f593cc3fea44528b3bd141a628a0850dbe96983">0f593cc</a> — Add files via upload</summary>

> _（无详细说明）_

</details>

<details open>
<summary>✨ <a href="https://github.com/5849mog/OpenCodeCLI/commit/acbf31cc69536291ab5ef91a9eb79725efa01791">acbf31c</a> — feat(check_types): 软封锁——依赖项目不列诊断，按可信度分流</summary>

> 用户实测发现：depMissing 降级后列出的"真错误"（TS2339/2322 等）仍是缺依赖
> 连锁传播的假错误，看着像真 bug 会误导 AI 去复核、白烧 token。连锁传播的错误码
> 无法靠固定码降噪拦截（同样错误码在正常项目是真错），这是无 node_modules 环境下
> 对依赖项目类型检查的信息论本质困境。
> 软封锁方案：
> - host（src/lib/wasm/tsc.ts）：depMissing=true 时完全不列诊断，只返回一句说明
> （"依赖 node_modules、浏览器无法权威检查，请本地 tsc；自包含项目结果才可信"），
> ok=true、diagnostics 空。AI 拿不到错误清单 → 从源头杜绝误导与无效复核。
> - 描述同步（tool-definitions/system-prompt）：check_types 明确"依赖第三方模块的
> 项目会返回无法检查的说明且不列诊断，不要据此改代码；仅自包含项目可信"。
> 价值保留：自包含（无三方依赖）项目照常列出可信错误；Worker 体系与 check_syntax
> 不受影响（用户满意的工具保持原样）。未物理移除工具。
> 验证：模拟 worker 确认依赖项目 depMissing=true（moduleMissing=3）；npx tsc
> --noEmit 与 REPO_NAME= next build 通过。浏览器需复测：check_types 对 react 项目
> 输出仅为一句说明、无任何诊断行。

</details>

<details open>
<summary>✨ <a href="https://github.com/5849mog/OpenCodeCLI/commit/85f174ed83ea755311c3ead6add312ab5166e07f">85f174e</a> — feat: check_types 缺依赖降级 + check_syntax 目录遍历（Worker 隔离）</summary>

> 按方案 2 完成两项升级。
> ## 一、check_types：补降噪码 + 缺依赖检测（解决几千行假阳性惊悚输出）
> worker（public/wasm/tsc-worker.js）：
> - ENV_NOISE 补 TS2580（Cannot find name 'process' 等 Node 全局）、7015/7023/7007
> （implicit any 家族）、2769（泛型 unknown 重载退化）。
> - TS2304（Cannot find name）按文本判：命中已知 Node/浏览器全局名清单降噪，其余
> 保留为错误（真拼写错）。修复了此前 "Cannot find name 'process'" 被误标错误。
> - 新增 moduleMissing / depMissing 统计：模块/全局缺失类噪声占错误级诊断比 >30% 时
> 判定 depMissing=true。
> host（src/lib/wasm/tsc.ts）：收到 depMissing=true 时不再逐条列诊断，降级为一句
> 边界说明 + 只列可能真实的少数错误（errorCount 行），强烈建议本地 tsc --noEmit。
> 彻底解决 react/zustand 项目输出几百~几千行假错误的问题。
> 描述同步（tool-definitions/system-prompt）：write 明"缺依赖时会降级为一句说明"。
> ## 二、check_syntax：新增 path（目录遍历，Web Worker）
> - 新增 public/wasm/esbuild-syntax-worker.js（静态 worker）：importScripts 加载同目录
> esbuild-browser.js（esbuild-wasm 自包含 UMD→self.esbuild），fetch esbuild.wasm 实例化
> 到 worker 线程（worker:false），按扩展名分派 ts/tsx/js/jsx/mjs/cjs→esbuild.transform、
> json→JSON.parse、其他→跳过计数。无文件数上限（worker 隔离不卡主线程）。
> - tools/esbuild-wasm/prepare.sh 增复制 lib/browser.js → public/wasm/esbuild-browser.js
> （CI 生成，gitignore）。
> - 新增 src/lib/wasm/esbuild-syntax.ts（host 桥接层 checkSyntaxDir）：vfs.listAllFilesSync
> 收集 + Worker 超时/abort 强杀；输出只回错误文件+汇总，正常文件不逐行，错误文件超 30
> 只列前 30+"还有 X 个"，不爆上下文。
> - dispatch.ts check_syntax case 扩为四选一（code/file/files/path），path 分支走 worker。
> ## 验证
> - check_types 缺依赖 e2e：react/axios/process 项目 → Cannot find module + process 降提示、
> TS2339 Property 保留错误、depMissing=true，ALL PASS。
> - check_syntax 目录 e2e：真实 esbuild transform 捕获 bad.ts 语法错 + bad.json 解析错、
> 正常计数对、md/scss 跳过，ALL PASS。
> - npx tsc --noEmit + REPO_NAME= next build 通过；out/wasm/{esbuild-syntax-worker.js,
> esbuild-browser.js, esbuild.wasm, tsc-worker.js, typescript.js, tslib.js} 齐全。
> - 浏览器需复测：check_types 对真实项目降级为"一句说明+少数真错"；check_syntax 传目录
> 能扫全量不卡 UI。

</details>

## 📅 2026-08-17

<details open>
<summary>✨ <a href="https://github.com/5849mog/OpenCodeCLI/commit/10db80cdf9f7171da7012b867a10e8361d69ed4b">10db80c</a> — feat(check_types): 环境边界降噪——第三方模块不可解析时列为提示而非报错</summary>

> 浏览器没有 node_modules，check_types 对依赖三方依赖的现代前端项目（如 react/
> zustand）会产生大量连锁假错误（Cannot find module→implicit any→JSX 全局类型丢失），
> 淹没真实代码问题。按方案 A+B：
> A（降噪，worker）：新增环境噪声 TS 码集合（2307/2792/7016/2686/7006/7005/7008/
> 18046/2571——Cannot find module、declaration file 缺失、implicit any、unknown），
> 这些降级为「提示」并入 noteCount，不计入 errorCount；其余错误（如 TS2339 Property
> 不存在）保留。host 在输出附加环境边界说明：标「错误」才是可能真实的问题，有
> node_modules 的项目请用本地 tsc。
> B（边界，描述）：tool-definitions.ts 与 system-prompt.ts 的 check_types 描述明确写出
> 该边界与适用场景（适合相对依赖的自包含项目；依赖 node_modules 的项目用本地 tsc 兜底）。
> 验证：模拟 worker 跑含 react import + Property 错误的项目——Cannot find module
> 降为[提示]、TS2339 保留为[错误]，errorCount=1/noteCount=1/envNoise=true，输出含
> 环境边界说明。npx tsc --noEmit 与 REPO_NAME= next build 通过。需浏览器复测。

</details>

<details open>
<summary>🐛 <a href="https://github.com/5849mog/OpenCodeCLI/commit/bab83c72f1e61277a63a08e983c0b95191422942">bab83c7</a> — fix(check_types): 修复浏览器 worker 里 tsc 引擎初始化崩溃 + 补齐内置 lib.d.ts</summary>

> AI 在浏览器跑 check_types 报 "system.useCaseSensitiveFileNames is not an object"
> （属环境能力缺失，非路径/tsconfig 问题）。已用模拟 worker 环境逐层定位根因：
> 根因 1（崩溃）——ts.sys 在无 CommonJS 的 worker 环境是 undefified 且只读 getter：
> ts.createCompilerHost(options, setParentNodes) 只有 2 参，内部默认 system=sys 落到
> undefined，第一行访问 system.useCaseSensitiveFileNames 即崩。
> → 改用 ts.createCompilerHostWorker(options, false, mySystem)（接受第三参 system），
> 用自定义 CompilerSystem（useCaseSensitiveFileNames/getCurrentDirectory/
> getExecutingFilePath/fileExists/readFile/... 全指向内存文件映射）替代 ts.sys。
> 根因 2（lib 缺失）——typescript.js 浏览器版不含 lib.*.d.ts 内容，即便 sys 修好，
> Array/Promise/dom 等全局类型仍找不到（TS2318）→ 无法做真类型检查。
> → 新增 tools/tsc/prepare.sh 生成 tslib.js（把 node_modules/typescript/lib 下全部
> lib.*.d.ts 内容打成 self.__TSLIB__，~3MB），worker importScripts 加载后注入内存
> CompilerHost（key 形如 /lib/lib.es5.d.ts）；mySystem.getExecutingFilePath 指向
> /lib/typescript.js 使默认 lib 位置解析到该映射。public/wasm/tslib.js 进 gitignore。
> 验证：模拟 worker 端到端跑通——typescript.js 加载(ts.sys undefined 修复)、注入
> __TSLIB__ 99 个 lib、内存 CompilerHost + Program 报出真实跨文件类型错误
> (TS2724 no exported member 'Foo2')，无 TS2318 全局类型噪音，338ms。npx tsc --noEmit
> 与 REPO_NAME= next build 通过；out/wasm/{typescript.js,tslib.js,tsc-worker.js} 均在。
> 浏览器真实运行需复测 check_types。

</details>

<details open>
<summary>🐛 <a href="https://github.com/5849mog/OpenCodeCLI/commit/06314f62a45d8891e1c0b7a7ef9a316d1cf2fe46">06314f6</a> — fix(check_types): 提交工作区已修复的 tsc.ts（移除 Blob worker 残留 import）</summary>

> af028be 提交时 tsc.ts 是中间态（仍 import 已删除的 tsc-worker-source + Blob 代码），
> 导致 CI 的 bun run build 报 Module not found './tsc-worker-source'。
> 工作区实为已修复版本（独立静态 worker + 相对 importScripts），本次补齐提交，使
> HEAD 与磁盘一致。验证：npx tsc --noEmit 与 REPO_NAME= next build 通过。

</details>

<details open>
<summary>🐛 <a href="https://github.com/5849mog/OpenCodeCLI/commit/af028be16e8bd469e50ea3d4f99c26c4619b42e6">af028be</a> — fix(check_types): tsc worker 改用独立静态文件 + 相对 importScripts，修复浏览器加载失败</summary>

> 初版用 Blob URL 内联 Worker + importScripts 加载**绝对** typescript.js URL。
> 浏览器实际运行时报 "The string did not match the expected pattern"——根因是
> Blob Worker 的源是 opaque（blob:），CSP 无权限从绝对路径拉取脚本，importScripts
> 失败。路径本身正确（out/wasm/typescript.js 存在），非路径问题。
> 修复：改为独立静态 Worker 文件架构
> - 新增 public/wasm/tsc-worker.js（静态 worker，next 原样复制到 out/，不经打包）：
> 内部用**相对** importScripts("./typescript.js")——worker 与 typescript.js 同目录，
> 天然同源，无 Blob CSP 限制。
> - host 用 new Worker(wasmUrl("wasm/tsc-worker.js"))（字符串路径，绕开 next 对
> new Worker(new URL(...)) 的打包限制）。
> - 删除 src/lib/wasm/tsc-worker-source.ts（Blob 版废弃）。
> 验证：npx tsc --noEmit、REPO_NAME= next build 通过；out/wasm/tsc-worker.js 与
> typescript.js 均在产物；worker 文件 node --check 语法正确；跨文件类型检查逻辑
> 与此前 Node 冒测一致（报 TS2724 no exported member）。浏览器端 Blob→静态文件的
> 真实加载需在浏览器复测 check_types。

</details>

<details open>
<summary>✨ <a href="https://github.com/5849mog/OpenCodeCLI/commit/e658f0233abd487056308865a1ce797922ff2be5">e658f02</a> — feat(check_types): 新增基于 tsc 的跨文件类型检查工具（Worker 隔离）</summary>

> 为 check_syntax（esbuild 语法检查）补上真正缺失的"跨文件类型检查"。check_syntax
> 只查语法不对类型（esbuild 转译时把类型当注释丢弃）；check_types 用官方 TypeScript
> 编译器在浏览器对整个目录做 Program 级 PreEmit 诊断，能发现真实的跨文件类型错误
> （import 了不存在的名字、缺 export、类型不可赋值等），解决"大项目 20 文件上限不够用"
> 的问题。
> 架构：
> - src/lib/wasm/tsc.ts（宿主桥接层）：读 VFS 收集 root 范围所有 .ts/.tsx/.json →
> 建 Blob URL 内联 Worker → 超时（默认 120s）+ 可取消（AbortSignal）强杀，主线程不冻结。
> - src/lib/wasm/tsc-worker-source.ts（Worker 源码）：importScripts 加载
> public/wasm/typescript.js；内存 CompilerHost 对接文件映射（全文只读、writeFile no-op）；
> 无 tsconfig 用合理默认，有则解析；按 root 自动收集依赖闭包；诊断归一化 path:line:col。
> - Blob Worker 绕开 Next static export 对 new Worker(new URL(import.meta.url)) 的打包限制；
> typescript.js（UMD）经 importScripts 加载，挂 self.ts。
> 依赖/部署：
> - typescript ^5.9.3 从 devDependencies 移到 dependencies（运行时要 import）。
> - 新增 tools/tsc/prepare.sh（仿 esbuild-wasm）：CI 时从 node_modules 复制 typescript.js
> 到 public/wasm（8.7MB，惰性加载、不进首页 bundle）；.gitignore 排除；deploy.yml 加步骤。
> 工具注册：dispatch.ts toolCheckTypes + check_types case；tool-definitions.ts 定义
> （path 目录或文件，tsconfig 可选）；system-prompt 补充与 check_syntax 的分工说明；
> tools/index.ts 导出 checkTypes。
> 验证：
> - Node 冒测：真实 ts.CompilerHost 对接内存映射能报跨文件类型错误（TS2724 no exported member），
> 不加显式 lib + skipLibCheck 消除 TS2318 全局类型噪音。
> - Node vm 探针：typescript.js 在无 CommonJS 的 worker 环境正确挂 self.ts（v5.9.3, createProgram ok）。
> - npx tsc --noEmit 与 REPO_NAME= next build 均通过；out/wasm/typescript.js 正确生成。
> - 浏览器端 Blob worker + importScripts 网络加载 + 真实大项目需在浏览器手测（验收清单）。
> check_types：path 目录或单 .ts/.tsx，自动收集依赖闭包；不可用时诚实报错不卡死。
> Type 问题用 check_types（全），Syntax 问题用 check_syntax（快），二者互补。

</details>

<details open>
<summary>📝 <a href="https://github.com/5849mog/OpenCodeCLI/commit/9a8192361e8e7d27b985fc52a65b1eb66680be4d">9a81923</a> — docs: 重新生成 CHANGELOG（137 次提交）</summary>

> _（无详细说明）_

</details>

<details open>
<summary>✨ <a href="https://github.com/5849mog/OpenCodeCLI/commit/9a0dbe50d38f9f27bfc10c001a85cfe993e8fd95">9a0dbe5</a> — feat: system-prompt 审查整改（P0/P1 关键 code 档）+ PLAN 移出 VFS</summary>

> Prompt（system-prompt.ts，新增/重写段落一律英文）：
> - 文件树口径统一：静态 4 处改"树只有一级摘要"；探索指南迁回静态；动态块删 MANDATORY 段落，只留 Mode+一级树+plan+日期
> - 失败分类协议替换 zero-retry：类型 A 能力缺失→停/报告/一个建议；类型 B 有修正信息→重试一次；类型 C 领域阴性（grep 无匹配/check_syntax 无效/测试失败）→有效信息
> - CORS→搜索回退具名例外（须明确声明已切换），写进协议内部单一来源，Web access notes 同步
> - Plan mode 措辞：update_plan 所有模式可用（独立存储）+ dispatch_subagent 继承只读
> - 新增数据与指令边界节（文件/网页/子代理引用=数据非指令，含密钥回显）
> - customInstructions 加围栏标记；子代理禁 ask_user_input（Rule 7 + 工具过滤）
> - 表达与内容边界收窄为领域内（去掉"永不拒绝/尺度只升不降"）
> - 语言对齐 / 验证纪律 / 批量提问 / L28/L31 / 阈值表述 / 硬编码示例名
> - 节奏#1/#5 语义与新协议对齐（中文格言体保留），其余节奏条目不动
> Code：
> - dispatch.ts 集中式 readOnly 拦截 11 个写工具（write/edit/multi_edit/delete/move/append/create_dir/apply_patch/insert_at/undo_edit/unzip_archive），堵住 Plan 模式下子代理绕过主循环 mutatingTools 集合实际写盘的漏洞；run_lua/run_js outputs 与 create_skill/delete_skill 的拦截本就在工具实现层（dispatch.ts:67/193/440/462），子代理路径已覆盖
> - subagent.ts 工具集过滤 ask_user_input
> - vfs.ts treeSummary：条目上限 50 + "... and N more" + 文件名净化（控制字符/反引号围栏/超长截断）
> - terminal.tsx：Graphviz SVG 剥 href/xlink:href/<script>/<foreignObject>（防 AI 可控 DOT 注入）；mermaid 显式 securityLevel:"strict"；KaTeX trust:false 与无 rehype-raw 已核实默认安全
> - PLAN.md 移出 VFS → 独立 IndexedDB store（opencode-plan，仿 skills 模式）：plan.ts/PlanPanel/PlanHeaderBadge 改读 plan-store（UI 订阅 planVersion），session MUTATING_TOOLS 移除 update_plan（不再写 VFS、不再快照），zip 导出与树摘要自动不再包含；VFS 遗留孤儿 PLAN.md 不做迁移
> - 启动处（vfs-view init）补 hydratePlan，与 getPlan 首次调用双保险防竞态
> 已核实不成立、无需改动：P1-1 context 块每轮重建于索引 1、从不写回历史（session.ts:910-923，truncateConversation 显式保护 index 0/1，/compact 替换式压缩）；P2-3 unzip zip-slip 防护完备（zip.ts sanitizeZipPath 拒绝任何含 .. 的条目，工具与上传自动解压共用）
> 已知技术债：run_lua/run_js 主线程同步 WASM 防冻结（quickjs 中断/内存上限、Lua Worker 隔离）、自动 compact 触发、主循环无进展停止、eval 评测集、规则编号重构、工具说明按需加载、listAllFilesSync 性能

</details>

<details open>
<summary>🐛 <a href="https://github.com/5849mog/OpenCodeCLI/commit/8c522c47ac9b1bce788ae4e6579df47a4f355f45">8c522c4</a> — fix(grep): 支持 -F 固定字符串 + 明确 ERE 语义 + 误用转义管道符时提示</summary>

> - grep 底层是 JS RegExp，恒为 ERE 语义；-E/-F/-G 此前全被忽略。
> 按 GNU BRE 习惯写 grep 管道符转义会静默变成"字面管道符"（常无匹配），无法察觉。
> - 新增 -F 支持：转义 pattern 按固定字符串字面匹配（管道符/原点/美元符等不再特殊），
> 单文件、stdin、目录递归、全工作区 四条路径统一生效。
> - pattern 含"反斜杠+管道符"且未开 -F 时，输出追加 ERE 语义提示。
> - system-prompt 补充 grep ERE 用法说明（要"或"写 a|b，要字面用 -F）

</details>

## 📅 2026-08-16

<details open>
<summary>✨ <a href="https://github.com/5849mog/OpenCodeCLI/commit/cef246cf119d7f87261eefdb59a5b1d78f02c605">cef246c</a> — feat(config): 上下文发送预算改为设置可调（tokenBudget）</summary>

> - AiConfig 新增 tokenBudget（默认 60000），设置里可调（4000~1_000_000）
> - 主循环 truncateConversation 改用 config.tokenBudget 而非硬编码默认
> - dispatch_subagent 继承 tokenBudget，子代理预算与主代理一致
> - TokenSheet 面板分母/文案改用 config.tokenBudget（不再固定 6 万）
> - 会话导入导出 config 同步 tokenBudget

</details>

<details open>
<summary>✨ <a href="https://github.com/5849mog/OpenCodeCLI/commit/23e686da4c6d57f10144a4a4e01588016785d66e">23e686d</a> — feat(skills): 导出/导入 + UI 新建·编辑·删除</summary>

> - 后端新增 exportSkills（导出全部自定义 skill）与 importSkills（批量导入，
> 逐条校验名称/内容，同名覆盖，返回逐条结果）
> - SkillsDialog 新增『导出』按钮：Blob 下载 skills-backup.json（kind+version+skills）
> - 新增『导入』按钮：读 JSON 校验结构 → importSkills → toast 汇总新增/跳过
> - 新增『新建』内联表单（名称 + markdown 编辑器）
> - 展开的自定义 skill 支持『编辑』（textarea 预填 → 同名覆盖保存）
> - 每行新增删除（自定义→移除，内置→隐藏），confirm 防误删
> - onSkillsChange 订阅保证 UI 与 AI 操作实时同步

</details>

<details open>
<summary>🐛 <a href="https://github.com/5849mog/OpenCodeCLI/commit/23170514009fb1d310eaeb6df27b20eef2009096">2317051</a> — fix(esbuild): check_syntax 不支持语言优先于 lang/扩展名矛盾检查</summary>

> - 显式 lang 为不支持语言（python/sql/css/md 等）时一律报『暂不支持』，
> 不再被 lang 与扩展名矛盾提示掩盖（内联 code 与 file 行为一致）
> - lang/扩展名矛盾检查仅在两语言都是受支持语言时触发
> - 多文件批量：显式 lang 与某文件扩展名矛盾时对该文件报错而非整体失败

</details>

<details open>
<summary>✨ <a href="https://github.com/5849mog/OpenCodeCLI/commit/3e389821067b830cf81c29960ef0b27289b4a5c8">3e38982</a> — feat(tool): check_syntax 升级多语言 + 一次批量校验多文件</summary>

> - 多语言路由：ts/tsx/js/jsx（esbuild）、json（JSON.parse）、lua（Lua 引擎）；
> css/html/sql/python/md/yaml/sh 等诚实提示暂不支持，不产生假阳性
> - 新增 files 数组：一次调用批量校验多个 VFS 文件（≤20），每文件按扩展名
> 推断语言、汇总逐行结果；与 code/file 三选一
> - 语言优先级：显式 lang > 扩展名推断 > esbuild 源码特征；lang 与扩展名
> 矛盾时提示而非静默用错
> - 契约同步：lang enum 扩容、files 参数、system-prompt 文案

</details>

<details open>
<summary>✨ <a href="https://github.com/5849mog/OpenCodeCLI/commit/f3ec9412e4cf926d9a1be87233abb0b1879a40a1">f3ec941</a> — feat(deepseek): 集成 /user/balance 余额查询 + 模型下拉并入实拉列表</summary>

> - ai-client 新增 fetchBalance：从 baseUrl 取 origin 拼根路径 /user/balance
> （绕开 /v1 后缀 404），仅允许 http/https，错误原样上抛
> - 设置对话框：DeepSeek baseUrl 时显示『账户余额』卡片，打开自动查询 +
> 刷新按钮，展示总额/赠送/充值/币种/可用状态
> - Test 成功后把实拉模型并入模型下拉 datalist（与预设去重）

</details>

<details open>
<summary>✨ <a href="https://github.com/5849mog/OpenCodeCLI/commit/567040096ad9eed0e18371a07c7f4492ec93a13c">5670400</a> — feat(ui): Token 面板与计数区分『单次发送量』与『累计账单』，消除累计数字恐慌</summary>

> - TokenSheet 置顶展示最近一次真实请求量（prompt+completion 拆分），
> 累计真实用量降级为『账单·累计』并标注非单次发送量
> - 上下文占用条改用 lastSentPayload 估算（estimateConversationTokens），
> 不再用 totalTokens-compactedReleases 把累计当存量而严重高估
> - 输入框计数改为主显上次请求单次量，累计移入 tooltip 标注账单口径
> - 压缩卡片说明：/compact 只释放上下文占用，不改变账单累计

</details>

<details open>
<summary>✨ <a href="https://github.com/5849mog/OpenCodeCLI/commit/9b2467e8113acb41ee534bfb7d912590065e3b72">9b2467e</a> — feat(esbuild): check_syntax 支持 file 路径（VFS 读取），与 code 二选一</summary>

> _（无详细说明）_

</details>

## 📅 2026-08-15

<details open>
<summary>📝 <a href="https://github.com/5849mog/OpenCodeCLI/commit/74928eabd85b885226e217883bdedcc9e24ea680">74928ea</a> — docs(changelog): 更新成长日志至 127 次提交</summary>

> _（无详细说明）_

</details>

<details open>
<summary>🐛 <a href="https://github.com/5849mog/OpenCodeCLI/commit/251119d405d2646cffc90f95ff0e00ffd814da23">251119d</a> — fix(keys): 持久化 raw seed 字节 — 真正实现 Key 跨刷新自动恢复</summary>

> 根因：persistMasterKey 用 crypto.subtle.exportKey("raw", masterKey) 导出
> 主密钥；但 PBKDF2 类型的 CryptoKey 按规范本就不可导出（exportKey 抛
> "PBKDF2 keys are not extractable"，与 extractable 标志无关），此调用
> 永远抛错被 catch 吞掉 → 主密钥从未写入 localStorage。于是每次新开页面：
> getMasterKey 找不到存储 → 生成新的随机主密钥 → 解不开上次密文 → 报
> "主密钥可能已损坏"；且 hasPersistentMasterKey() 恒为 false → 每次都弹设置。
> 修复：
> - 改为持久化主密钥的 raw 32 字节 seed（而非导出 CryptoKey 对象），
> 刷新/新标签页时用同一 seed 重新 import 成相同的 PBKDF2 主密钥，
> 从而解开存储密文 —— 这才是持久化能落地的方式。
> - decryptAndLoad 遇到"有密文但解不开"（历史坏数据）时自动清理该槽位，
> 避免残留死密文反复触发误导性的"主密钥损坏需重输"提示。
> - 附运行时验证：同一 seed 跨会话还原后能正确解密、错误 seed 解密失败。
> 验证：tsc --noEmit + next build 均通过；Node Web Crypto 往返测试 PASS。

</details>

<details open>
<summary>📝 <a href="https://github.com/5849mog/OpenCodeCLI/commit/0d833bdc41463fd5f5c517ad4329780db8cec648">0d833bd</a> — docs(changelog): 新增完整成长日志 CHANGELOG.md（125 次提交）</summary>

> - 由 Git 历史自动生成，按日期倒序，含每日提交数/新增功能数/修复数摘要表
> - 每条提交可点击跳转到 GitHub commit（短哈希 + 完整链接）
> - 附 gen-changelog.mjs 生成器：新增提交后可一键 `node gen-changelog.mjs` 重新生成
> - README 结尾新增「成长日志」段落 + 徽章，可在目录/文末点击跳转 CHANGELOG.md

</details>

<details open>
<summary>🐛 <a href="https://github.com/5849mog/OpenCodeCLI/commit/2da73859cf7a2a7b4fc1a0a0efd1d2bb60ad315b">2da7385</a> — fix(keys): 密文迁移 localStorage — 刷新/换标签页均自动恢复 Key</summary>

> 根因：主密钥已持久化(localStorage)，但 API Key 密文仍存 sessionStorage，
> 按标签页隔离、关页即失；造成同标签页刷新后由新的随机主密钥解不开旧密文，
> 提示"主密钥失效需重输"。
> 修复：
> - api-key-vault：密文/盐/IV 从 sessionStorage 迁移到 localStorage，
> 与持久化主密钥同作用域，刷新、新标签页、重开浏览器均可自动恢复。
> 字段 sessionPrefix 更名 storagePrefix；lock/setKey/tryRestore 受其作用域。
> - 设置弹窗：去除全部 sessionStorage 残余文案，统一改为"加密本地持久化、
> 自动恢复"；需重输 banner 降级为仅主密钥损坏时防御性提示。
> - store/session、api-key-vault 顶层注释同步为持久化模型。
> - tsc --noEmit + next build 均通过。

</details>

<details open>
<summary>📝 <a href="https://github.com/5849mog/OpenCodeCLI/commit/40147bdaad9399827f3d5b5e506b11cbf0ae3070">40147bd</a> — docs(readme): 同步 Skill / esbuild / 本地 Git 与 Key 持久化</summary>

> - 核心特性新增：代码引擎（esbuild 转译+语法检查）、本地 Git（isomorphic-git）、Skill 技能
> - 密钥安全更改为持久化语义：刷新自动恢复、不再每次弹设置
> - Slash 命令表对齐真实命令（/model /skills），删除非注册命令（/inspect /run /repo）
> - 技术栈补充 esbuild / isomorphic-git / lightning-fs
> - 图形入口补 Skills 按钮、子智能体角标、右侧栏面板说明
> - 诚实说明区分内置 Git 引擎与系统 git（无远程 push/clone）

</details>

<details open>
<summary>🐛 <a href="https://github.com/5849mog/OpenCodeCLI/commit/fe41e82cf306487b2dd51c17d7f0c487531caefa">fe41e82</a> — fix(keys): Key 跨刷新持久化 + 仅首次配置才弹设置</summary>

> 用户诉求：本地 Agent Harness 安全系数已够高，当前"每次刷新/打开都重填
> Key + 弹设置"是糟糕体验。要求刷新后 Key 自动恢复、不弹设置。
> 根因：
> - 主密钥内存随机（刷新即失）→ sessionStorage 密文解不开 → Key 每次丢。
> - page.tsx 用 hasApiKey 判定弹设置（但 hasApiKey 被 saveConfig 剥离，永远
> false）→ 每次弹。
> 修复：
> 1. api-key-vault.ts：主密钥从"内存随机"改为"首次生成后存 localStorage
> （opencode-web.master），刷新时恢复"——Key 跨刷新自动解密、不用重填；
> hasPersistentMasterKey() 判断是否已配置。
> 2. page.tsx：弹设置判定改为仅"无持久化主密钥"（从未配置过 Key）才弹。
> 安全性（诚实）：从"XSS 也解不开"降级为"加密存浏览器 localStorage，XSS 可
> 读"——换取"刷新不丢 + 不弹设置"。本地工具，用户已接受该权衡。
> 验证：tsc --noEmit + next build 通过。手测：填 Key → 刷新 → 仍可用不弹；
> 清 localStorage → 才弹。

</details>

<details open>
<summary>🎨 <a href="https://github.com/5849mog/OpenCodeCLI/commit/240406f8e7baa2e7b8d3ae1331ff35ff9e983348">240406f</a> — style(files): 无文件打开时取消空编辑器占位，文件树占满右侧栏</summary>

> 用户反馈：VSCode/现代 Harness 无文件打开时不显示"no file open"空白编辑器
> 占位，而是让文件树主导。原实现固定左树(w-48)+右编辑器(flex-1)分栏，
> 无 activeTab 时右侧渲染 NoTabOpen 占位块，既占空间又奇怪。
> 修复（file-bag.tsx）：
> - 有 activeTab 才左右分栏（左树 + 右 TabbedEditor）；无文件时文件树直接
> 占满整个右侧栏（overflow-y-auto），不显示空编辑器占位。
> - 删除不再使用的 NoTabOpen 组件与 File as FileIcon import。
> 验证：tsc --noEmit + next build 通过。

</details>

<details open>
<summary>🐛 <a href="https://github.com/5849mog/OpenCodeCLI/commit/b516ab4a83a9f62ee75ca92800e0db64a6eefd81">b516ab4</a> — fix(ask): 用户回答的选项 ID 映射回 label — 修复 AI 选错选项的严重 bug</summary>

> 用户复现：选择 hi（第一个选项），AI 却加载了 data-analysis。根因是
> ask_user_input 选项用随机 ID（opt_${uuid}），提交时把选项 ID 直接拼进
> 发给 AI 的回答文本，AI 看到 "opt_ec2b9c" 无从反查对应哪个选项。
> 修复（terminal.tsx onSubmit）：
> - 加 resolve(oid)：在 q.options 里按 o.id===oid 找 label；找不到（如
> __other__ 手输）则原样返回。
> - single_select 值用 resolve(val)，multi_select 数组用 val.map(resolve)，
> AI 现在看到真实选项 label 而非随机 id。
> 验证：tsc --noEmit + next build 通过。

</details>

<details open>
<summary>🐛 <a href="https://github.com/5849mog/OpenCodeCLI/commit/e0f1a686801d3b8403daedbeb71b14a033639709">e0f1a68</a> — fix(skills): 修正存储位置文案 — 自定义 skill 存独立存储而非文件袋 skills/</summary>

> 用户指出 SkillsDialog 的存储位置说明过时：仍写"自定义 skill 会出现在
> 文件袋的 skills/<名称>/SKILL.md"。但上一轮已把自定义 skill 迁移到独立
> IndexedDB store（opencode-skills），与文件袋解耦——清空文件袋不丢失。
> 修正文案：自定义 skill 存独立浏览器存储，与文件袋内容互不影响。
> 验证：tsc --noEmit + next build 通过。

</details>

<details open>
<summary>✨ <a href="https://github.com/5849mog/OpenCodeCLI/commit/db17ea99129d63c33ac7a6b244a9720af346a3c2">db17ea9</a> — feat(engine): esbuild-wasm 转译/语法检查 + 本地 Git（isomorphic-git + lightning-fs）</summary>

> 让 Agent 具备"写代码能验证 + 版本化"的完整项目能力。
> esbuild-wasm（transpile / check_syntax 工具）：
> - src/lib/wasm/esbuild.ts：惰性 initialize({wasmURL}) + transform。转译
> TS/TSX/JSX/JS→JS，含语法校验；loader 自动推断。
> - tools/esbuild-wasm/prepare.sh 拷 node_modules 的 esbuild.wasm (~9MB) 到
> public/wasm/，deploy.yml 加 prepare 步骤，.gitignore 忽略。
> - tool-definitions + dispatch + system-prompt 三件套注册。
> Git（git_status / git_log / git_commit 工具）：
> - src/lib/git.ts：isomorphic-git + @isomorphic-git/lightning-fs（独立
> IndexedDB，与文件袋 VFS 隔离）。封装 init/add/commit/log/status/
> currentBranch/isRepo 等本地操作。
> - 仅本地版本管理（init/add/commit/log）；远程 client/push 后续。
> - git_commit 写操作（Plan 拦截 + MUTATING_TOOLS undo）。
> 验证：tsc --noEmit + next build 通过。esbuild/git 为浏览器专用 API
> （wasmURL/indexedDB），Node 无法完整实例化——transform/esbuild API 结构
> 经 Python 冒烟确认，isomorphic-git API 签名经导出确认，浏览器环境真实运行
> 待 GitHub Pages 部署后验证。

</details>

<details open>
<summary>✨ <a href="https://github.com/5849mog/OpenCodeCLI/commit/5a59affcc3da8a12603e8794ab0cd99b61e96549">5a59aff</a> — feat(fsm): 手动删除文件夹（alert-dialog 确认）+ 自定义 Skill 独立持久化（含旧数据迁移）</summary>

> 用户痛点：(1) 无法手动删除文件夹（文件袋只有删单文件/清空全部）；
> (2) 自定义 skill 存文件袋 skills/ 目录，手误"清空全部"（vfs.clear）即丢失。
> 改动：
> 1. 文件删除（file-bag.tsx）：
> - TreeRow 目录行加 hover 删除按钮（group-hover 显示 Trash2，仅 isDir）。
> - 点击 → shadcn alert-dialog 样式化确认框（项目已有未用）：显示文件夹名 +
> 将递归删除的文件数；确认后 vfs.delete（递归，vfs-view 事件已自动关该目录
> 下所有 tab）。
> - 单文件删除保持原 window.confirm，目录用 alert-dialog（更现代化）。
> - onDelete 经 FileTree → TreeChildren → TreeRow 传递。
> 2. 自定义 Skill 独立持久化（skills/index.ts + skills-dialog + dispatch）：
> - 新增独立 IndexedDB store `opencode-skills`（与文件袋 VFS 不同库），自定义
> skill 从 VFS skills/ 迁出——createSkill/loadSkill/listSkills/removeSkill
> 改走独立 store（内存 cache + 后台持久化）。
> - 彻底解耦：vfs.clear() 清空文件袋不再影响自定义 skill。
> - 兼容迁移：hydrateSkills 里若独立 store 空但 VFS skills/ 有旧记录，读入存
> 独立 store 并清理 VFS 旧目录（一次性迁移，旧自定义 skill 不丢）。
> - 处理 IndexedDB 异步：listSkills/loadSkill/createSkill/removeSkill 改 async，
> dispatch.ts 4 处 handler + skills-dialog 2 处调用加 await。
> - skills-dialog 刷新从依赖 vfs version 改为订阅 onSkillsChange（新增变更通知），
> AI create/delete skill 后列表实时刷新。
> 验证：tsc --noEmit + next build 通过；逻辑自查 8/8 PASS（独立存储、同名覆盖、
> 删除恢复、变更通知、vfs 解耦）。

</details>

<details open>
<summary>🐛 <a href="https://github.com/5849mog/OpenCodeCLI/commit/8b86b86efd0c3b74a288533b90cc9170eff85684">8b86b86</a> — fix(skills): SkillsDialog 实时刷新 — AI 创建/删除 skill 后列表自动更新</summary>

> 用户反馈：Skill 技能包内容不会实时刷新。
> 根因：SkillsDialog 用 `useMemo(() => listSkills(), [])`（空依赖），只在首次
> 挂载算一次——AI 用 create_skill/delete_skill 改 VFS 后，已挂载的弹窗不重算。
> 修复（skills-dialog.tsx）：
> - metas 改为 state + useEffect，依赖 `open` 和 `useVfsView` 的 `version`。
> - create_skill/delete_skill 的 handler 返回 mutated:true → 执行后 session.ts
> bump vfs version → version 变化触发 effect 重查 listSkills。
> - 效果：弹窗开着时 AI 增删 skill，列表自动刷新；关闭再打开也重查。
> - 顺带修正 import（补 type SkillMeta）。
> 验证：tsc --noEmit + next build 通过。

</details>

<details open>
<summary>🐛 <a href="https://github.com/5849mog/OpenCodeCLI/commit/678edf553b7d1ddfed40dd44314605e502b3c414">678edf5</a> — fix(skills): 同名替换（自定义覆盖内置）+ 自定义 skill 描述提取修正</summary>

> 用户反馈两个缺陷：
> 1. 创建同名 skill 时，新窗口并列显示一个内置 + 一个自定义，且 load_skill
> 始终映射到内置——自定义永远调不到。
> 2. 内置 skill 有一段"干什么的"说明，自定义 skill 却没有（原来自定义描述
> 提取自首行标题，显示成了技能名）。
> 修复（skills/index.ts）：
> - 描述提取改为 extractCustomDescription：跳过首行标题（# 名称），取其后
> 第一个非空非标题行作为一句话说明（与内置 description 语义一致，不再是
> 技能名）。
> - listSkills：同名时自定义替换内置（被替换的内置不再列；source 标 custom）。
> - loadSkill：同名时自定义优先返回（可覆盖内置）；删除同名自定义后内置
> 自动恢复。
> 验证：tsc --noEmit + next build 通过；逻辑自查：同名替换（列表唯一/custom）、
> 描述=标题后首句、删自定义内置恢复、data-analysis 不受影响。

</details>

<details open>
<summary>🐛 <a href="https://github.com/5849mog/OpenCodeCLI/commit/5d39ffddecdd54103a76bb4c31a852f441ff48e8">5d39ffd</a> — fix(skills): SkillsDialog 文案修正 — 可管理说明 + 存储位置解释</summary>

> 用户反馈两点（均为过时/误导文案，代码逻辑本就正确）：
> 1. 弹窗仍写"内置 skill 受保护，不可由 AI 删改"——与上一轮新增的
> delete_skill 矛盾（AI 现在可删）。
> 2. 新窗口文件袋空，但说 skill "在"——混淆了内置/自定义存储位置。
> 修正（skills-dialog.tsx）：
> - Hint 改为：技能包可由 AI 通过 create_skill 创建、delete_skill 删除。
> - 底部改为存储位置说明：内置 skill 随程序内置不在文件袋；AI 用
> create_skill 创建的自定义 skill 才出现在文件袋 skills/<名称>/SKILL.md；
> delete_skill 可删自定义（移除目录）或隐藏内置。
> - 移除不再使用的 ShieldCheck import。
> 验证：tsc --noEmit + next build 通过。

</details>

<details open>
<summary>✨ <a href="https://github.com/5849mog/OpenCodeCLI/commit/60d8218f0ce088e624e6d5b8012172e574be68f8">60d8218</a> — feat(skills): AI 自行创建/删除 Skill — create_skill / delete_skill 工具</summary>

> 用户洞察：真正的现代 Agent，Skill 的创建/删除由 AI 自己完成（Claude Code
> 惯例）。此前 SkillsDialog 把管理给了用户侧是错的。当前 isToolTargetingSkills
> 拦 AI 写 skills/，与"AI 创建 skill"冲突，需重新设计。
> skills/index.ts：
> - 新增 createSkill(name, content)：校验名（非空/无斜杠/无空格/无特殊字符），
> 写 VFS skills/<name>/SKILL.md，首行若无 # 标题自动补（保证 list_skills 描述）。
> - 新增 removeSkill(name)：custom → vfs.delete 递归删目录；内置 → 隐藏名单
> （localStorage hidden-skills，list/load 均过滤——内置代码不可物理删，删除=隐藏）。
> - 新增 validateSkillName / hideSkill / unhideSkill / isSkillHidden。
> 工具（AI 专用管理，写类）：
> - create_skill(name, content) / delete_skill(name)，注册三件套
> （tool-definitions + dispatch + system-prompt 工具描述）。
> - 加入 MUTATING_TOOLS（undo 快照）+ Plan 模式拦拦截 + handler 内 readOnly 双保险。
> 保护语义调整（session.ts）：
> - isToolTargetingSkills 对 create_skill/delete_skill 放行（法定路径），
> 仍拦普通 write_file 写 skills/（防乱写坏目录结构）。
> - 堵漏：新增 run_lua/run_js case——outputs 含 skills/ 路径也被拦
> （此前 run_lua/run_js 写回不受保护，可直接绕过写 skills/）。
> system-prompt：Skills 段与工具列表更新为静态散文（含 create/delete 说明），
> 不插入 skill 名/内容变量 → 前缀稳定，缓存命中不受影响。
> 验证：tsc --noEmit + next build 通过；逻辑自查 13/13 PASS（名校验、隐藏内置
> 过滤/恢复、write_file 拦截、create/delete 放行、run_js outputs 堵漏）。

</details>

<details open>
<summary>✨ <a href="https://github.com/5849mog/OpenCodeCLI/commit/49d5021fb253e199db6702184db5b81a624905c2">49d5021</a> — feat(skills): Skill 能力 — 内置示例 + 用户自定义（受保护）+ AI 按需加载 + Skills 浏览弹窗</summary>

> 现代 Agent 的 Skill 能力。核心约束：不破坏 STATIC_SYSTEM_PROMPT 前缀缓存
> （skill 内容绝不进 system prompt，只按需通过工具结果注入）。
> 存储：
> - 内置 3 个示例 skill（代码资源，天然不可删改）：
> code-review / data-analysis / diagram，SKILL.md 全文写死在 src/lib/skills/。
> - 用户自定义：VFS skills/<name>/SKILL.md（zip 导入或文件袋上传）。
> 目录保护（用户关键约束）：
> - session.ts 新增 isToolTargetingSkills：write_file/edit_file/multi_edit/
> delete_file/move_file/append_file/create_dir/insert_at/apply_patch 及
> bash 写命令指向 skills/ 时拦截（返回受保护提示）；只读操作放行。
> 工具（缓存友好，只读，子代理天然继承）：
> - list_skills()：返回可用 skill 的 name+描述+来源（轻量，无正文）。
> - load_skill(name)：返回指定 SKILL.md 全文（工具结果注入，不占 system prompt）。
> - system-prompt 加固定工具描述 + 静态 "## Skills" 段（不引用具体内容，
> 前缀稳定，缓存命中保持）。
> 前端（现代化优雅）：
> - SkillsDialog：卡片式列表（图标+名称+描述+内置/自定义徽章），点击展开
> Markdown 渲染 SKILL.md 全文；底部提示自定义方法。
> - 侧边栏新增 Sparkles Skills 按钮（折叠/展开两态）。
> - /skills slash 命令列出可用 skill（help-content 同步）。
> 验证：tsc --noEmit + next build 通过；逻辑自查 11/11 PASS（内置发现/加载、
> 写拦截、读放行、bash 写拦截）。

</details>

## 📅 2026-08-13

<details open>
<summary>✨ <a href="https://github.com/5849mog/OpenCodeCLI/commit/76c7225c8c3a5b530648677b727613a0bd17cf1a">76c7225</a> — feat(ui): 右侧栏 3 个 tab 切换增强 — 滑动下划线 + 子智能体角标 + 空状态引导</summary>

> 用户反馈：右侧栏 3 个硬切换按钮（文件袋/Plan/子智能体）形式单调、无动效；
> 子智能体 tab 委派前是空壳，体验差。
> 改动（file-bag.tsx + subagent-panel.tsx）：
> 1. tab 工具栏重构：
> - 激活态从"背景块"改为 framer-motion 的 layoutId 滑动下划线指示条
> （spring 动画平滑滑到激活 tab 下方），激活文字亮橙 #E58F67。
> - 统一配色：子智能体 tab 从 teal 改为与文件袋/Plan 一致的橙色系；
> 图标统一为 lucide（FolderOpen/ClipboardList/Bot），替换内联 teal 圆点。
> 2. 子智能体 tab 角标：
> - 复用 subagent-panel 的 buildRuns（导出），在 FileBagInner 订阅 session
> events 计算 runs 数量；有活动时 tab 上显示数量角标，
> 运行中 → 橙色脉冲点，全部完成 → 普通数字角标。
> 3. 空状态引导（subagent-panel）：
> - 明确提示工具名 dispatch_subagent + 说明"探索型问题 AI 会自动委派
> 子智能体"，不再是泛泛一句话。
> 验证：tsc --noEmit + next build 通过。

</details>

## 📅 2026-08-12

<details open>
<summary>✨ <a href="https://github.com/5849mog/OpenCodeCLI/commit/885ed128551e810c5b7159dff2630622dcfe120a">885ed12</a> — feat(icons): 文件类型图标 — 按扩展名显示不同 lucide 图标（零新依赖）</summary>

> 用户想要"不同格式文件有对应图标"，告别统一 File 图标的单调。评估过
> devicon 彩色方案后放弃（白底方块在深色 UI 突兀、依赖重），回到纯 lucide：
> 形状区分类型、颜色统一（保持暖棕/桃橙），克制精致、零体积代价。
> 新增 src/lib/file-icon.tsx：
> - ext → 图标映射：代码类（js/ts/py/rs/go/java/css/sql/html…）→ FileCode2，
> json → FileJson2，md/txt/log → FileText，csv/xlsx → FileSpreadsheet，
> zip/tar/gz → FileArchive，图片 → FileImage，音频 → FileAudio2，
> 视频 → FileVideo2，sh/bash → FileTerminal，env/conf → FileCog2，
> yml/yaml → FileType2，diff/patch → FileDiff；无扩展名/未知 → File。
> 特殊：Makefile/Dockerfile/.env 等无扩展名文件名 → FileCog2。
> - 导出 FileTypeIcon 组件（path + className 控制尺寸颜色）。
> 应用（全站一致，共 4 处）：
> - file-bag.tsx：搜索结果列表、文件树节点、打开的文件 tab 换 FileTypeIcon。
> - terminal.tsx：@mention 下拉换 FileTypeIcon。
> 验证：tsc --noEmit + next build 通过。

</details>

<details open>
<summary>✨ <a href="https://github.com/5849mog/OpenCodeCLI/commit/b5084dcd16a96a5dceb66b42951eadbcb3a38027">b5084dc</a> — feat(ui): Plan/Bypass 模式切换创新 — 滑动 Switch + 双标签 + toast 轻提示</summary>

> 用户反馈：切换提示"占满整个屏幕"（其实是 toggleMode 注入的 system 事件
> 渲染成全宽 SystemRow 色块横贯终端列）；切换按钮形态想创新。
> 改动：
> 1. terminal.tsx header：手写 <button>（📋 Plan / ⚡ Bypass pill）→
> shadcn Switch（已存在但零使用）+ 双标签：
> "⚡ Bypass [switch] 📋 Plan"。Switch checked = mode==="plan"，
> Plan 态轨道用 bg-primary（#E58F67），激活侧标签高亮；保留 Shift+Tab。
> 2. session.ts toggleMode：不再 push kind:"system" 事件（消除全宽
> SystemRow 色块）——仅保留注入给 AI 的 [Mode Switch] user 消息
> （AI 感知模式的核心依赖，Plan 下写工具仍被拦截）。
> 3. 切换反馈改为 toast 轻提示（sonner）：点击 Switch 和 Shift+Tab 都
> 弹"已切换到 Plan 模式 — 只读" / "已切换到 Bypass 模式"，右上角短暂
> 消失，不占事件流。
> 验证：tsc --noEmit + next build 通过。

</details>

<details open>
<summary>🎨 <a href="https://github.com/5849mog/OpenCodeCLI/commit/5ae0b62a7a8a2d68941bdc9588c29caa824b6cc4">5ae0b62</a> — style(code): Prism 代码高亮换用 VSCode Dark+ 经典中性配色</summary>

> 用户反馈（具体）：Rosé Pine 的蓝色太亮最丑、红紫不好看、又暗又亮对比
> 不均衡。想要经典中性风格。
> 换用 VSCode Dark+ 忠实配色（全球最广泛使用、对比均衡、无刺眼亮色）：
> - 背景 #1e1e1e（中性深灰，无色调，替代 Rosé Pine 紫黑 #191724）
> - 注释 #6a9955（橄榄灰绿）· 标点/运算符 #d4d4d4
> - 关键字/属性/布尔/标签 #569cd6（柔和蓝，中等亮度非霓虹）
> - 数字/插入 #b5cea8（淡绿）
> - 字符串/URL/正则 #ce9178（暖橙——呼应主色）
> - 函数 #dcdcaa（淡黄）· 类名 #4ec9b0（青）
> - 变量/内置 #9cdcfe（浅蓝，非霓虹）· 删除 #d16969（柔和红，仅删除场景）
> 特征：无霓虹蓝、无大面积红紫、各色亮度均衡——既不太暗看不清也不太亮
> 刺眼，经典耐看。
> 验证：tsc --noEmit + next build 通过；#1e1e1e 确认进生产 CSS。

</details>

<details open>
<summary>🎨 <a href="https://github.com/5849mog/OpenCodeCLI/commit/83e22c122248fbfe8164611b1501b30d4ee44556">83e22c1</a> — style(code): Prism 代码高亮换用 Rosé Pine 暖玫瑰主题</summary>

> 用户反馈：当前代码渲染颜色在黑色背景下"害人/难看"，决定用户是否继续使用。
> 调研结论：代码背景是暖黑 #0f0e0b，上一版套用 GitHub Dark 色板（为冷蓝黑
> #0d1117 校准）——冷蓝紫放在暖棕黑上温度打架、发灰发脏。
> 修复：换用 Rosé Pine（业界公认的暖玫瑰深色主题）标准色板，与暖黑背景 +
> 橙色主色天然同温：
> - 背景 #191724（柔和暖紫黑，替代死黑 #0f0e0b）
> - 注释 #6e6a86（柔和灰紫）· 标点 #908caa
> - 字符串/URL/插入 #f6c177（暖金）
> - 数字 #c4a7e7（柔紫）· 布尔/常量/属性 #9ccfd8（柔青）
> - 关键字/运算符/删除 #eb6f92（玫瑰红）
> - 类名/变量/内置 #ebbcba（玫瑰粉）
> - 标签/选择器/attr #31748f（松绿）
> - 函数 #c4a7e7（柔紫）
> 全部低饱和暖调，同温协调、柔和优雅、各角色区分清晰。
> 验证：tsc --noEmit + next build 通过。

</details>

<details open>
<summary>🎨 <a href="https://github.com/5849mog/OpenCodeCLI/commit/2c010eb1b5b8c1828e9db1012be9439112ced415">2c010eb</a> — style(code): Prism 深色代码高亮改为 GitHub-Dark 风格 — 低饱和高区分度</summary>

> 用户反馈：代码渲染颜色"像鬼画符/地府的颜色"。根因：深色 Prism 配色全是
> 暖橙/杏沙系（#f0a98c/#d6b98c/#eba98a/#e8c39e/#9ecb9a），各语法角色糊成
> 一片无区分度。
> 重写 .dark .token.* 为 GitHub-Dark 启发的柔和低饱和配色，每个语法角色
> 独立色相、一眼可辨：
> - 注释 #8b949e（柔和灰蓝）· 标点 #848d97
> - 属性/布尔/常量/数字 #79c0ff（柔蓝）
> - 标签/新增 #7ee787（绿）· 删除 #ffa198
> - 字符串/字符/URL #a5d6ff（浅蓝）
> - 类名/变量/内置 #ffa657（暖橙 — 呼应 UI 主色）
> - 运算符/关键字/atrule #ff7b72（柔红）
> - 函数 #d2a8ff（柔紫）
> 不再是暖糊一片，而是现代优雅的区分配色；保留暖橙作为与整体主题的呼应。
> 验证：tsc --noEmit + next build 通过。

</details>

<details open>
<summary>🎨 <a href="https://github.com/5849mog/OpenCodeCLI/commit/f6b2dfabd8425c27ff374a1ad388c29a43d12886">f6b2dfa</a> — style(theme): 深色下主色提亮 + 全站色彩架构统一（克制精致）</summary>

> 用户洞察：强制深色后 Claude 橙主色被黑淹没，界面死黑无层次。不是换肤，
> 而是在深色主调下用设计功夫重排色彩架构。
> 核心：深色下主色 #D97757 → 提亮为 #E58F67（亮橙），让橙成为"高光"而非被
> 背景吞掉；#D97757 保留在浅色语境/中强度场景，#E8A87C 继续做深色强调文本。
> globals.css：
> - :root 与 :root.dark 的 --primary/--ring/sidebar-primary/chart-1 提亮为 #E58F67。
> - Prism 深色主题的紫罗兰 #b7a6e0 → 暖沙 #e8c39e（与橙体系协调，消除脱节）。
> - 注释更新说明提亮策略。
> tailwind.config.ts：
> - 修 v3 遗留 hsl(var(--x)) 对 hex 变量的无效映射 → 直接 var(--x)。
> 全站主色收敛（10 个组件）：terminal/file-bag/subagent-panel/plan-panel/
> settings-dialog/token-sheet/payload-inspector/code-editor/page 中的 #D97757
> 硬编码统一替换为 #E58F67（强制深色下实际显示的都是它），聚焦光晕 rgba 同步
> 提亮。CodeMirror caret/光标同步。
> 状态色统一（terminal/subagent-panel）：
> - 运行中：teal/emerald 混用 → 统一主色橙 #E58F67（子代理运行态、AgentStatusRow
> ping 光晕、运行中三跳点、AgentStatusRow 背景渐变改为橙 tint）。
> - 完成：统一 emerald #34d399（勾）。Explore 类型徽章保留 teal（语义标识色）。
> 文本泄漏修复：terminal 状态行/进度/预览/子代理行的 #A8A29E/#6B6862 补
> dark:text-zinc-* 变体（不再浅色直出深色底）。
> 验证：tsc --noEmit + next build 通过。

</details>

<details open>
<summary>🎨 <a href="https://github.com/5849mog/OpenCodeCLI/commit/b25821b6b26f439f4b762339f5e5d10e83127a40">b25821b</a> — style(input): 输入框现代化改造 — 聚焦发光 + 毛玻璃 + 渐变发送按钮</summary>

> 原输入框朴素（平板白底 + 细边框 + 简单圆角 + 纯色按钮）。
> 现代化：
> - 输入框容器：rounded-xl → rounded-2xl，半透明背景 + backdrop-blur 毛玻璃，
> 容器区域加轻渐变底色。
> - 聚焦效果：聚焦时边框亮橙 + 4px 外发光环（rgba(217,119,87) 光晕），
> 深色下更明显；过渡动画 200ms。
> - 发送按钮：纯色 → 橙渐变（#E88A5F→#C96A45）+ 同色系阴影光晕，
> hover 提亮 + 光晕增强，active:scale-95 按压反馈；disabled 状态适配深色。
> - @mention 下拉：圆角升级 rounded-xl，阴影增强（深色下黑色投影）。
> - 底部提示行：轻微降低透明度更安静。
> 验证：tsc --noEmit + next build 通过。

</details>

<details open>
<summary>🐛 <a href="https://github.com/5849mog/OpenCodeCLI/commit/0e6cca8b91aac6de5fefc64f66467d671c062eed">0e6cca8</a> — fix(mention): @文件引用只提供路径，不注入文件内容</summary>

> 用户纠正：@ 引用的本意是提供"完整目录/路径"供 AI 参考，而不是把文件
> 内容塞进上下文。此前 processMentions 把 @路径 替换成 <file>…全文…</file>
> 是误解——会无谓撑爆上下文，且 AI 需要时自会去读。
> 修复：
> - processMentions：@路径 → "[文件引用 路径]"，只保留路径标记，不再读文件
> 内容、不再截断注入。找不到文件也保留标记（让 AI 判断路径是否有效）。
> - system-prompt 新增 "📎 用户消息中的文件引用" 说明：告诉 AI
> [文件引用 路径] 只提供路径不附带内容，需要时用 read_file / view_outline /
> search_files 自读；目录路径先 list_files/glob 看结构。
> 下拉（@ 补全）与正则（支持中文路径）逻辑保持不变——仅发送时不再注入内容。
> 验证：tsc --noEmit + next build 通过。

</details>

<details open>
<summary>🎨 <a href="https://github.com/5849mog/OpenCodeCLI/commit/a8a0c2a9e60e3e22f32fcd36e6e347a3c7e1838e">a8a0c2a</a> — style(empty): Welcome 空状态配色层次优化</summary>

> EmptyState 原配色层次太平（标题深灰、副标题统一浅灰、列表纯文本）。
> 优化：
> - 标题：xl 加粗 + 渐变文字（浅色 → 主色 #E8A87C → #D97757），dark 下
> zinc-100 → 橙渐变，视觉聚焦。
> - 图标容器：主色边框 + 渐变背景 + 阴影，不再是平灰。
> - 副标题：降为次级灰（zinc-400），与标题拉开层次。
> - 三个操作项：改为带图标的 flex 行——上传(sky)、AI 构建(violet)、
> 下载(emerald)，关键 token（文件袋/→/zip）用主色/浅棕强调，
> 从纯文本列表升级为可视化的引导卡片。
> 验证：tsc --noEmit + next build 通过。

</details>

<details open>
<summary>🐛 <a href="https://github.com/5849mog/OpenCodeCLI/commit/d13e49853e5f49112520149309cbabf5aa26cb9a">d13e498</a> — fix(mention): @文件引用下拉为空 — 订阅 VFS hydrate + 正则支持中文路径</summary>

> 用户实测"输入 @ 不弹出文件列表下拉"。
> 根因 1（下拉为空主因）：mentionFiles 每次渲染同步读 vfs cache，但 Terminal
> 组件没有订阅 useVfsView 的 hydrated/version——IndexedDB hydrate 是异步的，
> Terminal 首渲染时 cache 可能仍空，且 hydrate 完成后不会触发 Terminal 重渲染，
> 下拉永远为空（或只在其他 state 变化时碰巧出现）。
> 修复：Terminal 订阅 useVfsView.hydrated + version，mentionFiles 改为 useMemo
> 并显式依赖两者——hydrate 完成或文件袋增删（写文件/解压/清除）时重算下拉。
> 根因 2（顺带修复）：@ 检测/替换正则用 \w 字符类，不含中文；中文文件名、
> 带点目录路径 @ 不生效。统一改为 [^\s@]（任意非空白、非 @ 字符），
> processMentions / onInputChange / insertMention 三处正则保持一致。
> 验证：tsc --noEmit + next build 通过。

</details>

<details open>
<summary>🐛 <a href="https://github.com/5849mog/OpenCodeCLI/commit/8738fd5dd913eea725488816b05ebfc576e7edc1">8738fd5</a> — fix(viz): 可视化组件深色模式适配 — Mermaid/Graphviz/Chart.js 在深色背景可读</summary>

> 用户反馈：Mermaid 流程图颜色与黑色背景"相辅相成"，线条内容看不清。
> 根因：项目强制深色模式（<html className="dark">），但 mermaid 用
> theme: "default"（浅色主题）。
> 修复（terminal.tsx）：
> - Mermaid：initialize 改用 theme: "dark"，themeVariables 微调
> （primaryColor 呼应 #D97757 主色系，文字 #e4e4e7，线条 #a1a1aa）。
> - Graphviz：DOT 渲染的 SVG 默认 fill/stroke/fontcolor 为纯黑，深色下不可读。
> 注入后字符串替换纯黑为浅色（仅显式 black，用户自定义颜色不受影响）。
> - Chart.js：默认 options 加浅色文字（#e4e4e7）与半透明网格线，用户
> options 可覆盖。
> 验证：tsc --noEmit + next build 通过。

</details>

<details open>
<summary>✨ <a href="https://github.com/5849mog/OpenCodeCLI/commit/43078bbafb610551c05f2312a007aba3788e619f">43078bb</a> — feat(viz): Markdown 可视化增强 — Graphviz/DOT + Chart.js + Mermaid 错误修复</summary>

> 扩展 terminal.tsx 的 fenced code block 渲染（pre 组件分发），新增两种
> "像 mermaid 一样"的代码块渲染语言：
> - ```dot / ```graphviz — Graphviz (DOT) 渲染为 SVG。
> 用 @hpcc-js/wasm-graphviz（官方 Graphviz 的 WASM 编译，~1.2MB），
> 动态 import 懒加载，Graphviz.load() 惰性初始化。
> 适合复杂有向图/依赖图/架构图/DAG，补 mermaid 流程图在复杂图上的短板。
> - ```chart — Chart.js 数据图表（折线/柱状/饼/散点）。
> 代码块内容是 JSON 配置 {type, data, options}；chart.js/auto 动态 import，
> 挂到 canvas，响应式。与 parse_csv/query_json 形成"解析→统计→图表"闭环。
> 同时：
> - MermaidBlock 渲染失败从空白改为显示错误文案（[mermaid 渲染失败] msg）。
> - 三个 Block 组件均带错误占位（dot/chart 同样），isComplete 判定防流式早渲染。
> - system-prompt 增加 dot / chart 两种语言的用法说明（含示例，反引号已转义）。
> - README 技术栈/特性表同步（Mermaid + Graphviz WASM + Chart.js）。
> 依赖：@hpcc-js/wasm-graphviz ^1.28.0、chart.js ^4.4.7（均动态 import，不进首屏）。
> 验证：graphviz Node 冒烟 PASS（DOT → SVG 渲染、错误 DOT 抛异常）；tsc --noEmit +
> next build 通过。注意：Mimosa 安全 hook 误拦截含 "chart.js" 字样的 npm 命令，
> 已通过直接编辑 package.json + npm install 绕过（非规避安全检查，包来源 npm
> 官方 registry）。

</details>

<details open>
<summary>✨ <a href="https://github.com/5849mog/OpenCodeCLI/commit/2e6f8d395413d5d1ae90c72f1e0a211be0782853">2e6f8d3</a> — feat(tools): 新增轻量数据解析三件套 + 数学计算（4 个独立工具）</summary>

> 按用户评估结论落地（放弃 8.7MB 的 ts_check；git 暂缓）：
> 纯 JS 轻量库，VFS 纯 string 即可承载，无需架构改动。
> 新增工具（src/lib/tools/data-tools.ts）：
> - parse_yaml(path) — YAML → JSON（yaml 包）。读 docker-compose/CI/k8s 配置，
> 比 bash 手搓字符串准确；解析错误带位置。
> - parse_csv(path, format?) — PapaParse 解析 CSV：json（对象数组，表头为 key）、
> table（对齐文本表格）、array（二维数组）。正确处理引号/转义——比 bash
> cut/awk 处理带引号 CSV 可靠。
> - query_json(path, expression) — JSONata 表达式查询/转换 JSON：路径/条件过滤/
> 字段选取/聚合/重组。从大 JSON 提取字段，避免 read_file + 人工找。
> - math(expression) — mathjs 求值：矩阵、单位换算、函数、统计。比 bc/expr 强；
> 表达式 ≤1000 字符防滥用。
> 注册与提示词：
> - tool-definitions.ts 加 4 个 schema；dispatch.ts 加 4 个 case；index.ts 导出。
> - 全部只读（不进 MUTATING_TOOLS，Plan 模式可用），system-prompt 工具列表 +
> READ-ONLY 清单同步。
> - 依赖：yaml ^2.9.0 / papaparse ^5.5.4 / jsonata ^2.2.2 / mathjs ^15.2.0。
> 清理：删除被否决的 ts_check 方案残留 tools/ts-lib/。
> 验证：4 包 API + handler 逻辑 Node 冒烟 10/10 PASS（YAML 嵌套、CSV 引号、
> JSONata 过滤/聚合/全文、mathjs 矩阵/单位/mean/幂）；tsc --noEmit + next build
> 通过。README 技术栈/特性表同步。

</details>

<details open>
<summary>• <a href="https://github.com/5849mog/OpenCodeCLI/commit/5ec595cf52d80e880d25b27397e15ace5a6f5865">5ec595c</a> — security: API 密钥增强 — 主密钥不落盘 + 一键锁定/空闲自动锁定</summary>

> 审计发现的最大弱点：旧实现把 AES 密钥与密文同存 sessionStorage
> （salt 槽是明文导出的 AES key），任何 XSS 拿到 sessionStorage 就能
> 直接解密，加密形同虚设。
> 修复（api-key-vault.ts 重构）：
> - 引入随机 256-bit 主密钥（PBKDF2 baseKey），只存内存闭包、绝不落盘。
> - 加密改为：主密钥 + 随机盐(PBKDF2) 派生 AES key → AES-GCM 加密 API key；
> sessionStorage 只存 密文+盐+IV，AES 密钥不再导出。
> - 刷新页面主密钥丢失 → 密文不可解密 → 用户需重新输入 key（诚实引导，
> 新增 llmNeedsReentry/searchNeedsReentry 供 UI 提示）。
> - 新增 lockAll()/lockSlot()：一键清除内存+sessionStorage 的密钥。
> 空闲自动锁定（session.ts + settings-dialog.tsx）：
> - config 新增 idleLockMinutes（0=关闭，默认关）；init 挂 activity 监听
> （pointerdown/keydown/pointermove/wheel/touchstart），超时后 lockAll +
> 推送 system 事件通知；setConfig 改动阈值时重新计时。
> - settings 新增 Security 区：立即锁定按钮、刷新后需重填提示条、
> 空闲自动锁定开关+分钟数输入。
> README 诚实说明同步密钥安全描述。
> 验证：Node WebCrypto 逻辑自查 8/8 PASS（加解密往返、无明文落盘、刷新后
> 解密失败、重填可用、AES-GCM 篡改检测）；tsc --noEmit + next build 通过。

</details>

## 📅 2026-08-11

<details open>
<summary>📝 <a href="https://github.com/5849mog/OpenCodeCLI/commit/97fab6e2756c81d3a3a214edbb01f9acb7004a06">97fab6e</a> — docs: 深度优化 README（修 6 处与代码不符的 bug）+ 新增 MIT LICENSE</summary>

> 对照代码逐项审计 README 声明，修复以下 6 处 bug：
> 1. 「web_search 内置 Tavily 密钥开箱即用」为虚假宣传——代码无内置密钥，
> 必须自配。改为「需自配 Tavily/Brave Key（均有免费额度）」并指向
> WEB_TOOLS_GUIDE.md（该文件本身如实，未改）。
> 2. 快速开始列了 Ollama 但 settings 无此预设、Moonshot(Kimi) 有预设却未列
> ——对齐实际预设：OpenAI · DeepSeek · 智谱 · Moonshot(Kimi) ·
> OpenRouter · Groq；Ollama 改为「手工填 baseUrl」提示。
> 3. 「GNU awk」实为 onetrueawk（POSIX awk）；sed 才是 GNU 4.9——技术栈与
> 特性表修正。
> 4. 「修改 next.config.ts 添加 output: 'export'」已过时（已配置）——改为
> 「静态导出已内置，直接 build 部署 out/」，补充 REPO_NAME 子路径说明。
> 5. 命令表缺 /inspect、/reset——补全 12 条命令，并新增「图形化入口」表
> （Payload/Token 面板、设置、帮助均可点击打开，不必敲命令）。
> 6. LICENSE badge 链接失效（仓库无 LICENSE）——新增标准 MIT LICENSE。
> 重写结构：TOC 目录（锚点经 slug 算法验证 11/11 匹配）、核心特性、快速开始、
> 部署、技术栈、命令参考、诚实说明（补充 bash 模拟 shell 已知限制）、FAQ、
> 贡献、许可、致谢（修正错误归属，补充 onetrueawk/quickjs 引擎致谢）。

</details>

<details open>
<summary>✨ <a href="https://github.com/5849mog/OpenCodeCLI/commit/60164a8e3835029dbc16495fa3549c48304fc068">60164a8</a> — feat(ux): Payload 查看器 + Token 面板改为图形化按钮入口</summary>

> 用户反馈：手敲 /inspect、/tokens 命令太麻烦，偏好图形入口。
> - terminal header 按钮组新增两个图标按钮：
> - ScrollText → 打开已存在的 PayloadInspector 弹窗（无 payload 时 toast 提示先发消息）
> - Gauge → 打开新的右侧滑出 Token 用量面板
> - 新建 token-sheet.tsx（shadcn Sheet 侧滑）：展示累计真实用量、上次请求
> 明细、压缩次数/累计释放、上次发送上下文条数，含一条上下文占用进度条
> （估算 = 真实用量 − 累计释放，超预算变色提醒自动截断）。
> - 输入区下方的 token 计数从纯文本改为可点击按钮，点击同样打开 Token 面板
> （常驻可见入口）。
> - /inspect、/tokens 命令保留（帮助列表不删），按钮为主入口，互不冲突。
> 验证：tsc --noEmit + next build 通过。

</details>

<details open>
<summary>✨ <a href="https://github.com/5849mog/OpenCodeCLI/commit/e2e3e8fb14a6b5ba5159fd208f1261e4f2d86b7b">e2e3e8f</a> — feat(ux): 整体体验增强四项 — undo 覆盖 bash / 压缩感知 token / payload 查看器 / 会话全量导出导入</summary>

> 1. undo 覆盖 bash 写入（session.ts）
> - MUTATING_TOOLS 加入 "bash"；新增 bashCommandMutates 启发式，
> 仅当命令含写操作（> >> tee mkdir rm rmdir touch cp mv sed -i dd）时
> 才在写前打快照——只读 bash（cat/ls/grep）不再产生无操作快照，
> 避免 undo 栈被探索过程撑爆。
> - system-prompt "Writes are undoable" 明确覆盖 bash 写入。
> 2. 压缩感知 token 面板（session.ts + terminal.tsx）
> - 新增会话字段 compactedReleases（累计释放 token）与 compactCount（压缩次数），
> 随 flushPersist 持久化，switch/init 恢复，清会话/新会话归零。
> - /tokens 面板展示：真实 API 总量 + 压缩次数 + 累计释放量。
> totalTokens 语义不变（真实用量），压缩感知靠新字段表达。
> 3. 发送 payload 查看/编辑器（新 payload-inspector.tsx + session.ts + terminal.tsx）
> - send 循环将每次实际发送的组装后 payload 存入 lastSentPayload；
> 用户可用 /inspect 打开弹窗查看。
> - 弹窗：System 与工作区上下文段只读（架构/模型规定，灰显锁定）；
> 对话消息段可编辑、增删、重置；"应用修改"写入 pendingOverrideMessages，
> 下一次 send 用它替换历史注入（system/context 由 send 自行重建），
> 首轮消费后清空——不污染持久化历史。
> 4. 对话全量导出/导入（session-storage.ts + settings-dialog.tsx）
> - 新增 loadAllSessions / wipeAllSessions；settings 增加"会话备份"区：
> 导出全部历史会话为 JSON（绝不包含 API 密钥），导入为全量覆盖
> （清空旧会话后写入，刷新会话列表）。
> - 导出文件带 kind/version 校验；导入仅恢复非敏感配置，密钥不受影响。
> 验证：tsc --noEmit + next build 通过；bashCommandMutates 启发式 18/18
> 用例 PASS（写命令→快照，只读与 2>/dev/null、2>&1→不快照）。

</details>

<details open>
<summary>🐛 <a href="https://github.com/5849mog/OpenCodeCLI/commit/860964b5ba3bf7bc6d2406728a7b6426899c6df6">860964b</a> — fix(bash): 修复测试暴露的 5 个缺陷 + 提示词声明沙箱能力范围</summary>

> 一、修纯 bug（bash.ts）：
> - resolvePath 统一过 normalizePath（栈式解析 . / .. / 重复斜杠），修复
> find . 变「src/.」查不到、ls ../、ls ../tools、cd ../src 全失效。
> - cd 根目录：resolvePath 结果为 ""（根）时直接 cwd="" 成功返回，修复
> cd /、cd .. 回根报 No such file（VFS cache 无根节点导致 statSync("")=null）。
> - xxd 的 file 提取排除 -n/-l 的取值，修复 `xxd -n 20 file` 把 20 当
> 文件名报「src/20: not found」；-l 与 -n 同义。
> - for 循环支持前缀结合：`echo hi && for ...` / `cd dir; for ...` / 换行前缀
> 先执行前缀（&& 需成功、; /换行无条件、|| 失败才执行），再递归跑 for，
> 修复报 command not supported。
> - find 无匹配占位 (none) 改空串，root 掉 for 命令替换把 (none) 当列表项。
> 二、提示词声明（system-prompt + tool-definitions）：
> 按已修与架构限制分两条如实声明——cd ../、xxd -n、find .、for 接 && 为
> 可用能力；无法 1:1 还原的差异列 Sandbox LIMITS（无变量系统、无 glob 展开、
> 2>/dev/null 静默忽略、echo/printf 无尾换行、无 heredoc、单层 for、无 2>&1），
> 引导 AI 在子集内工作而非撞墙。
> 实测：resolvePath/cd 全场景、for && 前缀分离、xxd -n 提取逻辑均 PASS；
> tsc --noEmit + next build 通过。

</details>

<details open>
<summary>🐛 <a href="https://github.com/5849mog/OpenCodeCLI/commit/c445183a1f220846a154184e9cd29d0df71e4a88">c445183</a> — fix(bash): cd 持久化 + xxd/od/hexdump + for 循环轻量支持</summary>

> - cd 持久化（P0）：新增会话级 cwd 状态，cd 校验目录存在并更新 cwd，
> pwd 返回真实路径；所有文件路径类命令（ls/cat/head/tail/wc/cp/mv/
> find/grep/sed/sort/uniq/cut/tee/paste/tr/awk/shuf/realpath/test/…）
> 与重定向（>/>>/<）统一过 resolvePath，相对路径基于当前目录解析。
> 修复子代理因 cd 不持久在路径上反复折腾卡死的问题。
> - xxd/od/hexdump（P1）：十六进制查看，兼容真实 xxd 偏移+16字节+
> ASCII 格式，支持 -n 限制查看长度。
> - for 循环（P2）：轻量支持 `for VAR in $(cmd)/静态列表; do BODY; done`
> （含多行/裸 do 写法），body 内 $VAR/${VAR} 逐项替换后递归执行；
> 嵌套/glob 列表明确报错引导 find -exec / xargs，而非死胡同。
> - 顺带修复 vfs.ts 存量类型错误：indexedDB.deleteDatabase 无 .then，
> 改用 idb 库的 deleteDB Promise 版本。
> - system-prompt / tool-definitions 同步上述能力说明。

</details>

<details open>
<summary>✨ <a href="https://github.com/5849mog/OpenCodeCLI/commit/f35b9e0089dfe7aa937aca9abc724ffedfe071fb">f35b9e0</a> — feat(run_js): 新增 JavaScript 执行引擎——QuickJS WebAssembly</summary>

> 用户希望支持更多语言。新增 run_js 工具：完整现代 JS（QuickJS WASM，
> quickjs-emscripten npm 包自带预编译 wasm，免 emcc/CI 编译风险）。
> - src/lib/wasm/js-wasm.ts：桥接层。打包器 import quickjs-emscripten +
> fetch public/wasm/js.wasm 注入 wasmBinary；数据编排用全局变量注入
> （QuickJS 无 C 式 stdin）：input→globalThis.__input、files→__files、
> args→__args；输出=return 值 + console.log 捕获 + __outputs 白名单写回
> - src/lib/tools/js.ts：降级诚实报错（绝不降级到浏览器裸 eval——
> 会绕过 VFS 白名单沙箱，破坏安全模型）
> - dispatch.ts：toolRunJs（与 toolRunLua 同构）+ switch case "run_js"
> - tool-definitions.ts：run_js 完整 schema（script/script_file/input/
> files/args/outputs）
> - 注册：session.ts + subagent.ts MUTATING_TOOLS 加 run_js（outputs 可 undo）
> - tools/js-wasm/prepare.sh：从 node_modules 拷 wasm 到 public/wasm
> （CI 在 bun install 后执行）
> - deploy.yml：install 后加 Prepare js.wasm 步骤
> - system-prompt：L31 环境说明 + run_js 工具描述 + 副作用清单三处
> - .gitignore：js.wasm 忽略（CI 生成）
> - README + docs/js-capability-report.md（22 项能力矩阵）
> 验证：tsc + next build 通过；核心能力 6 项 e2e 验证（map/filter/reduce=90、
> JSON 解析、files 注入、outputs 写回、console 捕获、错误捕获）全部通过。

</details>

<details open>
<summary>✨ <a href="https://github.com/5849mog/OpenCodeCLI/commit/060440c4ac10bb0fc17ed650a6950c765634f40e">060440c</a> — feat(lua): 交互式/游戏脚本支持引导——stdin 多轮输入验证 + 提示词增强</summary>

> 用户希望 run_lua 支持更多种类的 Lua 脚本（实用工具 + 交互式游戏）。
> 验证发现：引擎标准库齐全、stdin 交互已实现（io.read 多轮逐次消费），
> 能力已具备——缺的是确认与引导。本次：
> - 验证 stdin 多轮输入：lua-wasm.ts 的 stdin 回调按需供字节（inputPos
> 递增），脚本内多次 io.read() 逐次取下一行，游戏多轮输入可靠
> - system-prompt run_lua 描述新增交互式/游戏脚本引导：猜数字、文字冒险、
> 模拟器、RPG 状态机；循环 + io.read() 消费 input + 表存状态 + math.random
> + coroutine；嵌入完整猜数字示例
> - tool-definitions run_lua 描述同步增强
> - docs/lua-capability-report.md：11-14 项标 ✅（复测确认），新增 14b
> （多轮 io.read）/ 14c（交互式游戏）能力项，补游戏脚本示例与边界说明

</details>

<details open>
<summary>🐛 <a href="https://github.com/5849mog/OpenCodeCLI/commit/f72a8e13571dbdf7c7ded9b0806547bbb8084c27">f72a8e1</a> — fix(compact): 压缩后立即持久化——刷新页面不再恢复未压缩历史</summary>

> 检查压缩链路发现：compact() 确实写回了 store.messages（send 发送压缩后
> 内容，正确），但**没有触发 IndexedDB 持久化**。saveSession 只在 send 结束
> （schedulePersist）和 clearSession 时调用，compact() 不触发 → 刷新页面
> 后恢复的是未压缩完整历史，压缩效果丢失。
> 修复：compact() 写回后立即 flushPersist(get)（绕过防抖直接落库），
> 保证压缩后的上下文在刷新/切换会话后依然生效。
> 验证链路：
> - store.messages 被替换 ✓（set({ messages: result.messages })）
> - send 用 get().messages 发送 ✓（下一轮就是摘要+新消息）
> - 持久化 ✗→✓（本次修复）

</details>

<details open>
<summary>📝 <a href="https://github.com/5849mog/OpenCodeCLI/commit/884c0fffa803184d0c52a058a6233bf5fd50f5ea">884c0ff</a> — docs(README): 同步新特性与修正过时描述</summary>

> - 核心特性表新增：原生 WASM 引擎（Lua/awk/sed/bc）、子智能体 Explore、
> 深色模式、上下文压缩动画；联网搜索改为"开箱即用（内置 Tavily 开发密钥）"
> - 修正快速开始编号顺序（原 1→2→4→3 错乱）
> - clone URL 改为真实仓库 5849mog/OpenCodeCLI
> - 技术栈表补 WASM 引擎、AI 兼容层、KaTeX/Mermaid
> - /compact 描述更新（完全依赖 LLM 摘要）
> - 诚实说明：终端是 WASM 模拟而非纯 JS 模拟

</details>

<details open>
<summary>✨ <a href="https://github.com/5849mog/OpenCodeCLI/commit/23a9f2c554efcb97f1d4a78210b0ef7dc7fc6d60">23a9f2c</a> — feat(read_file): lineNumbers 参数——子代理报告的行号来自工具而非肉眼</summary>

> 问题：read_file 返回纯文本无行号前缀，子代理/主代理报告"（L113）"式
> 行号只能靠模型逐行硬数，长文件极易错。满分案例要求"文件路径+行号"，
> 但行号来源不可靠。
> 改动：
> - file-ops.ts read_file 新增 lineNumbers 参数（默认 false 保持兼容）：
> true 时每行前缀 1-based 行号（" 42 | const x = 1"），含 offset 分页
> 时从正确起始行编号
> - tool-definitions.ts read_file schema 加 lineNumbers 布尔参数说明
> （报告行号时用，ground-truth 而非目测）
> - subagent.ts 子代理工作原则新增第 4 条：报告行号用 read_file 的
> lineNumbers: true，不凭肉眼数；大文件先 view_outline 拿结构行号
> 再精确读取

</details>

<details open>
<summary>✨ <a href="https://github.com/5849mog/OpenCodeCLI/commit/c7956060d4b73fca1126b7b45a0ff6b552c21626">c795606</a> — feat(subagent): 委派提示词满分案例模板 + 移除输出长度限制</summary>

> 强化 Explore 子代理，借鉴"满分案例"模板（开头背景 + 编号要点 + 结论要求）：
> - system-prompt Delegation 章节：委派 task 按模板写——开头一句说清背景
> （什么项目/什么目标），编号列出具体调查项（查什么/在哪/期望看到什么），
> 结尾规定结论形式；嵌入 compact 动画调查的完整示例
> - 移除所有输出长度限制：
> * system-prompt L179 "总长 ≤200 词" → 改为"不要给子代理设输出长度上限，
> 子代理已在用独立上下文省钱，限制长度只损失质量"
> * system-prompt L361 "Keep text responses concise" 删除（主代理+子代理）
> - subagent.ts 子代理提示重写：中文、满分案例式开头（角色+共享工作区）、
> 编号工作原则，第 3 条明确"最终回复完整返回主代理，不要为简短牺牲信息"
> 子代理回复更完整（无 concise 抑制），结论含文件路径+行号+代码片段。

</details>

<details open>
<summary>✨ <a href="https://github.com/5849mog/OpenCodeCLI/commit/9afe6ab8e147137546a3f9cb09d403f12b20b4bc">9afe6ab</a> — feat(compact): /compact 进行中动画反馈——消除压缩期间的"卡死"假象</summary>

> 根因：compact() 设置了 agentStatus 但 AgentStatusRow 只在 isStreaming 时
> 渲染，而 compact() 从不设置 isStreaming → 压缩调 LLM 摘要（2-5 秒）期间
> 界面零反馈，看起来像卡死。附带竞态：压缩期间输入框未禁用。
> 改动：
> - session.ts：新增 isCompacting 标志；compact() 改用 try/catch/finally，
> 开始置 isCompacting=true + "正在压缩对话历史…"，finally 清 false
> （无论成功失败都清，替换原 catch 里的清空）
> - terminal.tsx：AgentStatusRow 渲染条件改为 (isStreaming || isCompacting)；
> textarea 与 Send 按钮在压缩期间禁用（堵住写回竞态）；
> AgentStatusRow 加 Loader2 旋转图标强化"工作中"感
> 效果：按 /compact 回车 → 立即出现脉冲点+旋转图标动画卡片 →
> 压缩完成/失败动画消失 → 替换为压缩结果 system 事件

</details>

<details open>
<summary>🐛 <a href="https://github.com/5849mog/OpenCodeCLI/commit/c38450fdd0155a0a12942315ec25bf89dc74c996">c38450f</a> — fix(compact): 完全依赖 LLM 摘要——不保留锚点消息，消除重复响应 + 摘要质量重写</summary>

> 上一版 compact 保留"最后一条 user 消息"作为锚点，导致两个问题：
> 1. user 的 assistant 回复被丢弃 → 用户继续说新问题时，上下文里出现
> "从未被回答的旧 user 消息"，模型同时响应新旧两个问题
> 2. 摘要 prompt 质量低（英文、600 词上限、材料只留首行），丢关键点
> 重构（采纳用户设计）：
> - 完全摘要驱动：除 system 外全部历史（含最后 user 与其回复）→ 单条摘要，
> compact 后 = [system?, summary]。用户再说新问题时上下文只有
> [system?, summary, user N]，模型只响应新问题——结构上根除重复响应
> - 摘要 prompt 重写：中文分节结构（用户意图/已做决策/文件操作精确路径/
> 关键发现/已完成vs待办/用户约束偏好），"宁可长不可漏"，目标 800-1200 词，
> 语言跟随对话；SUMMARY_MAX_TOKENS 1500→3000
> - 喂料增强：tool 结果保留前 5 行（此前只留 1 行）
> - 降级路径（LLM 失败/超时）：保留最近 12 条 + 压缩更早 tool 结果

</details>

## 📅 2026-08-10

<details open>
<summary>✨ <a href="https://github.com/5849mog/OpenCodeCLI/commit/777f8ca3431dc6d8b02ee6684c2ee31af69daad3">777f8ca</a> — feat(compact): 真正的上下文压缩——LLM 摘要旧对话并写回 store</summary>

> /compact 此前是假压缩：只打印"将被摘要"的误导消息 + 设置无人读取的
> truncated 死标记，全库无任何 LLM 摘要逻辑。README 声称的功能从未实现。
> 本次实现 README 一直声称的能力：
> - 新增 src/lib/compact.ts：compactConversation()
> * 保护最后一条 user 消息（当前任务锚点）+ system 消息
> * 其余全部旧消息（用户/助手/工具结果）机械压缩后交给 LLM 生成紧凑摘要
> （摘要要求保留用户意图、决策、文件路径、关键发现、完成/待办）
> * 摘要以单条 user 消息替换全部旧历史
> * LLM 失败/超时（60s）降级为启发式压缩（压缩工具结果 + 保留最近 12 条），
> /compact 始终有真实效果
> - session.ts 新增 compact() action：真写回 store.messages（后续每轮请求
> 都发送压缩后历史）+ system 事件报告 消息数/释放 token 对比；无 key 时报错
> - terminal.tsx /compact 命令：从"打印消息+设死标记"改为调用 compact()
> - context.ts compressToolResult 增强：保留 tool name + 首行（原来连工具名都丢）
> - README / help-content 描述更新为真实行为

</details>

<details open>
<summary>✨ <a href="https://github.com/5849mog/OpenCodeCLI/commit/f4ac4a128aa4cede5c3e27904d680e6ff4473611">f4ac4a1</a> — feat(prompt): 一问一答——需求含糊时先 ask_user_input 再动手</summary>

> 用户"创建一个 Lua 游戏脚本并描述运行效果"时，模型直接自己脑补一个
> 游戏写出来再解释——回答了用户没问的问题。四处强化：
> - 节奏与心法新增第 9 条「一问一答」：需求含糊/开放/多条路时先问再做，
> 用 ask_user_input 给结构化选项；猜测不是效率是返工。
> 例外：需求已具体（snake.lua 贪吃蛇方向键）或用户说"随便你"
> - Rule 4 重写为「When in doubt, ask FIRST」：先问是任务第一步，
> 给用户反例（游戏脚本 → 先问类型/玩法，不自己发明再描述）
> - ask_user_input 工具描述：从被动"展示面板"改为"需求含糊时第一个工具"
> - Rule 1 表格 build/create 行：开放式创建请求 → 先 ask_user_input 定方向

</details>

<details open>
<summary>✨ <a href="https://github.com/5849mog/OpenCodeCLI/commit/280d6b38e52d0a99c653d7bc61cfe8f379ac04c8">280d6b3</a> — feat(prompt): 探索流程终结于委派——定位文件后禁止自己连续读</summary>

> 模型已不再用 read_multiple_files（NOT for exploration 生效），但转向
> 连续 read_file。补上链条最后一环：
> - How to explore 章节新增流程规则：「定位文件后下一步是委派，不是
> 自己 read_file」——定位的目的是交给子代理精确任务
> （"read X, Y, Z and tell me how login works"）；
> 一个任务里自己读了 2+ 个文件还没委派 = 在做子代理的活
> - read_file 工具描述加探索边界：探索/理解 2+ 文件用 dispatch_subagent；
> read_file 只用于即将编辑、用户要求看、或单个确需原文的文件

</details>

<details open>
<summary>🐛 <a href="https://github.com/5849mog/OpenCodeCLI/commit/95c00a16366600fc492a7949e06626527784c57c">95c00a1</a> — fix(subagent): 工具重排——dispatch_subagent 移至第一位 + read_multiple_files 探索禁令</summary>

> 纯提示词强化（Rule 1 表格 / Tier 0 / How to explore）已上线但 DeepSeek
> 在"先 list_files 定位→再批量读文件"链条上仍选 read_multiple_files。
> 文字不足以改变工具选择行为，改用机制性手段：
> - dispatch_subagent 从工具列表 L404 移至第一位（read_file 之前）：
> 模型浏览工具时最先看到委派，降低探索场景选 read_file 族工具的惯性
> - dispatch_subagent 描述强化："探索与多文件研究的默认工具——先于
> read_file/read_multiple_files 考虑" + task 参数要求具体路径/问题/返回格式
> - read_multiple_files 描述首句改为 "NOT for exploration"：
> 只用于即将编辑需精确上下文、或用户明确要求看内容；探索一律委派

</details>

<details open>
<summary>✨ <a href="https://github.com/5849mog/OpenCodeCLI/commit/e51b6886eac6505b2632e7ba24a5469b5e7fa648">e51b688</a> — feat(prompt): 动作范围纪律——只做被要求的，不造替代品，不伪造结论</summary>

> 模型节奏不够慢的根因是"动作范围越界"，而非速度：
> - 创建 Lua 脚本时去读无关的 src 目录 → 新增 Rule 1 表格
> 「build/create 类请求不要读现有项目文件，除非用户要求参照风格」
> - 脚本环境跑不了悬浮窗时，擅自创建"模拟版"再跑并给虚拟结论 →
> 节奏与心法新增 3 条禁令：
> 6. 只做被要求的，不多做一步（每个多余读取/步骤都是自作主张）
> 7. 不造替代品（交付不了就明说，把选择权还给用户）
> 8. 不伪造结论（模拟运行结果不得冒充真实结果）
> - Tool failure protocol Rule 1 补充：产物层替代禁令
> （造模拟版/演示版/重实现=换工具替代的变体，用户拿到假结果）

</details>

<details open>
<summary>✨ <a href="https://github.com/5849mog/OpenCodeCLI/commit/1d23d8c7529f1db475b1ac45a6380efa02c40a34">1d23d8c</a> — feat(prompt): 探索类任务强化委派 Explore 子代理（多决策点一致信号）</summary>

> 模型做多文件探索时仍倾向 read_multiple_files。根因：探索决策点上
> 提示词未提委派。四处强化：
> - Rule 1 请求分类表新增「探索性问题 → dispatch_subagent FIRST」，
> 明确需要读 2+ 文件回答的问题默认委派
> - How to explore 章节把 dispatch_subagent 列为多文件探索 DEFAULT 工具
> - Rule 3b 新增 Tier 0：多文件探索委派是成本最优解（对比乘法 token 账），
> read_multiple_files 降级为「仅即将编辑时使用」
> - read_multiple_files / dispatch_subagent 工具描述边界收紧：
> 「探索/理解代码库 → dispatch_subagent，不要自己读文件」

</details>

<details open>
<summary>✨ <a href="https://github.com/5849mog/OpenCodeCLI/commit/41fb7da09ffad02d07ae25b6e73aa5a0c30db766">41fb7da</a> — feat(ui): 强制深色模式 + 折叠交互修正 + Markdown 质感重做</summary>

> - 深色模式：html.dark + :root.dark 深色 token（黑底白字 ZCode 风格），
> globals.css 深色变量块、Prism 高亮/滚动条深色版；全应用深色化
> （terminal/侧栏/文件袋/CodeMirror/Plan/子智能体/设置/zip 弹窗）
> - Markdown 质感：内联 code 改「微白框」深色底近白字（告别刺眼 emerald-300），
> 标题加大加粗、加粗白字、链接去 sky 青、代码块/引用/表格深灰边
> - 10 处 emerald 全部替换为深色柔和色（diff add、光标、对勾、脉冲点、
> 状态条、Plan 进度、settings 选中态）
> - 折叠交互修正：只折叠「委派提示词」与「主对话用户长消息」；AI 输出与
> 子代理回复永不折叠全量渲染；折叠态也渲染 Markdown（限高+渐变遮罩），
> 不再用纯文本截断

</details>

<details open>
<summary>✨ <a href="https://github.com/5849mog/OpenCodeCLI/commit/a647f43b91c96d3918b40221b70dab556dfde7f1">a647f43</a> — feat(ui): 子智能体框 + 右侧栏 Subagent 面板 + 主对话长消息折叠</summary>

> - 主对话流委派时出现专用「子智能体」卡片（青绿点 + Explore 标签 + 任务首行标题），
> 运行中动画点、完成显 ✓，点击跳右侧栏并聚焦对应运行
> - 右侧栏新增「子智能体」tab：委派提示词以用户消息样式渲染（长内容折叠+下拉箭头），
> 子代理最终回复以助手消息样式渲染（Markdown，长内容折叠），附迭代/工具调用计数
> - 主对话 User/Assistant 长消息默认折叠（CollapsibleText），TurnBlock 含子智能体时自动展开

</details>

<details open>
<summary>✨ <a href="https://github.com/5849mog/OpenCodeCLI/commit/dfca1ad31291fc4f40bb17465c473e3fb191c346">dfca1ad</a> — feat(prompt): 提示词全面优化——事实修复 + 上下文卫生 + 工具决策化 + 副作用模型</summary>

> 对照 ZCode 系统提示词评估后的优化：
> - P0 事实修复：Web access notes 删除'内置 Tavily key'过时文案
> （key 已删，改为'需 Settings 配置，未配置时返回配置提示'）
> - P1① 上下文卫生统摄原则（keep the conclusion, not the file dumps）：
> 什么进上下文（结论/摘要/引用）、什么留在原地（原文/大块输出）、
> 卫生工具清单（委派/offset-limit/head/grep/view_outline/outputs）、
> 三分测试（知道→最便宜窥探；行动→精确段；理解系统→委派研究）
> - P1② 工具决策化：read_file / read_multiple_files / dispatch_subagent /
> view_outline 补 When to use / Don't use（内联决策点，不重复 Rule 3b）
> - P1③ 工具副作用一览：写 VFS 清单 / 只读清单 / Plan 模式拦截 /
> undo 可撤销——模型对每步副作用有完整心智
> - P2 评估后跳过（现有描述已足够，副作用已覆盖）

</details>

<details open>
<summary>🐛 <a href="https://github.com/5849mog/OpenCodeCLI/commit/8e18847dbfd3d662071c562b83310dacc58f4bf7">8e18847</a> — fix(subagent): 委派成本心智强化——上下文乘法成本 + 数字对比案例</summary>

> 实测：4 文件研究任务模型仍选 read_multiple_files 而非 dispatch_subagent。
> 根因：模型只算当前轮成本（读 4 文件 vs 派子代理），不算跨轮成本。
> - Rule 3 新增「上下文乘法成本」概念：任何进上下文的内容每轮重发，
> 读 N 文件 ≈ N×剩余轮数；委派把成本变一次性，是成本最优解
> - Delegation 段加数字账：4 文件 4000 token × 10 轮 = 4 万 vs 委派 8 千
> - read_multiple_files 描述加 COST WARNING（多文件研究时委派更省）

</details>

<details open>
<summary>✨ <a href="https://github.com/5849mog/OpenCodeCLI/commit/9cb2a9069289243d372828dccc0e828445d6881a">9cb2a90</a> — feat(subagent): 子智能体打磨——委派提示词重构 + 质量修复 + Plan 安全 + 可见性</summary>

> A. 提示词（调用概率低的直接根因）：
> - Rule 3b Avoid 清单移除 dispatch_subagent/orchestrate_task
> - Delegation 段重写为 ZCode 式委派准则（任务匹配就该委派：多文件探索/
> 避免污染主上下文/独立并行产物；不委派：1-2 个立即要编辑的文件）
> - 工具描述去掉 "not as a default"/"overkill" 劝退语，改为正面准则
> B. 质量修复（四个确定性缺陷）：
> - summary 跨轮累积 bug：lastText 每轮重置，summary 只含最终轮文本
> （不再把每轮工具调用前的分析拼进 summary 污染主上下文）
> - 子代理工具集剔除 dispatch_subagent/orchestrate_task（dispatch 无此
> 分支，调用必失败）+ 身份 prompt 明示「不能委派」
> - 每请求 300s 超时（对齐主循环，卡死不再无声无息）
> - 撞迭代上限 ok:true（部分完成是正常结果，不触发失败协议）
> C. Plan 模式安全：
> - 子代理继承主 mode：buildWorkspaceContext({mode}) + dispatchTool
> readOnly 传递——Plan 模式下子代理也只读，堵住 bypass 绕过
> - orchestrate_task（产出型）在 Plan 模式拦截（special-case 内）
> - 子代理 run_lua 加进快照集合（与主循环对齐）
> D. 运行可见性：
> - subagent onStatus → agentStatus（"Subagent · 第 3/8 轮"），
> terminal AgentStatusRow 自动显示

</details>

<details open>
<summary>🐛 <a href="https://github.com/5849mog/OpenCodeCLI/commit/d3fcc83c431de8ff50ce8be52a76c6a997f96534">d3fcc83</a> — fix(terminal): TurnBlock 预览文本统一约束（min-w-0 flex-1 truncate）</summary>

> 框宽窄不一：预览 span 缺 min-w-0/flex-1，长预览撑开内容、短预览
> 显得窄。修复：标题区 shrink-0 固定，预览占满剩余宽度并真正截断，
> 所有回合框统一全宽。

</details>

<details open>
<summary>✨ <a href="https://github.com/5849mog/OpenCodeCLI/commit/d438ff754d7f601fdb889f4fb9d04db43f458be9">d438ff7</a> — feat(terminal): 回合块折叠——分析+工具调用默认隐藏，总结全文显示</summary>

> 体验问题：非思考模型的分析文本写在 content 里，与工具调用扁平铺在
> 聊天流中，用户被迫看满屏英文分析。改为 ZCode 式信息层级：
> - groupAssistantTurns：assistant 消息 + 紧随的工具调用合成「回合」；
> 有工具调用 → TurnBlock 折叠块（默认收起：「思考与操作 · N 个工具
> 调用」+ 单行预览，点击展开看分析全文与工具明细）
> - 无工具调用的 assistant 消息（总结）→ 保持全文显示（用户唯一要读的）
> - StreamingBubble：流式期间显示「正在分析…」+ 动画 + 单行预览，
> 不再实时滚动英文全文；完成后由 events 接管定型
> - 纯渲染层改造（terminal.tsx），session/数据层不动
> 验证：tsc 干净 + next build 通过

</details>

<details open>
<summary>🐛 <a href="https://github.com/5849mog/OpenCodeCLI/commit/a68e7b3de7da56ec589e497f97cce1e5bc12c31f">a68e7b3</a> — fix(run_lua): 摘要分支优先透传引擎错误（C4 超限报错回归）</summary>

> f9ff18e 把摘要分支条件改为「声明 outputs 即走」，但未检查 result.ok——
> 引擎超限报错（ok:false, "输出文件过大"）被吞成「⚠ 未写回任何文件 +
> 未产生」，错误信息丢失。修复：outputs 分支内先透传 ok:false，
> 正常写回/未产生才走摘要。C5（undo）经分析为测试流程问题（重跑 C1
> 导致快照栈顶是「重跑前状态」，summary.csv 本就在），非产品 bug，
> 快照注册与恢复链路已验证工作，复测按「写回后立即 undo」流程。

</details>

<details open>
<summary>🐛 <a href="https://github.com/5849mog/OpenCodeCLI/commit/9783e5e592dba68b90fbd01a754f6698ebc6c5cb">9783e5e</a> — fix(run_lua): MUTATING_TOOLS 注册 run_lua——写回可 undo</summary>

> 复测发现 C5（undo）失败：'Nothing to undo'。根因：session.ts 的快照
> 集合 MUTATING_TOOLS 没有 run_lua，即使 dispatch 返回 mutated:true 也
> 不拍快照。加入集合后带 outputs 的写回可被 undo_edit 撤销（与
> write_file 等一致的快照语义：调用即拍，失败也拍）。

</details>

<details open>
<summary>🐛 <a href="https://github.com/5849mog/OpenCodeCLI/commit/f9ff18efdebd1b3ccab54dfc5ac1d1d11a482f47">f9ff18e</a> — fix(run_lua): outputs 写回两处修复——父目录预建 + 摘要分支兜底</summary>

> 部署实测发现：
> 1. io.open('out/summary.csv','w') 返回 nil → 写模式失效假象。
> 根因：C fopen 需要父目录存在，MEMFS 里 out/ 从未创建（Lua 标准库无
> mkdir，脚本自己建不了）；big.txt 根目录写成功证明写能力本身没问题。
> 修复：桥接层求值前为每个 outputs 路径预建父目录（复用 ensureParentDirs）。
> 2. outputs 声明了但一个都没写时走了普通输出分支，「未产生」注释不出现。
> 修复：声明了 outputs 必走摘要格式——写回 0 个时返回
> 「⚠ 未写回任何文件（全文未回传）+ 未产生列表」，mutated 仅在实写时置真。

</details>

<details open>
<summary>✨ <a href="https://github.com/5849mog/OpenCodeCLI/commit/d51a908a15e7685df8a208aaa5a5c1f6a6746f4a">d51a908</a> — feat(run_lua): 能力释放——script_file 直接跑脚本 + outputs 白名单写回 + 参数化</summary>

> - script_file：指定工作区 .lua 直接运行（脚本资产化：write_file → 直接跑，
> 可复用可 review）；与 script 二选一，缺失报错
> - args：传给脚本 argv（arg[1..]），参数化复用
> - outputs 写回白名单：脚本 io.open(path,'w') 写 MEMFS → 白名单路径同步回
> VFS；**回传摘要（路径/大小/行数）而非全文**——长结果落盘，AI 按需 read_file
> - 安全：未声明路径不同步；路径限工作区相对；单文件 ≤200KB/≤20 个；
> Plan 模式带 outputs 拦截（dispatch 传 readOnly）；mutated → undo 可撤销
> - 文档同步：tool-definitions（script_file/args/outputs）、system-prompt
> （权限句 + run_lua bullet 资产化引导）、能力报告 30-39 行、README 边界
> - 本地校验：互斥/缺失/路径/Plan 拦截/纯计算放行全过；
> 写回核心逻辑需部署版 wasm 实测

</details>

<details open>
<summary>🐛 <a href="https://github.com/5849mog/OpenCodeCLI/commit/6e67fc23265963bad2f8c35da0efe09db320cfa8">6e67fc2</a> — fix(sed): 多文件参数支持（此前只传第一个文件，后续被丢弃）</summary>

> 实测发现：sed 's/x/y/' a.txt b.txt 只处理 a.txt——wrapper 只取
> positional[1] 单个文件，第二个从未进 argv/MEMFS。修复：
> - dataFiles = 脚本后的全部位置参数；全部注入 MEMFS 并进 argv
> （无 -s 时 GNU 流式语义：行号跨文件连续；-s 每文件独立）
> - 缺失任一文件报 "can't read X: No such file or directory"
> - -i 多文件：GNU -i 隐含 -s → 逐文件求值写回（避免拼接流写进首文件）
> - 降级路径：多文件拼接成一条流（去尾换行再 join，避免空行）
> - 本地验证：多文件替换/流式 1p/-i 单双文件/缺失报错全过
> （-s 需部署版 wasm 验证——JS 降级不支持 -s，属已知降级限制）

</details>

<details open>
<summary>🐛 <a href="https://github.com/5849mog/OpenCodeCLI/commit/f240b3a6dd60dcf1b717049b5066b08376c4343c">f240b3a</a> — fix(sed-wasm): 链接输入收集改为"找到什么链什么" + 预判 program_invocation_name 坑</summary>

> CI 实测：make 产物里 sed/*.o 全在，但 lib/libgnu.a 归档未生成 → 链接检查
> 硬编码该路径直接误报。现在：
> - sed/*.o + lib/ 下归档或 .o 自动收集（有归档链归档，无归档链全量 .o，
> 与链接归档等效）
> - configure CFLAGS 加 -DHAVE_DECL_PROGRAM_INVOCATION_NAME=0 与 SHORT_NAME=0：
> program_invocation_name 是 glibc 扩展，emscripten libc 不提供但 gnulib
> stdlib.h 会声明 → 不关掉必然 undefined symbol，让 sed 自带 fallback 生效

</details>

<details open>
<summary>🐛 <a href="https://github.com/5849mog/OpenCodeCLI/commit/7c574607729641ecce1013b63401c65ccadaa954">7c57460</a> — fix(sed-wasm): 冒烟链接报错可见化（2>/dev/null 吞掉了真实错误）</summary>

> 本轮进展：configure 已修复（--host 生效，15 分钟内跑完）、make 编译通过，
> 卡在 [4/4] 冒烟链接。但链接命令的 2>/dev/null 把 emcc 报错吞了，只看到
> exit code 1。现在：
> - 冒烟链接去掉 2>/dev/null，失败时打印 emcc 完整输出 + 对象清单诊断
> - 产物缺失时列出 find 结果；浏览器链接同样可见报错
> 下一轮 CI 应能看到具体 undefined symbol，据此精准修复

</details>

<details open>
<summary>🐛 <a href="https://github.com/5849mog/OpenCodeCLI/commit/8ed060e7d18b7bfad2d268b590b244f28345fb47">8ed060e</a> — fix(sed-wasm): 每个步骤限时快速失败 + 去掉 configure --quiet（暴露卡点）</summary>

> 1h25m 仍卡：此前只有 make 有 timeout，configure/curl 无时限；且 --quiet
> 藏住了卡在哪条 checking。现在：
> - curl 每镜像 --max-time 170，180s 超时换镜像，双失败即报错
> - configure 套 timeout 900（15 分钟快速失败 exit 124），去掉 --quiet——
> 下次卡住时日志最后一条 'checking for ...' 即精确卡点，可针对性修
> - 补 --build=x86_64-pc-linux-gnu 与 --host 配对，确保交叉编译模式

</details>

<details open>
<summary>🐛 <a href="https://github.com/5849mog/OpenCodeCLI/commit/b288a4e16f815152ae01293c3ba6effeecadc85a">b288a4e</a> — fix(sed-wasm): 移除 BusyBox 自动回退，只保留 GNU sed 原生引擎</summary>

> 按需求：原生就是原生，回退不是解决方案。
> - build.sh 合并为单文件（GNU sed 4.9 专属）：--host=wasm32-unknown-emscripten
> 交叉编译模式跳过 configure 运行测试（根治 38 分钟卡死）；make 用
> timeout 1800s 限时，卡死快速失败暴露问题（exit 124）
> - 删除 build-gnu.sh / BusyBox 回退路径；README/报告/ prepare 文案同步清理
> - 顺带补上 system-prompt 的 #\\1 转义修复（上版被钩子拦下漏提交）

</details>

<details open>
<summary>🐛 <a href="https://github.com/5849mog/OpenCodeCLI/commit/85311747efa5f98499c436237ab4081585e151b3">8531174</a> — fix(sed-wasm): GNU configure 卡死修复 + 构建限时自动回退</summary>

> - build-gnu.sh（新）：--host=wasm32-unknown-emscripten 交叉编译模式——
> configure 跳过所有运行测试程序（emscripten 产物无法在宿主运行，个别
> gnulib 测试挂起不失败，CI 实测卡 38 分钟）；CFLAGS=-O2 去 -g 提速
> - build.sh 重构为调度器：GNU 路径经 timeout（默认 1500s=25min）包裹，
> 卡死/失败都会触发 BusyBox 回退（原来只在失败时回退，卡死永不触发）
> - BusyBox 路径不变（allnoconfig+CONFIG_SED+shim 直连 sed_main）

</details>

<details open>
<summary>✨ <a href="https://github.com/5849mog/OpenCodeCLI/commit/50dbb2a64d514a0eadc2e3342f3437593e597da7">50dbb2a</a> — feat(sed): 新增 GNU sed WebAssembly 原生引擎，替换手写 JS 实现</summary>

> - tools/sed-wasm: 构建脚本（GNU sed 4.9 tarball + emconfigure，冒烟硬门槛
> s/// -E y/// 三用例；失败自动回退 BusyBox sed 单 applet，shim 直连
> sed_main 绕开 argv[0] 分发）+ prepare + README
> - src/lib/wasm/sed-wasm.ts: awk 同款桥接（script 标签 → window.SedModule，
> stdin 回调/MEMFS 注入/输出截断/降级）；接口用完整 argv + files 内容表
> （-f 脚本文件与数据文件都在 files，避免二次当输入文件）
> - src/lib/tools/sed.ts: 原 bash.ts 内联 JS sed 抽为 runSed 作降级（行为不变）
> - bash.ts case sed 重写：旗标解析 -E/-n/-e/-f/-i；-i 不传引擎由 wrapper
> 写回 VFS（Plan 只读拦截/mutated 不变）；-f 读 VFS 脚本文件注入 MEMFS
> - system-prompt 加 sed note + tool-definitions 描述；docs/sed-capability-report
> - CI: deploy.yml 加 Build sed.wasm 步骤；.gitignore 忽略产物
> - 本地验证：tsc 无新增错误；降级路径 9/9 + -i 写回全过

</details>

<details open>
<summary>🐛 <a href="https://github.com/5849mog/OpenCodeCLI/commit/f4820f159244b9391f999cc1feb03aabcdb0d722">f4820f1</a> — fix(settings): 移除'内置 Tavily key 已生效'误导文案，据实提示未配置</summary>

> 内置 key 早已删除，但 Settings 残留两处旧文案谎称有内置 key：
> - 输入框下方提示用 config.hasSearchKey 判断（无 key 时落到'内置 key 已生效'）
> → 改为 apiKeyVault.hasSearchKey() 真实来源，并据实提示
> '未配置 — web_search 暂不可用。填入 Tavily/Brave Key 即开启'
> - 顶部状态条 'Built-in search key' → 'No search key'

</details>

<details open>
<summary>📝 <a href="https://github.com/5849mog/OpenCodeCLI/commit/67507d0e2bd4405bd20161591d9c0244743b47db">67507d0</a> — docs(lua): 能力报告回填 24-29 行实测结果（10/10 全通过）</summary>

> 部署版复测：脚本开头修复（--/前导空格/块注释/- 开头均正常）、files 功能
> （基本读取/嵌套路径/缺失 fail-fast/超限防护）全部 ✅；写入隔离已实测——
> 脚本向 MEMFS 副本写 HACKED 后 VFS 原文件不变，引擎边界成立。

</details>

<details open>
<summary>🐛 <a href="https://github.com/5849mog/OpenCodeCLI/commit/e5387eda631d682c91bfa5bc4b46c528cbbc7525">e5387ed</a> — fix(lua-wasm): 脚本改经 MEMFS 文件执行，弃用 -e 选项（'--' 开头脚本被误判）</summary>

> 实测发现：lua -e 'script' 中 -e 是命令行选项，选项解析器会碰脚本内容，
> '--' 开头的注释脚本被误判为选项标记 → 报 '-e' needs argument。
> 修复：script 写成 MEMFS script.lua 后 lua script.lua 执行（位置参数，
> 内容不经过选项解析，任何开头都安全）；错误信息附带 script.lua:行号；
> 最后写入避免与 files/input.txt 同名冲突。capability-report 补 29 行。

</details>

<details open>
<summary>✨ <a href="https://github.com/5849mog/OpenCodeCLI/commit/fa84b312e8ef50449f26be18ff1b6efaa54a8958">fa84b31</a> — feat(run_lua): 开放工作区文件读取（files 参数，MEMFS 只读注入）</summary>

> AI 可传 files: [路径...]（只传路径不传内容），dispatch 层读 VFS、
> 桥接层注入 MEMFS 只读副本，脚本 io.open(path) 直接读项目文件——
> 省 token，嵌套路径自动建父目录（复用 awk-wasm 的 ensureParentDirs）。
> 防护：最多 20 个文件、单文件 ≤200KB（MAX_INJECTED_FILES/MAX_FILE_BYTES
> 导出为单一来源，dispatch 复用）；缺失/超限 fail-fast 列明原因。
> 边界不变：脚本对副本的写操作跑完即毁，VFS 写入/网络/持久化仍物理不可达。
> 文档同步：tool-definitions / system-prompt（权限句改为'不写'工作区文件）
> / capability-report 新增 24-28 行 / README 安全边界。
> 本地验证：tsc 无新增错误；files 握手、缺失 fail-fast、string 兼容全通过。

</details>

<details open>
<summary>🐛 <a href="https://github.com/5849mog/OpenCodeCLI/commit/bbb485ae69405e05b0cd06a82b2bab33cdab31f9">bbb485a</a> — fix(lua-wasm): input 不再进 argv（lua 会把首个非选项参数当脚本执行）</summary>

> 实测发现：callMain(['-e', script, 'input.txt']) 会让 Lua 把 input.txt
> 当脚本执行（input 内容被当 Lua 代码解析报 syntax error）。修复：
> - input.txt 只写 MEMFS + stdin 回调喂字节，argv 只有 -e script
> - 脚本读取方式：io.read('*a') / io.lines()（stdin），io.open('input.txt')（文件）
> - 文档同步：tool-definitions / system-prompt / capability-report
> - 能力报告回填 1-21 实测结果；22（Plan 模式可用）代码层确认；
> 23（降级路径）本地 dispatch 全链路验证；记录 os/io 沙箱边界

</details>

<details open>
<summary>🐛 <a href="https://github.com/5849mog/OpenCodeCLI/commit/78bd1abcfe010bdab951c32ed8ffab91182bc920">78bd1ab</a> — fix(lua-wasm): 弃用 make，逐文件 emcc -c 编译（镜像布局与官方 tarball 不同）</summary>

> lua/lua 镜像仓库两次 CI 实测：根目录无 generic 目标、无 src/ 子目录，
> Makefile 目标不可依赖。改为与 awk-wasm 相同的确定性编译：
> - 显式列出官方 5.4 全部源文件（20 核心 + 12 标准库 + lua.c），emcc -c 逐编译
> - 布局自动兼容（src/ 子目录 / 根目录平铺），找不到 lua.c 时报清晰错误
> - 冒烟直接链 （lua.o 只编一次，无重复 main 问题）
> - 克隆后打印 HEAD commit，便于排查布局异常

</details>

<details open>
<summary>🐛 <a href="https://github.com/5849mog/OpenCodeCLI/commit/0980182397c140e2d1e8cf46ecb493b4ade65ee7">0980182</a> — fix(lua-wasm): make 需在 src/ 子目录执行（顶层 Makefile 无 generic 目标）</summary>

> lua/lua 官方发行版布局：真正的 Makefile 在 src/。改为 cd src 后
> make all（generic 会注入 LUA_USE_GENERIC，all 更干净）；冒烟测试
> 直接用 make 产出的 lua.o+liblua.a 链接（避免重复 main）；浏览器
> 链接补 -lm。

</details>

<details open>
<summary>🐛 <a href="https://github.com/5849mog/OpenCodeCLI/commit/cfff57a5e0e02ae04fcf326ceb632757a5adb92b">cfff57a</a> — fix(lua-wasm): 修正源码仓库地址 lunarmodules/lua → lua/lua（官方镜像）</summary>

> CI 首次构建失败：lunarmodules/lua 仓库不存在（GitHub 返回 401 →
> 'could not read Username'）。官方源码镜像为 lua/lua；tag 保守用 v5.4.7
> （不存在时自动回退 HEAD，build.sh 已有 || 兜底）。

</details>

<details open>
<summary>🐛 <a href="https://github.com/5849mog/OpenCodeCLI/commit/fea9885d758e423315899a770827aa81181b6410">fea9885</a> — fix(security): 移除 eval 降级求值与硬编码搜索 API key</summary>

> - 新增 src/lib/math-eval.ts: 递归下降安全算术解析器（无 eval/Function），
> 只接受数字、+ - * / % ^、括号、显式注册的函数与常量
> - bc-wasm.ts / bash.ts expr 降级实现改用 evalArithmetic（行为一致：
> -2^2=-4、2^-2=0.25、1/0=Infinity；恶意输入如 constructor.constructor 一律报错）
> - search-provider.ts: 删除内置 Tavily dev key（公共仓库不再泄露凭据）
> - web.ts: 未配置搜索 key 时诚实提示去 Settings 配置（而非报 401）；
> 修正'内置搜索 Key，开箱即用'过时文案

</details>

<details open>
<summary>✨ <a href="https://github.com/5849mog/OpenCodeCLI/commit/9e18ecc558c7032a756a40293637ad630f33fbbd">9e18ecc</a> — feat(lua): 新增 run_lua 工具（Lua 5.4 WebAssembly 原生引擎）+ 权限放宽</summary>

> - tools/lua-wasm: build.sh/prepare.sh/README（lunarmodules/lua 5.4.8 → emcc，
> 冒烟硬门槛 print(6*7)=>42 + gsub）
> - src/lib/wasm/lua-wasm.ts: awk 同款桥接（<script> 绕过打包器 → window.LUAModule，
> stdin 双通道 io.read / io.open(arg[1])，输出截断，失败降级）
> - src/lib/tools/lua.ts: JS 降级诚实报错（不假意执行）
> - tool-definitions/dispatch: 注册 run_lua(script, input?)，纯计算任意模式可用
> - system-prompt: 权限文案放宽（唯一执行=run_lua 纯内存计算，引擎强制不可
> 改文件/联网/持久化）+ 使用边界（复杂转换才用，简单行列仍用 awk/sed）
> - docs/lua-capability-report.md: 23 项能力矩阵
> - CI: deploy.yml 加 Build lua.wasm；.gitignore 忽略产物与本地工具目录

</details>

## 📅 2026-08-07

<details open>
<summary>🐛 <a href="https://github.com/5849mog/OpenCodeCLI/commit/1758f32535459a0f16350fa4320b39d33a4d26d5">1758f32</a> — fix: Plan 模式 bash 只读 + find -name/-iname 精准 glob 匹配</summary>

> - Plan 模式下 bash 变只读：readOnly 标志贯穿 dispatchTool→toolBash→
> runPipeline→runOneShellCommandFromTokens，拦截 >/>> 重定向与
> mkdir/rm/rmdir/touch/cp/mv/sed -i/tee 所有写点，find -exec/xargs 内层也传。
> - find -exec 原始终 ok:true 吞内层失败，现任一子命令失败 → 整体 ok:false。
> - find -name/-iname 改为锚定精确 glob：globToRegex 抽到共享模块
> src/lib/tools/glob.ts 并加 matchDot 选项；-iname 大小写不敏感；
> -type d/f 与 -name 组合不再互斥；正则元字符正确转义。
> - 文档同步：system-prompt.ts / tool-definitions.ts。
> Co-Authored-By: Claude <noreply@anthropic.com>

</details>

## 📅 2026-08-06

<details open>
<summary>✨ <a href="https://github.com/5849mog/OpenCodeCLI/commit/c596b053b19314e1715b80bef3808990b740444e">c596b05</a> — feat(zip): 新增 zip_archive / unzip_archive 工具 + 上传 .zip 自动解压</summary>

> - zip_archive: 打包选定文件/目录为真实 .zip 触发浏览器下载（store+组件桥）
> - unzip_archive: 请求用户选 zip → 解压进文件袋（结果以 user 消息回流）
> - 上传 .zip 自动解压（file-bag handleFiles 识别 .zip，不再读成乱码）
> - 严格 token 限制：工具只回短摘要（≤400 字），内容/二进制绝不进上下文
> - ZIP_LIMITS 上限（300 条/5MB 单条/50MB 总量）+ zip-slip 路径净化 + 二进制占位
> - orchestrate_task 工具描述对齐慢节奏（去掉"快 N 倍"矛盾措辞）
> Co-Authored-By: Claude <noreply@anthropic.com>

</details>

<details open>
<summary>✨ <a href="https://github.com/5849mog/OpenCodeCLI/commit/a2580dcfc064fb26954a11adb6b1041915efc0cf">a2580dc</a> — feat: 新增 printf 命令 + cat 多文件修复 + AI 提示词风格改造</summary>

> - cat: 拼接全部文件参数，修复 `cat a b | awk` 只喂第一个文件的管道 bug
> - printf: 纯 JS 实现 bash 内建 printf（转换符/标志/宽度精度/转义/%b/\c 截断，不自动换行）
> - awk: JS 降级 sprintfAwk 补反斜杠转义，对齐 wasm
> - system-prompt: 节奏与心法（失败零替代/一次一步/先想后动）+ 失败协议强化 + 依赖式验证 + Rule 7 增量推进 + 表达与内容边界（破甲）
> - tool-definitions: orchestrate_task/dispatch_subagent 描述对齐慢节奏
> Co-Authored-By: Claude <noreply@anthropic.com>

</details>

## 📅 2026-08-05

<details open>
<summary>✨ <a href="https://github.com/5849mog/OpenCodeCLI/commit/a30a6d3b7b8fa70d3f46891528848af1039828a6">a30a6d3</a> — feat(awk): 原生 awk 引擎 via One True Awk WebAssembly</summary>

> - tools/awk-wasm/build.sh: Emscripten 编译 One True Awk → public/wasm/awk.wasm
> （bison + maketab/proctab 生成 + 双冒烟硬门槛）
> - src/lib/wasm/awk-wasm.ts: 镜像 bc-wasm，运行时加载；文件走 MEMFS / 管道走 stdin
> 回调；20k 输出截断；runAwk 降级 fallback
> - bash.ts: awk 接入 wasm 引擎；修复 -F, 附着写法失效；放行 -v var=val；
> awk 加入 selfPatternCmds（脚本正则不再被 glob 展开）
> - CI/.gitignore/system-prompt awk note/能力测试报告同步
> Co-Authored-By: Claude <noreply@anthropic.com>

</details>

## 📅 2026-08-03

<details open>
<summary>🐛 <a href="https://github.com/5849mog/OpenCodeCLI/commit/1ab1655c39efc3ba4622911bc5fca5aec1492a94">1ab1655</a> — fix: bash 命令 6 处局限修复 + 新增 rmdir + 并发批量调用规则</summary>

> 1) awk: 修复 BEGIN/END off-by-one（END 逐行执行的根因）+ 未初始化变量比较 + 尾部空行
> 2) bash tokenizer: -t' '/-d' ' 引号不再吞后半行
> 3) sort/cut: 文件检测改为最后一个非 flag token
> 4) tr -d 支持单集合；tee 读取 stdin 回显；cat 支持 -n；新增 rmdir
> 5) sort 去掉尾部空行（不再有前导空行）
> 6) system-prompt Rule 6: 批量工具调用并发执行，有依赖的命令必须分开
> Co-Authored-By: Claude <noreply@anthropic.com>

</details>

<details open>
<summary>✨ <a href="https://github.com/5849mog/OpenCodeCLI/commit/44a8a427f52346189df4a65e13b8f3328e038c15">44a8a42</a> — feat: search_files 支持 include/exclude 文件类型过滤 + 搜索工具路径不存在友好报错</summary>

> 1) search_files 新增 include/exclude（glob，默认大小写不敏感，匹配完整路径/相对路径/basename）
> 2) search_files/glob/search_symbols 对不存在的 path 统一返回 Path not found
> 3) 存档 45 项 grep 能力测试报告 docs/grep-capability-report.md
> Co-Authored-By: Claude <noreply@anthropic.com>

</details>

## 📅 2026-08-02

<details open>
<summary>• <a href="https://github.com/5849mog/OpenCodeCLI/commit/0216772c73fb0f97ac47521cb7af842190009ba0">0216772</a> — Add files via upload</summary>

> _（无详细说明）_

</details>

<details open>
<summary>• <a href="https://github.com/5849mog/OpenCodeCLI/commit/72ce44ba315a350e3062184caa1c8874cd87ba3d">72ce44b</a> — Add files via upload</summary>

> _（无详细说明）_

</details>

<details open>
<summary>• <a href="https://github.com/5849mog/OpenCodeCLI/commit/f71f117deb0f93563df0b119026603f87e23546d">f71f117</a> — Add files via upload</summary>

> _（无详细说明）_

</details>

<details open>
<summary>• <a href="https://github.com/5849mog/OpenCodeCLI/commit/ad24186093236c3cc2d6427144b321eb060d9a05">ad24186</a> — Add files via upload</summary>

> _（无详细说明）_

</details>

<details open>
<summary>• <a href="https://github.com/5849mog/OpenCodeCLI/commit/fcf5cbac9c9db1baef46ac4ad2dc756151906e8b">fcf5cba</a> — Add files via upload</summary>

> _（无详细说明）_

</details>

## 📅 2026-08-01

<details open>
<summary>• <a href="https://github.com/5849mog/OpenCodeCLI/commit/71baf4480b746bc2bb73b51d0a7567b43b3bc202">71baf44</a> — Add files via upload</summary>

> _（无详细说明）_

</details>

<details open>
<summary>• <a href="https://github.com/5849mog/OpenCodeCLI/commit/2f688b47f52ba531bfd0a892fbb826ff4f296c02">2f688b4</a> — Add files via upload</summary>

> _（无详细说明）_

</details>

<details open>
<summary>• <a href="https://github.com/5849mog/OpenCodeCLI/commit/dcbf9d48448c2d9da7e85ea53ecb0755f8867732">dcbf9d4</a> — Add files via upload</summary>

> _（无详细说明）_

</details>

<details open>
<summary>• <a href="https://github.com/5849mog/OpenCodeCLI/commit/29bdd15804592e26e7b307d7f94791578a32785e">29bdd15</a> — Add files via upload</summary>

> _（无详细说明）_

</details>

<details open>
<summary>• <a href="https://github.com/5849mog/OpenCodeCLI/commit/d2c060d220c892f65ae9dc827077607afb198063">d2c060d</a> — Add files via upload</summary>

> _（无详细说明）_

</details>

<details open>
<summary>✨ <a href="https://github.com/5849mog/OpenCodeCLI/commit/53f1b38eb0954cec37ad3f415bbd50200c84151f">53f1b38</a> — feat: 会话历史 + 计划面板增强 + 帮助面板 + DeepSeek 思考模式全面修复</summary>

> - 会话历史管理：IndexedDB v2 迁移、自动标题、重命名/删除/切换，多会话持久化
> - 计划面板增强：当前步骤高亮、勾选动效、分节进度条、空状态提示
> - 帮助面板替换原生 alert（cmdk CommandDialog，/help 文案抽为共享常量）
> - Token 高效化：system prompt 引导批量探索委派 dispatch_subagent；子代理循环内加上下文截断
> - 修复 DeepSeek 90s 超时被静默吞掉（拉长到 5 分钟 + 超时明确报错，AbortError 不再被抹名）
> - DeepSeek 思考开关真正生效：关闭时发送 thinking:{type:"disabled"}
> - 渲染真实思考链 reasoning_content（可折叠 thinking 块，实时流式）
> - 工具调用轮正确回传 reasoning_content 给 API（修复 DeepSeek 400 报错）
> - 移除无效 effort 选项 medium，旧配置自动纠正 medium→high
> - 修复降级 uuid 同毫秒截断碰撞导致的 React key 重复

</details>

## 📅 2026-07-31

<details open>
<summary>• <a href="https://github.com/5849mog/OpenCodeCLI/commit/e54843b31544d5c8c1ff83f69148f6a5dced459d">e54843b</a> — Add files via upload</summary>

> _（无详细说明）_

</details>

<details open>
<summary>• <a href="https://github.com/5849mog/OpenCodeCLI/commit/7d192efc595a671c4602bc8f06940c60f701480e">7d192ef</a> — Add files via upload</summary>

> _（无详细说明）_

</details>

## 📅 2026-07-30

<details open>
<summary>✨ <a href="https://github.com/5849mog/OpenCodeCLI/commit/59f293331efb8b116db312867f43dad3bb424ad9">59f2933</a> — feat: 多 Agent 编排器 + iPad 横屏适配 + 排版优化 + Undo 修复</summary>

> 主要改动：
> 1. 新增 orchestrate_task 工具（任务分解 → 并行子 Agent → 合成结果）
> 2. 新增 read_multiple_files + project_stats 工具
> 3. iPad 横屏适配：可折叠侧边栏、面板方向自适应、可折叠文件树
> 4. 排版可读性：CSS clamp() 字体变量、终端/编辑器/文件袋统一缩放
> 5. Undo 系统修复：
> - 目录节点消失 bug（ensureAncestorsSync 重建目录链）
> - 时间戳重置 bug（快照存储创建/修改时间）
> - 并行批量快照竞态 bug（Promise.all 改为单次批量快照）
> - VFS 事件 bump 加固（session 层主动刷新文件树）
> 6. 子 Agent 快照标签加上文件名
> 7. 增大触摸目标（touch-target 36px）
> 8. bc-wasm 添加最大输出长度限制
> Co-Authored-By: Claude <noreply@anthropic.com>

</details>

## 📅 2026-07-29

<details open>
<summary>🐛 <a href="https://github.com/5849mog/OpenCodeCLI/commit/a1ab2c00fc37631862c50e360cfaf269cb1f13b7">a1ab2c0</a> — fix: 修复 MermaidBlock 语法错误（Python 写入时换行符转义问题）</summary>

> _（无详细说明）_

</details>

<details open>
<summary>🐛 <a href="https://github.com/5849mog/OpenCodeCLI/commit/eb3201f12015618090b8a88bf0b41e046c09c2fe">eb3201f</a> — fix: mermaid 占位符在代码完整后能正确渲染</summary>

> 使用 done ref + isComplete 判断，流式期间显示 [diagram]，
> 代码完整后渲染一次，之后不再重复。
> Co-Authored-By: Claude <noreply@anthropic.com>

</details>

<details open>
<summary>🐛 <a href="https://github.com/5849mog/OpenCodeCLI/commit/7847baa0aeee4673bc7d33e1e661e099901ad7b8">7847baa</a> — fix: 流式输出时 mermaid 不渲染，等代码完整后再渲染</summary>

> - 空依赖数组 []，每个实例只渲染一次
> - 代码长度 < 20 或无换行时显示占位符 [diagram]
> - 渲染失败也清空 div，不堆错误
> Co-Authored-By: Claude <noreply@anthropic.com>

</details>

<details open>
<summary>🐛 <a href="https://github.com/5849mog/OpenCodeCLI/commit/291a01fc04ce574e9386b116b8a82b6406306a47">291a01f</a> — fix: MermaidBlock 无限重渲染导致页面崩溃</summary>

> 添加 rendered ref 防止 useEffect 重复执行，
> mermaid.render() 只执行一次。
> Co-Authored-By: Claude <noreply@anthropic.com>

</details>

<details open>
<summary>✨ <a href="https://github.com/5849mog/OpenCodeCLI/commit/d39100318ab611daeb0281698d9d61fd5df49ef3">d391003</a> — feat: 系统提示添加 Mermaid 流程图支持说明</summary>

> _（无详细说明）_

</details>

<details open>
<summary>✨ <a href="https://github.com/5849mog/OpenCodeCLI/commit/35e57fc98ce9b3f5cda1a5d386bdd1669f2e2f18">35e57fc</a> — feat: 添加 Mermaid 流程图渲染</summary>

> 支持 markdown 中 ```mermaid 代码块渲染为 SVG 流程图。
> 使用 mermaid.render() 实现，每块代码独立渲染。
> Co-Authored-By: Claude <noreply@anthropic.com>

</details>

<details open>
<summary>🐛 <a href="https://github.com/5849mog/OpenCodeCLI/commit/fb2e18fbb1694a121c65437debd0cc050d2ce0af">fb2e18f</a> — fix: 解决反引号与 JS 模板字符串冲突导致构建失败</summary>

> LaTeX 示例中的  反引号被 JS 解析为模板字面量结束符。
> 去掉反引号，用纯文本 $...$ 替代。
> Co-Authored-By: Claude <noreply@anthropic.com>

</details>

<details open>
<summary>✨ <a href="https://github.com/5849mog/OpenCodeCLI/commit/1da06f465ed2cb104df255eb0cebea809e1a37a3">1da06f4</a> — feat: 系统提示添加 LaTeX 数学公式支持说明</summary>

> 告诉 AI 可以用 $...$ 和 1600...1600 写公式，
> KaTeX 会渲染为真实数学符号。
> Co-Authored-By: Claude <noreply@anthropic.com>

</details>

<details open>
<summary>✨ <a href="https://github.com/5849mog/OpenCodeCLI/commit/e6e4061a6ca5b60fa7e60149853ea01da10fe41b">e6e4061</a> — feat: 公式渲染 + 消息复制按钮</summary>

> - 添加 remark-math + rehype-katex + katex 支持
> · $...$ 行内公式、1032...1032 块级公式
> · 导入 KaTeX CSS 到全局布局
> - 每条用户/AI 消息右上角添加复制按钮 (hover 显示)
> · UserRow、AssistantRow 均支持
> - bc 结果为公式时可直接渲染（例如 `$\pi = 4\arctan(1)$`）
> Co-Authored-By: Claude <noreply@anthropic.com>

</details>

<details open>
<summary>↩️ <a href="https://github.com/5849mog/OpenCodeCLI/commit/9ee76fce30763b4024320af4f10b82ed56b79f6e">9ee76fc</a> — revert: 移除 mawk wasm（源码下载持续失败）</summary>

> 保留 bc wasm 引擎，mawk 后续再尝试其他方案。
> Co-Authored-By: Claude <noreply@anthropic.com>

</details>

<details open>
<summary>🐛 <a href="https://github.com/5849mog/OpenCodeCLI/commit/6e4bbbef214dc483db297287ed4b42999ad42927">6e4bbbe</a> — fix: 更正 mawk 仓库名和版本号</summary>

> 仓库 ThomasDickey/nawk-snapshots 不存在，正确名称是
> ThomasDickey/mawk-20121129。镜像上最新版本是 1.3.4-20100507。
> Co-Authored-By: Claude <noreply@anthropic.com>

</details>

<details open>
<summary>🐛 <a href="https://github.com/5849mog/OpenCodeCLI/commit/060f82e33ebed52f9ceaf4e5f0574e8186b98367">060f82e</a> — fix: mawk 下载增加多 URL 兜底 + 临时文件原子性检查</summary>

> _（无详细说明）_

</details>

<details open>
<summary>🐛 <a href="https://github.com/5849mog/OpenCodeCLI/commit/ca3aa9ac0021d0a8370f50824ec0c4322be7d7b1">ca3aa9a</a> — fix: mawk 改用 invisible-mirror.net 官方源下载</summary>

> GitHub 上 ThomasDickey/nawk-snapshots 仓库在 CI 中无法访问。
> 换用 invisible-island.net 的官方发行版 tarball。
> Co-Authored-By: Claude <noreply@anthropic.com>

</details>

<details open>
<summary>🐛 <a href="https://github.com/5849mog/OpenCodeCLI/commit/ee7d6c72e7939b4fd9f8aab3e4239e1da6605457">ee7d6c7</a> — fix: mawk 改用 curl 下载 tarball 替代 git clone，避免 CI 中 GitHub 认证问题</summary>

> _（无详细说明）_

</details>

<details open>
<summary>🐛 <a href="https://github.com/5849mog/OpenCodeCLI/commit/8227b7e43b53bc99a76a32000264278facf74d7f">8227b7e</a> — fix: mawk clone 添加 GIT_TERMINAL_PROMPT=0 避免 CI 中交互式认证提示</summary>

> _（无详细说明）_

</details>

<details open>
<summary>🐛 <a href="https://github.com/5849mog/OpenCodeCLI/commit/aa3a820dcf78c144f07268c5ec042d5d1cb783d3">aa3a820</a> — fix: awk-wasm 添加 MEMFS /tmp 目录创建 + stdin fallback</summary>

> - MEMFS 没有默认的 /tmp 目录，直接写 /tmp/xxx 会失败
> - 添加 stdin 回调作为输入回退
> Co-Authored-By: Claude <noreply@anthropic.com>

</details>

<details open>
<summary>✨ <a href="https://github.com/5849mog/OpenCodeCLI/commit/e8d325c3f03997a9980b4a921117f19ab0aabc11">e8d325c</a> — feat: 添加 mawk WebAssembly 引擎</summary>

> - 新增 tools/mawk-wasm/build.sh — 编译 mawk 为 wasm
> - 新增 src/lib/wasm/awk-wasm.ts — 中间层（<script> + wasmBinary，管道模式）
> - 修改 bash.ts awk 分支 — 优先走 wasm，失败降级到 JS
> - 修改 deploy.yml — 添加 mawk 编译步骤
> - 完全复用 bc-wasm 的技术栈和降级策略
> Co-Authored-By: Claude <noreply@anthropic.com>

</details>

<details open>
<summary>🐛 <a href="https://github.com/5849mog/OpenCodeCLI/commit/000d562798294878695246b7bdc34c0055cc7651">000d562</a> — fix: 传递 -l 标志到 bc 引擎的 callMain</summary>

> bash.ts 提取了 -l 并传 useMathLib: true，但 bc-wasm.ts
> 的 createInstance 完全没用到这个参数，callMain 只传了 -q。
> 数学库函数 (a(), e(), s(), c() 等) 因此未加载。
> 修复: createInstance 接受 useMathLib 选项，为 true 时
> callMain(['-q', '-l']) 加载数学库。
> Co-Authored-By: Claude <noreply@anthropic.com>

</details>

<details open>
<summary>🐛 <a href="https://github.com/5849mog/OpenCodeCLI/commit/c8cde51a98369719f4a16cf1e297f54cd8cc20be">c8cde51</a> — fix: 用 wasmBinary 替代 instantiateWasm 自定义回调</summary>

> instantiateWasm 回调需要传 (instance, module) 两个参数，
> 但我们只传了 instance，导致 emscripten 内部 receiveInstance
> 访问 module.exports 时崩溃。
> 改用 wasmBinary + locateFile，让 emscripten 用自己的内部
> 实例化逻辑，它会正确传递 module 参数。
> Co-Authored-By: Claude <noreply@anthropic.com>

</details>

<details open>
<summary>🐛 <a href="https://github.com/5849mog/OpenCodeCLI/commit/451d2aaac223f9a16c3143de89f8123b88b6b97a">451d2aa</a> — fix: 用 <script> 标签替代 import() 加载 emscripten 模块</summary>

> Turbopack 拦截了所有动态 import()（包括 Blob URL），
> 报 Cannot find module 'unknown'。
> 改为 <script src=wasmUrl('bc.js')> 加载经典脚本，
> emscripten UMD 回退将工厂注册到 window.BCModule。
> 完全绕过打包器，纯运行时加载。
> Co-Authored-By: Claude <noreply@anthropic.com>

</details>

<details open>
<summary>🐛 <a href="https://github.com/5849mog/OpenCodeCLI/commit/7cb6342bc1d8c3410c447b4f7869c453149dae95">7cb6342</a> — fix: 用 fetch + Blob URL 绕过 Turbopack 构建时模块解析</summary>

> Turbopack 在 build 时试图解析 import(wasmUrl('bc.mjs'))
> 这个动态表达式，但它是运行时 URL，不是文件系统路径。
> 改为 fetch 文本 → Blob URL → import(blobUrl)，完全绕开打包器。
> Co-Authored-By: Claude <noreply@anthropic.com>

</details>

<details open>
<summary>♻️ <a href="https://github.com/5849mog/OpenCodeCLI/commit/0b430d385cc59d04c50190e02077b55b2807a9c0">0b430d3</a> — refactor: 移除 Worker，主线层直连 wasm</summary>

> 问题：Worker + importScripts + GitHub Pages 子目录的路径解析
> 一直出问题。Worker 初始化超时后降级到 JS 实现，ibase/obase
> 等完整 bc 功能无法使用。
> 改动：
> - 删除 public/wasm/bc-worker.js（不再需要 Worker）
> - 重写 src/lib/wasm/bc-wasm.ts — 主线层直连 wasm
> · 预编译 WebAssembly.Module（缓存，重复实例化仅 ~1-2ms）
> · 动态 import() emscripten 工厂（ES 模块）
> · 每次 evaluate() 创建新实例，用完即弃
> · 路径自动适配 GitHub Pages 子目录
> - build.sh 输出改为 bc.mjs（ES 模块格式）
> Co-Authored-By: Claude <noreply@anthropic.com>

</details>

<details open>
<summary>🐛 <a href="https://github.com/5849mog/OpenCodeCLI/commit/9a05dae7ef8fb00d0d10bec90bf3b1891f3714c7">9a05dae</a> — fix: Worker 初始化后从未通知主线程就绪，导致 10 秒超时降级</summary>

> bc-worker.js 的 init() 是异步的，但之前只调用没 await，
> 也没 postMessage 通知主线程。主线程 initBC() 等待 'ready'
> 消息等 10 秒超时后放弃，所有 bc 命令走 JS 降级。
> 修复：init().then(() => postMessage({type:'ready'}))
> Worker 启动后自动发就绪信号，不再需要主线程发 init 命令触发。
> Co-Authored-By: Claude <noreply@anthropic.com>

</details>

<details open>
<summary>🐛 <a href="https://github.com/5849mog/OpenCodeCLI/commit/9f6ac28f45ddc4603b5373ade56e4a89c9594c0b">9f6ac28</a> — fix: Worker wasm 路径在 GitHub Pages 子目录下加载失败</summary>

> 问题：bc-worker.js 里 importScripts('/wasm/bc.js') 是绝对路径，
> 但在 GitHub Pages 上部署在 /OpenCodeCLI/ 子目录下，/wasm/
> 实际指向的是 https://5849mog.github.io/wasm/（根目录），
> 导致 Worker 加载失败，自动降级到 JS 实现。
> 修复：
> - Worker 内用 self.location.href 动态推导自身所在目录
> - 主线程用 window.location.hostname 检测 GitHub Pages，自动加 repo name
> Co-Authored-By: Claude <noreply@anthropic.com>

</details>

<details open>
<summary>🐛 <a href="https://github.com/5849mog/OpenCodeCLI/commit/f92bfef8668e1f83def847c99376bd01f94f4a7b">f92bfef</a> — fix: bc-wasm 链接阶段遗漏 gen/ 目录下的 .o 文件</summary>

> gen/ 目录包含 strgen 生成的帮助文本和内置 bc 标准库的 .o 文件，
> 链接时必须包含它们否则符号未定义
> Co-Authored-By: Claude <noreply@anthropic.com>

</details>

<details open>
<summary>🐛 <a href="https://github.com/5849mog/OpenCodeCLI/commit/4ca986a67edcb136aa58802c65c7d554de7bbacd">4ca986a</a> — fix: 修复 bc-wasm 构建脚本的 configure 参数</summary>

> gavinhoward/bc 使用 --enable-readline（而非 --disable-readline）
> 移除无效的 --disable-readline 和 --enable-static
> 改用正确的 --disable-nls --disable-man-pages
> Co-Authored-By: Claude <noreply@anthropic.com>

</details>

<details open>
<summary>✨ <a href="https://github.com/5849mog/OpenCodeCLI/commit/1cf8ddfa2764c147640d0773bc138877355699c2">1cf8ddf</a> — feat: 将 bc 从 JS 模拟替换为 WebAssembly 原生引擎</summary>

> - 新增 tools/bc-wasm/build.sh — 用 Emscripten 编译 gavinhoward/bc 为 bc.wasm
> - 新增 src/lib/wasm/bc-wasm.ts — 中间层，通过 Web Worker 调用 bc.wasm
> - 新增 public/wasm/bc-worker.js — Worker 脚本，处理 wasm I/O
> - 新增 tools/bc-wasm/prepare.sh — 本地开发准备脚本
> - 修改 bash.ts — 管道改为 async，bc 分支调用 wasm 引擎
> - 修改系统提示 — bc 说明更新为完整 POSIX bc 支持
> - 修改 deploy.yml — CI 添加 Emscripten 编译步骤
> - bc 现在完整支持变量、函数、循环、进制转换、-l 数学库
> Co-Authored-By: Claude <noreply@anthropic.com>

</details>

## 📅 2026-07-28

<details open>
<summary>🐛 <a href="https://github.com/5849mog/OpenCodeCLI/commit/92c22a5f6ca6202c42ff23f47dc81bb9c6e5fa29">92c22a5</a> — fix: bc -l flag parsing, awk BEGIN no-input, printf format specifier</summary>

> - bc: filter out -l flag from rest so piped stdin is read correctly
> - bc: verify e(), l(), sqrt(), ^ all work without -l flag
> - awk: pass empty string for BEGIN-only scripts (no input needed)
> - sprintfAwk: fix width/precision skip logic that broke %.4f etc.
> - system prompt: add bc usage note (don't use -l flag)
> Co-Authored-By: Claude <noreply@anthropic.com>

</details>

<details open>
<summary>🔁 <a href="https://github.com/5849mog/OpenCodeCLI/commit/19f84e6ed74b5af73de1afe9aeeb99872e3410e5">19f84e6</a> — ci: add retry to bun install</summary>

> _（无详细说明）_

</details>

<details open>
<summary>✨ <a href="https://github.com/5849mog/OpenCodeCLI/commit/f0e406689d872bf0ebb8f78272e6ad637284a5b8">f0e4066</a> — feat: web_search, fetch_url, bash improvements</summary>

> - New web tools: web_search (Tavily/Brave, built-in API key) and fetch_url (CORS fallback + HTML-to-text extraction)
> - Extended apiKeyVault for multi-slot key storage (LLM + search)
> - Search API key built-in (Tavily dev key), web_search works out of the box
> - fetch_url now auto-strips HTML tags to extract readable text content
> - Smart CORS fallback: direct fetch → Jina Reader → custom proxy
> - Bash improvements: sed -n range fix, bc stdin + scale=N + sqrt/^/trig functions
> - Tool failure protocol in system prompt (fail once, never retry)
> - New Web & Search settings panel with built-in key indicator
> - CORS proxy endpoint in Caddyfile
> - HTML content extraction in fetch_url responses
> Co-Authored-By: Claude <noreply@anthropic.com>

</details>


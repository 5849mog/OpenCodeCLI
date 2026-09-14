# ppt-design

一个做 PPT / 幻灯片的设计框架 skill：把「像不像人排的」变成可执行的约束，而不是靠现场审美发挥。

适用于 ZCode / Claude Code 等支持 SKILL.md 约定的编码代理。

## 核心主张

**AI 在写代码画幻灯片，但它看不见成品。** 坐标算错、文字溢出、两个框叠在一起，代码都不报错，文件照样生成，甚至渲染预览也正常——成品却已经坏了。

所以这套框架的重心不在「怎么生成一页」，而在三件事：**先由脚本裁决环境能力，不让 AI 靠猜测承诺交付**；**先用用户读得懂的方向确认卡确认意图，再在内部落成施工单**；**动手后用两道互不替代的闸门兜住那些不报错却会坏掉的坑**。

## 它包含什么

核心文件触发即载，其余按需加载（读到什么才花什么 token）。

| 文件 | 行数 | 内容 |
|---|---|---|
| `SKILL.md` | — | **短执行协议**：硬约束、任务路由、用户确认、施工与验收的唯一入口 |
| `references/workflow/` | — | **按需流程包**：单页最小流程、常规多页完整流程、改稿、高级能力增量 |
| `references/user-confirmation-card.md` | — | 用户确认模板：只确认论点、视觉、节奏和不可改边界，不暴露施工参数 |
| `references/internal-build-spec.md` | — | AI 内部施工单字段：环境、叙事、风格、页级编排、素材、动画与 QA |
| `references/environment.md` | — | 环境安装、profile 路由和禁止承诺规则 |
| `references/styles.md` | 559 | 风格库：12 个有名有姓的设计运动预设（精确色值字号）、按效果选风格、页级编排规则、反 AI 审美清单 |
| `references/pitfalls.md` | 487 | 33 条静默翻车清单（症状 / 原因 / 做法 / 怎么验证）——专收「不报错、文件正常、成品已坏」那类 |
| `references/judge-prompt.md` | 104 | 闸门二视觉验收的 judge 填空模板（输出机器可读 JSON verdict） |
| `references/anim-atlas.md` | 141 | **动效手法库（取材用，不是规范）**：菜单内 10 条有权威依据的手法 + 菜单外 2 条（须 `--raw` 与用户同意）+ 依据登记表（哪个数字来自哪次探针） |
| `references/pptx-core/` | 675 | 本技能**唯一**的 pptx 生成/编辑参考：pptxgenjs API、图表/表格/模板编辑、脚手架写法，已按本技能规则对齐。含 `SKILL.md` + `PROVENANCE.md`（来源与改动记录）+ `LICENSE.txt` |
| `scripts/qa.py` | 1259 | 闸门一：几何 / 中文排版 / 对比度 / 交付合法性 / 表格外框裁剪 / 字体可移植性 / deck 级骨架 |
| `scripts/render.py` | 302 | 渲染 PNG（PowerPoint COM 优先，LibreOffice 兜底），支持 `--pages` 单页重渲与 `--contact` 拼图 |
| `scripts/skeleton.js` | 115 | pptxgenjs 起手模板：栅格常量、调色板、绕开库 bug 的辅助函数（如 `addTableSafe`） |
| `scripts/inject_math.py` | 234 | 公式：声明式规格 → matplotlib 渲染 → 注入，含重开/COM 验证 |
| `scripts/inject_icons.py` | 294 | 图标：内嵌 Tabler 线性图标库注入，单一颜色角色 |
| `scripts/inject_figure.py` | 975 | 插图：函数图像 / 平面几何题图；声明式规格 + 几何约束验算（超差不写文件）+ 自定义代码逃生舱 |
| `scripts/inject_anim.py` | 1131 | 动画：中文脚本 → OOXML timing 注入，PowerPoint COM 三层校验；菜单外效果走 `--raw` 手写 XML 逃生舱（须用户同意；默认标降级，**附「断言」清单即逐条核对**） |
| `scripts/prep_assets.py` | 429 | 素材：无损调理（EXIF / sRGB / 裁切 / 300PPI）+ 扫描件清洗（白底 / 去斜 / 裁白边 / 对比） |
| `scripts/selftest.py` | 1254 | 回归自测：116 条断言，改任一脚本后必跑 |
| `scripts/doctor.py` | — | 环境能力探测：输出 `full-windows` / `static-verified` / `structure-only` / `blocked`，禁止 AI 自由猜测 |
| `assets/icons/` | — | Tabler Icons 字体 + 字形表 + 许可证（随技能内嵌，无需联网） |

## 几个关键机制

- **脚本先裁决，再按需加载。** 每次正式施工先跑 `doctor.py --json`；其 profile 是环境能力和交付承诺的唯一来源。顶层 `SKILL.md` 只保留协议和路由，单页、多页、改稿、动画等细节按任务加载，减少模型读无关规则的机会。
- **确认卡 + 施工单 + 样板页。** 用户默认只确认一屏方向卡：论点、视觉、节奏、素材边界；确认后 AI 才在内部生成完整施工单。多页任务再以样板页确认观感，既不要求用户理解施工参数，也不牺牲可执行性。
- **检查分三类：硬伤 / 告警 / 检查降级。** 降级指某类检查因环境缺失（jieba 未装、非 Windows 无字体目录）整类没跑——**降级不等于通过**，报告会单列成块并计入退出码，交付说明里必须如实声明。
- **先分页型，再谈动效。** 视觉型页（立论/大数字/满幅图）与用户商定后**整页自动播完**；讲解型页**按节拍分组揭示**——一组 = 一个讲得完的论点单元，`触发` 写 `点击`/`自动` 开新组、`之后`/`同时` 并进上一组，所以「一次点击出几个」就是「这一组放几条」，**每页由 AI 判断、写进规格书**，qa 只做护栏（>4 组、单对象成组、单节拍 >8s 才告警）。**没人现场讲的档（炫技/展映/大屏循环）整类豁免**：长动画、组合动画、一页多组、自动播完都是要点，节拍阈值不该当尺子——但豁免必须写进规格书与交付说明，且任何档位都不许为了报告干净而削弱动画。动效只有一个质量参数：**缓动**（默认缓入缓出，XML 编码抄自 PowerPoint 探针产物）；延迟/节拍由 COM 的 `Timing.TriggerDelayTime` 逐条读回验证。技能**不写自动换片时间**（`advTm`/`advClick`）、也不动放映设置，产物不会自己翻页，`qa.py` 会反查这三类风险。
- **两道闸门抓的是完全不同的两类错。** 闸门一（`qa.py`）读结构抓「断没断」：库级 bug、表格外框裁剪、字体被静默替换，这些渲染预览看不出来；闸门二（judge 子代理看渲染图）抓「好不好看」：断错词、层次、焦点、留白。「程序化检查干净只证明没断，不证明能看。」
- **声明式规格 → 编译器。** 公式 / 图标 / 插图 / 动画都走「AI 写中文键 JSON 意图 → 脚本编译注入并自验」这一条路：机械层收归脚本，表达层留给 AI；词表之外还留逃生舱（如插图的 `自定义代码`），不把 AI 封死。
- **静默翻车清单是这套 skill 存在的一半理由。** 字体被替换、`breakLine` 漏写、表格外框高度 ≠ 行高合计……33 条，每条都写清症状、根因、做法和验证方式。

## 自包含

本目录**完全自包含**：技能文档、脚本、图标字体、pptx 生成/编辑参考全部内置，不依赖任何外部技能或联网资源，可整体放进支持 SKILL.md 约定的任意 Agent 产品。

其中 `references/pptx-core/` 是唯一的 pptx 参考（pptxgenjs API 与模板编辑写法），已按本技能规则对齐，取代了原先「必须另装官方 pptx 技能」的依赖。它的内容整合自一份外部资料，版权与许可保留在 `references/pptx-core/LICENSE.txt`，来源与改动记录见 `PROVENANCE.md`；本技能对外不主张其为原创。

## 安装与环境路由

```bash
npm install pptxgenjs              # 生成 pptx
python -m pip install -r requirements.txt
# Windows 需要 PowerPoint COM 渲染和动画验证时：
python -m pip install -r requirements-windows.txt
python scripts/doctor.py --json
```

以 `doctor.py --json` 的 profile 为准：`blocked` 不得施工，`structure-only` 不得声称完成
视觉验收，无 PowerPoint COM 时不得声称动画已逐条验证。完整约束见
`references/environment.md`。改脚本后跑 `python scripts/selftest.py` 回归（116 条断言；
node / pptxgenjs 不在默认 `NODE_PATH` 时会跳过若干链并注明）。

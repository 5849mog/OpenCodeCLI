# ppt-design

一个做 PPT / 幻灯片的设计框架 skill：把「像不像人排的」变成可执行的约束，而不是靠现场审美发挥。

适用于 ZCode / Claude Code 等支持 SKILL.md 约定的编码代理。

## 核心主张

**AI 在写代码画幻灯片，但它看不见成品。** 坐标算错、文字溢出、两个框叠在一起，代码都不报错，文件照样生成，甚至渲染预览也正常——成品却已经坏了。

所以这套框架的重心不在「怎么生成一页」，而在两件事：**动手前先问清方向、把风格落成一份可确认的规格书**；**动手后用两道互不替代的闸门兜住那些不报错却会坏掉的坑**。

## 它包含什么

核心文件触发即载，其余按需加载（读到什么才花什么 token）。

| 文件 | 行数 | 内容 |
|---|---|---|
| `SKILL.md` | 256 | 核心：三阶段协议（问需求 → 风格规格书 → 施工）、12 步施工、两道闸门、交付话术、脚本表 |
| `references/styles.md` | 559 | 风格库：12 个有名有姓的设计运动预设（精确色值字号）、按效果选风格、页级编排规则、反 AI 审美清单 |
| `references/pitfalls.md` | 475 | 32 条静默翻车清单（症状 / 原因 / 做法 / 怎么验证）——专收「不报错、文件正常、成品已坏」那类 |
| `references/judge-prompt.md` | 82 | 闸门二视觉验收的 judge 填空模板（输出机器可读 JSON verdict） |
| `references/pptx-core/` | 675 | 本技能**唯一**的 pptx 生成/编辑参考：pptxgenjs API、图表/表格/模板编辑、脚手架写法，已按本技能规则对齐。含 `SKILL.md` + `PROVENANCE.md`（来源与改动记录）+ `LICENSE.txt` |
| `scripts/qa.py` | 1055 | 闸门一：几何 / 中文排版 / 对比度 / 交付合法性 / 表格外框裁剪 / 字体可移植性 / deck 级骨架 |
| `scripts/render.py` | 302 | 渲染 PNG（PowerPoint COM 优先，LibreOffice 兜底），支持 `--pages` 单页重渲与 `--contact` 拼图 |
| `scripts/skeleton.js` | 115 | pptxgenjs 起手模板：栅格常量、调色板、绕开库 bug 的辅助函数（如 `addTableSafe`） |
| `scripts/inject_math.py` | 234 | 公式：声明式规格 → matplotlib 渲染 → 注入，含重开/COM 验证 |
| `scripts/inject_icons.py` | 294 | 图标：内嵌 Tabler 线性图标库注入，单一颜色角色 |
| `scripts/inject_figure.py` | 975 | 插图：函数图像 / 平面几何题图；声明式规格 + 几何约束验算（超差不写文件）+ 自定义代码逃生舱 |
| `scripts/inject_anim.py` | 711 | 动画：中文脚本 → OOXML timing 注入，PowerPoint COM 三层校验；菜单外效果走 `--raw` 手写 XML 逃生舱（须用户同意，逐条断言关闭＝降级） |
| `scripts/prep_assets.py` | 429 | 素材：无损调理（EXIF / sRGB / 裁切 / 300PPI）+ 扫描件清洗（白底 / 去斜 / 裁白边 / 对比） |
| `scripts/selftest.py` | 1017 | 回归自测：88 条断言，改任一脚本后必跑 |
| `assets/icons/` | — | Tabler Icons 字体 + 字形表 + 许可证（随技能内嵌，无需联网） |

## 几个关键机制

- **三阶段 + 两次确认。** 阶段一问清需求（一次 `AskUserQuestion` 最多 4 问），阶段二输出风格规格书**必须停下等确认**，多页任务在施工中途再拿样板页给用户看。方向错了在规格书那一步花三十秒就能拦住，做完十页再改要重来。
- **检查分三类：硬伤 / 告警 / 检查降级。** 降级指某类检查因环境缺失（jieba 未装、非 Windows 无字体目录）整类没跑——**降级不等于通过**，报告会单列成块并计入退出码，交付说明里必须如实声明。
- **两道闸门抓的是完全不同的两类错。** 闸门一（`qa.py`）读结构抓「断没断」：库级 bug、表格外框裁剪、字体被静默替换，这些渲染预览看不出来；闸门二（judge 子代理看渲染图）抓「好不好看」：断错词、层次、焦点、留白。「程序化检查干净只证明没断，不证明能看。」
- **声明式规格 → 编译器。** 公式 / 图标 / 插图 / 动画都走「AI 写中文键 JSON 意图 → 脚本编译注入并自验」这一条路：机械层收归脚本，表达层留给 AI；词表之外还留逃生舱（如插图的 `自定义代码`），不把 AI 封死。
- **静默翻车清单是这套 skill 存在的一半理由。** 字体被替换、`breakLine` 漏写、表格外框高度 ≠ 行高合计……32 条，每条都写清症状、根因、做法和验证方式。

## 自包含

本目录**完全自包含**：技能文档、脚本、图标字体、pptx 生成/编辑参考全部内置，不依赖任何外部技能或联网资源，可整体放进支持 SKILL.md 约定的任意 Agent 产品。

其中 `references/pptx-core/` 是唯一的 pptx 参考（pptxgenjs API 与模板编辑写法），已按本技能规则对齐，取代了原先「必须另装官方 pptx 技能」的依赖。它的内容整合自一份外部资料，版权与许可保留在 `references/pptx-core/LICENSE.txt`，来源与改动记录见 `PROVENANCE.md`；本技能对外不主张其为原创。

## 依赖

```bash
npm install pptxgenjs              # 生成 pptx
python -m pip install python-pptx  # qa.py 读结构（硬依赖）
python -m pip install pywin32      # render.py 用 PowerPoint COM 导 PNG（Windows）
python -m pip install pillow       # qa.py 读真实字体度量；缺失则回落估算并标注「检查降级」
python -m pip install defusedxml   # qa.py 安全解析 pptx 内的 XML
python -m pip install jieba        # qa.py 的劈词检测；不装则关闭并标注「检查降级」
python -m pip install matplotlib   # inject_math 渲染公式、inject_figure 画插图（自带 numpy）
python -m pip install pillow-heif  # prep_assets.py 读 iPhone 的 HEIC（可选）
```

改脚本后跑 `python scripts/selftest.py` 回归（80 条断言；node / pptxgenjs 不在默认 `NODE_PATH` 时会跳过若干链并注明）。

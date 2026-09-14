---
name: ppt-design
description: >
  做 PPT / 幻灯片 / 演示文稿 / pptx / deck 时使用。先由脚本裁决环境能力，再用用户能读懂的方向确认卡确认论点、视觉、节奏和边界；确认后生成内部施工单、样板页和 pptx，最后过程序化 QA 与渲染视觉验收。整体重设计归本技能；模板填充或只改现有 PPT 的错字/数据走内置 pptx-core 编辑流程。
---

# PPT 设计执行协议

## 0. 不可自由判断的规则

1. **正式施工前必须运行** `python scripts/doctor.py --json`；环境能力、禁止承诺和
   交付 profile 只以它的输出为准，不能凭模型经验覆盖。详见 `references/environment.md`。
2. `profile=blocked` 时不得开始正式施工。`structure-only` 时不得声称完成视觉验收；
   无 `verifyAnimationWithCom` 时不得声称动画已在 PowerPoint 中逐条验证。
3. 用户默认只看 `references/user-confirmation-card.md` 的**方向确认卡**，不看色值、
   字号、锚点、JSON 或 QA 阈值。用户确认后才生成
   `references/internal-build-spec.md` 的内部施工单。
4. 多页 deck 必须先拿方向确认，再制作一张样板内容页；样板确认后才铺全稿。
5. 用户素材先清点、逐张确认处理方式；未确认不得改图。用户要求的事实、品牌、
   标题不可改边界必须写进确认卡和施工单。
6. 每份 deck 都必须过闸门一（`qa.py`）和闸门二（渲染图 + 独立 judge）；没有独立
   judge 时按 `judge-prompt.md` 自检，并在交付时声明降级。
7. 所有 `warnings`、`检查降级` 和已同意保留的告警都必须进入交付说明；降级不等于通过。

## 1. 任务路由

| 任务 | 必读 | 额外动作 |
|---|---|---|
| 单页，内容和风格已明确 | `workflow/minimal.md`、目标风格章节、`pptx-core/SKILL.md` | 确认卡可压为 3–5 行。 |
| 常规新建多页 deck | `workflow/standard.md`、`styles.md`、`pitfalls.md`、`pptx-core/SKILL.md` | 方向确认卡 → 内部施工单 → 样板页。 |
| 重设计已有 PPT | `workflow/redesign.md` | 先提取内容大纲并确认可改范围。 |
| 模板填充 / 只改文字数据 | `pptx-core/SKILL.md` 的模板/编辑章节 | 不默认启动重设计流程。 |
| 图片、公式、插图、图标、动画 | `workflow/advanced.md` + 对应脚本文件头 | 只加载实际触发的一项。 |

`references/pptx-core/SKILL.md` 是唯一的 PPTX API/生成/编辑参考；其来源与许可见同目录
`PROVENANCE.md`。设计规则以 `styles.md` 为准，静默失败规则以 `pitfalls.md` 为准。

## 2. 与用户沟通

### 默认流程

1. 信息不足时，用**一次**提问收齐：场合与受众、要达成的效果、篇幅与内容来源、
   硬约束（品牌/素材/备注/扫描件）。用户点名风格、给参考图或说“你决定”时不连环追问。
2. 先整理一句主张、3–5 个支撑论点与逐页推进；排版不能替代论证。
3. 输出方向确认卡后停下等确认。用户只需确认：**说什么、长什么样、怎么讲、哪些不能碰**。
4. 确认后在内部生成施工单；不要让用户为实现参数作决定，除非他明确要求或任务涉及审批。

### 确认卡的硬要求

- 用大白话说明受众、视觉意象、页面推进、动画/点击和素材边界；一屏优先。
- 把“核心结论”写成可接受或反驳的判断，不写主题名。
- 动画行必填：现场讲按节拍分组；自读/打印默认写“不加”；展映豁免必须写明。
- 让用户确认样板页，不要求其理解字体、色值、母题、锚点或 QA 参数。

## 3. 施工与验收

按路由文件执行详细步骤。所有路线都必须遵守：

1. 施工前读取 `doctor.py --json` 与相关能力的脚本文件头；将输出写入内部施工单。
2. 栅格、调色板和重复尺寸写成常量；从 `scripts/skeleton.js` 起手。
3. 有高级能力时按 `workflow/advanced.md` 的顺序注入；公式/插图/图标在动画前注入。
4. 先运行 `python scripts/qa.py <deck.pptx>`；按其退出码和降级状态处理，不能用管道吞掉退出码。
5. 再用 `render.py` 渲染 PNG（多页用 `--contact`），用 `judge-prompt.md` 做逐页和全 deck 视觉验收；
   只重渲改动页并让同一个 judge 复核。
6. 交付时给出文件/预览路径、实际视觉描述、修复过的问题、环境降级、素材出处、
   作图验算和动画播放体验；不要只丢文件路径。

## 4. 参考索引

| 内容 | 文件 |
|---|---|
| 环境安装与 profile 裁决 | `references/environment.md` |
| 用户确认模板 | `references/user-confirmation-card.md` |
| 内部可执行施工单 | `references/internal-build-spec.md` |
| 常规多页完整流程 | `references/workflow/standard.md` |
| 单页 / 改稿 / 高级能力 | `references/workflow/{minimal,redesign,advanced}.md` |
| 风格、坑点、视觉 judge、动画手法 | `references/{styles,pitfalls,judge-prompt,anim-atlas}.md` |
| PPTX API、模板和编辑 | `references/pptx-core/SKILL.md` |
| 环境探测、生成、注入、QA、渲染 | `scripts/` |

脚本按需复制到 deck 工作目录再运行，不能凭空假定运行环境已满足要求。

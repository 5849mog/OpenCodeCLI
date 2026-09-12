# 来源与许可（第三方内容，非本项目原创）

本目录是官方技能 **`document-skills:pptx`**（作者 Z.AI，version 1.1）的**完整逐字节副本**，
随 ppt-design 内嵌，目的是让技能自包含——在没有安装官方技能的宿主里也能取到 pptxgenjs API 与写法。

- 原始路径：`C:\Users\1\.zcode\cli\plugins\cache\zcode-plugins-official\document-skills\0.1.4\skills\pptx\`
- 文件：`SKILL.md`（645 行）、`LICENSE.txt`
- 完整性：与官方副本逐字节一致（`diff` 校验通过），未做任何修改。

## 版权与许可

见 `LICENSE.txt`。**Copyright (c) 2026 Z.ai All rights reserved.**
仅授权**个人 / 教育 / 非商业**用途；商业使用需事先获得书面许可，且「商业」的最终解释权在 Z.ai。

因此：本目录内容**不得当作本项目原创**，**不要删除 `LICENSE.txt` 或改写其版权头**。
本副本的引入由使用者自行决定并自负其责。

## 选哪一份

若宿主已安装官方 `document-skills:pptx`，**优先读宿主版本**；本副本仅作缺省兜底。
两者**取一即可，不要同时加载**，以免重复与冲突。

## 与 ppt-design 自身规则的已知冲突（一律以 ppt-design 为准）

内嵌副本是官方原文、未做修改，它有几处与 ppt-design 已修正的规则不一致：

1. **表格写法** —— 官方 §Tables 示例 `addTable(data, { x, y, w, h })` **不给 `rowH`**，而
   ppt-design `pitfalls #30` 已证明这会被真 PowerPoint 裁掉下半截（且 WPS/LibreOffice 预览看不出来）。
   → 一律用 `scripts/skeleton.js` 的 `addTableSafe`：`h = rowH × 行数` 且 `w ≥ Σ colW`。
2. **全宽色带** —— 官方 §9 明令「绝不做装饰性色带（含全宽页眉页脚带）」，ppt-design `pitfalls #17`
   留了「结构组件且承载内容」的例外口子。→ 以 `pitfalls #17` 为准。
3. **设计默认值** —— 官方 Part 1 的通用设计建议与 ppt-design `references/styles.md` 的 12 套预设、
   页级编排规则可能不一致（字体、配色、画布尺寸、母题）。→ 冲突时以 `styles.md` 与本技能规格书为准。

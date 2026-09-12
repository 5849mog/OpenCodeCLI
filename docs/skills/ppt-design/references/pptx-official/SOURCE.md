# 来源与许可（第三方内容，非本项目原创）

本目录是官方技能 **`document-skills:pptx`**（作者 Z.AI，version 1.1）的副本，
随 ppt-design 内嵌，目的是让技能自包含——在没有安装官方技能的宿主里也能取到 pptxgenjs API 与写法。

- 原始路径：`C:\Users\1\.zcode\cli\plugins\cache\zcode-plugins-official\document-skills\0.1.4\skills\pptx\`
- 文件：`SKILL.md`、`LICENSE.txt`
- **`LICENSE.txt` 与官方逐字节一致**（未改动）。
- `SKILL.md` **经 ppt-design 轻度修改**（645 → 675 行），修改点见文末「ppt-design 修改说明」；除此以外与官方原文逐字一致。

## 版权与许可

见 `LICENSE.txt`。**Copyright (c) 2026 Z.ai All rights reserved.**
仅授权**个人 / 教育 / 非商业**用途；商业使用需事先获得书面许可，且「商业」的最终解释权在 Z.ai。

因此：本目录内容**不得当作本项目原创**，**不要删除 `LICENSE.txt` 或改写其版权头**。
本副本的引入与修改由使用者自行决定并自负其责。

## 选哪一份

若宿主已安装官方 `document-skills:pptx`，**优先读宿主版本**；本副本仅作缺省兜底。
两者**取一即可，不要同时加载**，以免重复与冲突。

## 与 ppt-design 规则的冲突状态

| 冲突点 | 状态 |
|---|---|
| 官方 §Tables 示例不给 `rowH`（会被真 PowerPoint 裁掉下半截） | ✅ **已在本副本就地修正**：补 `rowH: 1` 并加注；一律用 `scripts/skeleton.js` 的 `addTableSafe`（`h = rowH × 行数`、`w ≥ Σ colW`，见 `pitfalls #30`） |
| 官方 §9 绝对禁止全宽色带 vs ppt-design `pitfalls #17` 的结构组件例外 | ✅ **已在本副本就地修正**：补「结构组件且承载内容」例外 |
| 官方 §10 建议自写 python-pptx 估算脚本 | ✅ **已在本副本就地修正**：改为优先用 `scripts/qa.py` 与 `references/judge-prompt.md` |
| 官方 Part 1 的通用设计默认值与 `references/styles.md` 的 12 套预设可能不一致（字体、配色、画布尺寸、母题） | ⚠️ **未改**：冲突时以 ppt-design 的规格书与 `styles.md` 为准 |

**总原则：与 ppt-design 冲突时，一律以 ppt-design 为准**（规格书 → `styles.md` 设计规则 → `pitfalls.md` 的坑）。

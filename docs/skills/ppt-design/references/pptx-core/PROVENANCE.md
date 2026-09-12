# 来源与许可

`SKILL.md` 是 ppt-design **自带的 pptx 生成与编辑参考，本技能的唯一参考来源**。它整合自一份外部资料，
经本技能改写对齐后作为内部参考使用；本技能**不加载、也不依赖任何外部技能**。

- 原始资料：Z.AI `document-skills:pptx` v1.1（原路径：`C:\Users\1\.zcode\cli\plugins\cache\zcode-plugins-official\document-skills\0.1.4\skills\pptx\`）
- 文件：`SKILL.md`（参考正文）、`LICENSE.txt`（原始许可）
- `LICENSE.txt` 与原始资料**逐字节一致，未改动**。
- `SKILL.md` 经本技能修改（645 → 675 行），逐条记录见文末「本参考的改动说明」。

## 许可

见 `LICENSE.txt`：**Copyright (c) 2026 Z.ai All rights reserved.**，仅授权**个人 / 教育 / 非商业**用途；
商业使用需事先书面许可。**保留 `LICENSE.txt` 与原版权头**，本参考不作为本项目原创对外主张。

## 定位

- 这是本技能**唯一**的 pptx 参考。宿主若另装了外部 pptx 技能，本技能也不去读它。
- 与本技能规则有出入时，以**本技能规格书 → `references/styles.md` → `references/pitfalls.md`** 为准。

## 改动记录（相对原始资料）

| 位置 | 改动 |
|---|---|
| 文首 | 加来源/优先级声明 |
| §Tables | 示例补 `rowH: 1` 并加注：`addTable` 不按 Σ rowH 回填外框高、`h` 必须 = `rowH × 行数`（原始示例不给 `rowH`，会被真 PowerPoint 裁剪；对齐 `pitfalls #30`） |
| §9 Avoid list | 给「禁装饰性色带」补「结构组件且承载内容」的例外（`pitfalls #17`） |
| §10 QA | 改指自带的 `scripts/qa.py` 与 `references/judge-prompt.md`，原 python-pptx 估算脚本降为兜底 |
| Dependencies | 标注随本技能使用时的实际依赖（pptxgenjs / python-pptx / matplotlib·numpy / Pillow） |

日期：2026-09-12。

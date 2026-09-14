# 环境与能力路由

**不要由 AI 猜环境。** 每次正式施工前，在 deck 工作目录运行：

```bash
python scripts/doctor.py --json
```

读取 `profile` 后按下表执行；它是唯一的环境决策来源。

| profile | 允许的交付承诺 | 强制行为 |
|---|---|---|
| `full-windows` | 静态、PowerPoint 渲染与 COM 动画逐条验证 | 正常走完整流程。 |
| `static-verified` | 静态 deck 的结构 QA + 渲染视觉验收 | 有动画时可注入，但必须在交付中声明未做 COM 逐条验证。 |
| `structure-only` | 生成和结构 QA | 不得声称闸门二完成；先修渲染环境或请求最终验收机。 |
| `blocked` | 无 | 不得开始正式施工；先安装 Node/pptxgenjs 或 `python-pptx`。 |

`doctor.py --strict` 仅在存在 `blocked` 项时退出 1，便于 CI。`--json` 的
`capabilities`、`blocks` 与 `warnings` 可直接放进施工单和交付说明；不要把脚本报告
重新解释成“看起来应该可以”。

## 安装

```bash
npm install pptxgenjs
python -m pip install -r requirements.txt
# Windows 需要 PowerPoint COM 渲染/动画验证时：
python -m pip install -r requirements-windows.txt
```

Linux/macOS 可用 LibreOffice + `pdftoppm` 做渲染兜底，但字体与动画 fidelity 仍不能
等同于 Microsoft PowerPoint。`doctor.py` 会把这一限制写成警告。

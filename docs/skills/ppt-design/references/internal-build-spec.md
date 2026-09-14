# 内部施工单（不默认展示给用户）

用户确认卡通过后，AI 必须整理一份可执行施工单。可用 JSON、YAML 或同字段的表格，
但必须包含：

```text
environment: doctor.py --json 的完整 profile / blocks / warnings
narrative: 一句主张、3–5 个支撑论点、逐页论证角色与判断句标题
audience: 场合、受众、画幅、最低字号、信息密度阈值
style: 预设/来源、色值、用色纪律、字体、字号、母题、专属禁忌
pages: 每页版式、唯一焦点、视觉载体、母题落点、备注
assets: 每个素材的来源、确认过的处理方式、落点
figures: 作图依据、声明式规格、约束与验算结果
motion: 是否有人现场讲、页级分组/触发/豁免、自动换片必须为 false
qa: minPt、maxChars、palette、可声明豁免及理由
delivery: 必须报告的环境降级、版权、动画验证状态
```

施工单由 AI 和脚本消费：用户确认的是方向卡，不是这些实现细节。所有环境能力和
禁止承诺都以 `doctor.py --json` 为准，不允许凭经验覆盖。

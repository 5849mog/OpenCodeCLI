import type { AgentPreset } from "./tools/system-prompt";

/**
 * 运行模式徽标文案（完整/精简/极简）。供 terminal header 与侧栏会话列表共用，
 * 避免在多处重复写同一三元表达式。旧会话缺省按 full。
 */
export function presetBadgeLabel(preset?: AgentPreset): string {
  if (preset === "minimal") return "⚡ 极简";
  if (preset === "light") return "✨ 精简";
  return "🟢 完整";
}

import { vfs } from "../vfs";
import type { ToolResult } from "./types";

async function toolUpdatePlan(args: Record<string, unknown>): Promise<ToolResult> {
  const plan = String(args.plan ?? "");
  if (!plan.trim()) {
    return {
      ok: false,
      output: "No plan content provided.",
      tool: "update_plan",
      args,
    };
  }
  await vfs.writeFile("PLAN.md", plan);
  const total = (plan.match(/^-\s+\[[ x]\]\s/gm) || []).length;
  const done = (plan.match(/^-\s+\[x\]\s/gm) || []).length;
  return {
    ok: true,
    output: `Plan updated: ${done}/${total} steps done. Written to PLAN.md.`,
    plan,
    tool: "update_plan",
    args,
    mutated: true,
  };
}

function buildPlanSummary(): string {
  const content = vfs.readFileSync("PLAN.md");
  if (!content) return "";
  const lines = content.split("\n");
  const total = (content.match(/^-\s+\[[ x\/-]\]\s/gm) || []).length;
  const done = (content.match(/^-\s+\[x\]\s/gm) || []).length;
  const inProg = (content.match(/^-\s+\[\/\]\s/gm) || []).length;
  const blocked = (content.match(/^-\s+\[-\]\s/gm) || []).length;
  const titleLine = lines.find((l) => /^#\s/.test(l));
  const title = titleLine ? titleLine.replace(/^#+\s*/, "").trim() : "Plan";
  const preview = lines.slice(0, 8).join("\n");
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  const statusParts: string[] = [];
  if (done > 0) statusParts.push(`${done} done`);
  if (inProg > 0) statusParts.push(`${inProg} in progress`);
  if (blocked > 0) statusParts.push(`${blocked} blocked`);
  const statusStr = statusParts.length > 0 ? ` (${statusParts.join(", ")})` : "";

  return `\n## Current plan: ${title} — ${done}/${total} · ${pct}%${statusStr}\n\n\`\`\`\n${preview}\n\`\`\`\n${preview !== content ? `\n_(Plan has ${lines.length} lines — full content in PLAN.md)_\n` : ""}`;
}

export { toolUpdatePlan, buildPlanSummary };

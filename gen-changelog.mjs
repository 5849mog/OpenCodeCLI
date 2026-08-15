// One-off generator for CHANGELOG.md from git history (run via node).
import { execSync } from "node:child_process";
import { writeFileSync } from "node:fs";

// Separator approach: use char 0x1f (unit separator) between fields and
// 0x1e (record separator) between commits — none appear in real messages.
const GIT_FMT = "%h%x1f%ad%x1f%H%x1f%B%x1e";
const out = execSync(
  `git log --pretty=format:${GIT_FMT} --date=format:%Y-%m-%d`,
  { encoding: "utf8", cwd: process.cwd(), maxBuffer: 64 * 1024 * 1024 },
);

const records = out
  .split("\x1e")
  .map((rec) => rec.trim())
  .filter(Boolean)
  .map((rec) => {
    const [hash, date, fullHash, body] = rec.split("\x1f");
    const lines = (body || "").split("\n");
    const subject = (lines[0] || "").trim();
    const rest = lines
      .slice(1)
      .map((l) => l.trim())
      .filter(Boolean);
    return { hash, date, fullHash, subject, rest };
  });

const REPO = "https://github.com/5849mog/OpenCodeCLI";
const commitsUrl = `${REPO}/commit/`;

// Group by date -> list.
const byDate = new Map();
for (const r of records) {
  if (!byDate.has(r.date)) byDate.set(r.date, []);
  byDate.get(r.date).push(r);
}
const dates = [...byDate.keys()].sort((a, b) => (a < b ? 1 : -1));

let md = "";
md += "# 🚀 OpenCodeCLI 成长日志\n\n";
md += `> 由 Git 历史自动整理，共 **${records.length}** 次提交。最新在最上方。\n\n`;
md += "| 日期 | 提交数 | 高亮 |\n";
md += "|------|--------|------|\n";
for (const d of dates) {
  const list = byDate.get(d);
  const feat = list.filter((r) => /^feat/i.test(r.subject)).length;
  const fix = list.filter((r) => /^fix/i.test(r.subject)).length;
  const highlight = [];
  if (feat) highlight.push(`${feat} 个新功能`);
  if (fix) highlight.push(`${fix} 个修复`);
  md += `| ${d} | ${list.length} | ${highlight.join("、") || "—"} |\n`;
}
md += "\n---\n\n";

for (const d of dates) {
  md += `## 📅 ${d}\n\n`;
  for (const r of byDate.get(d)) {
    const type = (r.subject.match(/^([a-z]+)/) || [])[1] || "";
    const icon =
      { feat: "✨", fix: "🐛", docs: "📝", style: "🎨", refactor: "♻️", test: "🧪", chore: "🔧", build: "📦", perf: "⚡", ci: "🔁", revert: "↩️" }[
        type
      ] || "•";
    md += `<details open>\n<summary>${icon} <a href="${commitsUrl}${r.fullHash}">${r.hash}</a> — ${r.subject}</summary>\n`;
    if (r.rest.length) {
      md += `\n> ${r.rest.join("\n> ")}\n`;
    } else {
      md += `\n> _（无详细说明）_\n`;
    }
    md += `\n</details>\n\n`;
  }
}

writeFileSync("CHANGELOG.md", md, "utf8");
console.log(`Wrote CHANGELOG.md with ${records.length} commits across ${dates.length} days.`);

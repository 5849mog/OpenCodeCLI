/**
 * Plan utilities — shared between PlanPanel and any inline summary.
 * Parses Markdown checklist plans into structured data for rendering.
 */

export interface PlanNode {
  depth: number;
  status: "todo" | "done" | "in-progress" | "blocked";
  text: string;
  tags: string[];
  children: PlanNode[];
  /** Stable unique path ("<sectionIdx>/<nodeIdx>/<childIdx>…") for highlighting. */
  path: string;
}

export interface PlanSection {
  title: string;
  nodes: PlanNode[];
}

/** Parse a Markdown plan into structured sections with nested nodes. */
export function parsePlan(plan: string): { sections: PlanSection[]; title: string } {
  const lines = plan.split("\n");
  const sections: PlanSection[] = [];
  let title = "Plan";
  let currentSection: PlanSection = { title: "", nodes: [] };

  for (const line of lines) {
    // Section heading
    const headingMatch = line.match(/^#{2,3}\s+(.+)$/);
    if (headingMatch) {
      if (currentSection.nodes.length > 0 || currentSection.title) {
        sections.push(currentSection);
      }
      currentSection = { title: headingMatch[1].trim(), nodes: [] };
      continue;
    }
    // Top-level title (# Title)
    const titleMatch = line.match(/^#\s+(.+)$/);
    if (titleMatch && sections.length === 0 && currentSection.nodes.length === 0) {
      title = titleMatch[1].trim();
      continue;
    }
    // Task item: optional leading spaces + checkbox + text + optional tags
    const taskMatch = line.match(/^([ \t]*)- \[([ x\/-])]\s+(.+)$/);
    if (taskMatch) {
      const depth = Math.floor(taskMatch[1].length / 2);
      const rawStatus = taskMatch[2];
      const rawText = taskMatch[3];
      const status: PlanNode["status"] =
        rawStatus === "x" ? "done" :
        rawStatus === "/" ? "in-progress" :
        rawStatus === "-" ? "blocked" : "todo";
      // Extract tags: [word] at end of text
      const tags: string[] = [];
      const cleanText = rawText.replace(/\s*\[(\w+)\]/g, (_m: string, tag: string) => {
        tags.push(tag);
        return "";
      }).trim();
      currentSection.nodes.push({ depth, status, text: cleanText, tags, children: [], path: "" });
    }
  }
  if (currentSection.nodes.length > 0 || currentSection.title) {
    sections.push(currentSection);
  }

  // Build parent-child tree: each node's children are nodes at depth+1 following it
  for (const section of sections) {
    const stack: PlanNode[] = [];
    for (const node of section.nodes) {
      while (stack.length > 0 && stack[stack.length - 1].depth >= node.depth) {
        stack.pop();
      }
      if (stack.length > 0) {
        stack[stack.length - 1].children.push(node);
      }
      stack.push(node);
    }
  }

  // Assign stable paths ("<sectionIdx>/<idx>/<childIdx>…") after the tree is built
  sections.forEach((section, si) => {
    const walk = (nodes: PlanNode[], prefix: string) => {
      nodes.forEach((node, i) => {
        node.path = `${prefix}/${i}`;
        walk(node.children, node.path);
      });
    };
    walk(section.nodes, `${si}`);
  });

  return { sections, title };
}

/** Compute stats for a node and its children recursively. */
export function nodeStats(node: PlanNode): { total: number; done: number } {
  let total = 1;
  let done = node.status === "done" ? 1 : 0;
  for (const child of node.children) {
    const s = nodeStats(child);
    total += s.total;
    done += s.done;
  }
  return { total, done };
}

export function computeTotals(nodes: PlanNode[]): { total: number; done: number } {
  let total = 0, done = 0;
  for (const n of nodes) {
    const s = nodeStats(n);
    total += s.total;
    done += s.done;
  }
  return { total, done };
}

/** Compute raw stats from raw plan text (for header badge / summary). */
export function planStats(content: string): { total: number; done: number; inProg: number; blocked: number; pct: number } | null {
  if (!content) return null;
  const todo = (content.match(/^-\s+\[ \]\s/gm) || []).length;
  const done = (content.match(/^-\s+\[x\]\s/gm) || []).length;
  const inProg = (content.match(/^-\s+\[\/\]\s/gm) || []).length;
  const blocked = (content.match(/^-\s+\[-\]\s/gm) || []).length;
  const total = todo + done + inProg + blocked;
  if (total === 0) return null;
  return { total, done, inProg, blocked, pct: Math.round((done / total) * 100) };
}

// ---------------------------------------------------------------------------
// Tag colors
// ---------------------------------------------------------------------------

const TAG_COLORS: Record<string, string> = {
  high: "bg-red-950/20 text-red-400",
  low: "bg-zinc-800 text-zinc-400",
  bug: "bg-orange-950/20 text-orange-400",
  feat: "bg-emerald-950/20 text-emerald-400",
  perf: "bg-purple-950/20 text-purple-400",
  docs: "bg-sky-950/20 text-sky-400",
  test: "bg-pink-950/20 text-pink-400",
};

export function tagColor(tag: string): string {
  return TAG_COLORS[tag.toLowerCase()] ?? "bg-zinc-800 text-zinc-400";
}

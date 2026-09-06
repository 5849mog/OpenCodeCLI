import { describe, expect, it } from "vitest";
import { lineDiff } from "@/lib/diff";

describe("lineDiff", () => {
  it("基本增删与上下文对齐", () => {
    const rows = lineDiff(["a", "b", "c"], ["a", "x", "c"]);
    const types = rows.map((r) => r.type);
    expect(types).toEqual(["ctx", "del", "add", "ctx"]);
  });

  it("空输入处理", () => {
    expect(lineDiff([], [])).toEqual([]);
    expect(lineDiff(["a"], []).every((r) => r.type === "del")).toBe(true);
    expect(lineDiff([], ["b"]).every((r) => r.type === "add")).toBe(true);
  });

  it("超过阈值的大文件退化为全删+全增（不卡死、行号正确）", () => {
    // 2000 × 2000 = 4,000,000 格 > 2,000,000 阈值
    const a = Array.from({ length: 2000 }, (_, i) => `old ${i}`);
    const b = Array.from({ length: 2000 }, (_, i) => `new ${i}`);
    const rows = lineDiff(a, b);
    expect(rows).toHaveLength(4000);
    expect(rows[0].type).toBe("del");
    expect(rows[3999].type).toBe("add");
    // 不含 ctx（未做 LCS 对齐）
    expect(rows.some((r) => r.type === "ctx")).toBe(false);
  });

  it("阈值内的对齐行为正常", () => {
    const a = Array.from({ length: 1000 }, (_, i) => `line ${i}`);
    const b = Array.from({ length: 1000 }, (_, i) => `line ${i}`);
    const rows = lineDiff(a, b);
    expect(rows.every((r) => r.type === "ctx")).toBe(true);
  });
});

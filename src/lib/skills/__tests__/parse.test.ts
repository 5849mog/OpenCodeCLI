import { describe, expect, it } from "vitest";
import { parseSkillMarkdown, serializeSkillMarkdown } from "../index";

// 特征化测试：锁定 SKILL.md 解析/序列化行为，作为 Skills 模块重构的安全网。

describe("parseSkillMarkdown", () => {
  it("完整 frontmatter：name/description/version/dependencies 数组", () => {
    const md = [
      "---",
      "name: code-review",
      "description: Review code changes for quality.",
      "version: 1.1.0",
      "dependencies:",
      "  - data-analysis",
      "  - diagram",
      "license: MIT",
      "---",
      "",
      "# Code Review",
      "",
      "Body text.",
    ].join("\n");

    const out = parseSkillMarkdown(md);
    expect(out.frontmatter).not.toBeNull();
    expect(out.frontmatter!.name).toBe("code-review");
    expect(out.frontmatter!.version).toBe("1.1.0");
    expect(out.frontmatter!.license).toBe("MIT");
    expect(out.description).toBe("Review code changes for quality.");
    expect(out.dependencies).toEqual(["data-analysis", "diagram"]);
    // frontmatter 后的空行属于 body（正则只消费到 `---\n` 为止）
    expect(out.body.trimStart().startsWith("# Code Review")).toBe(true);
  });

  it("dependencies 逗号字符串 → 数组并去空格", () => {
    const md = "---\nname: x\ndescription: d\ndependencies: a, b ,c\n---\n\nbody";
    expect(parseSkillMarkdown(md).dependencies).toEqual(["a", "b", "c"]);
  });

  it("无 frontmatter：body 为原文，description 走正文启发式", () => {
    const md = "# Title\n\nFirst paragraph here.\nMore.";
    const out = parseSkillMarkdown(md);
    expect(out.frontmatter).toBeNull();
    expect(out.body).toBe(md);
    expect(out.description).toBe("First paragraph here.");
    expect(out.dependencies).toEqual([]);
  });

  it("启发式跳过 1-3 级标题与空行，截断到 120 字符", () => {
    const long = "x".repeat(150);
    const md = `# Title\n\n## Sub\n\n- list item first\n\n${long}`;
    const out = parseSkillMarkdown(md);
    expect(out.description).toBe("list item first");
  });

  it("frontmatter 损坏 → 按纯正文处理，绝不抛异常", () => {
    const md = "---\n\t: [bad yaml {{\n---\n\nbody here";
    const out = parseSkillMarkdown(md);
    expect(out.frontmatter).toBeNull();
    expect(out.dependencies).toEqual([]);
  });

  it("description 缺失时回退正文启发式", () => {
    const md = "---\nname: x\n---\n\nIntro paragraph.";
    const out = parseSkillMarkdown(md);
    expect(out.description).toBe("Intro paragraph.");
  });

  it("description 为数字时转字符串", () => {
    const md = "---\nname: x\ndescription: 42\n---\n\nbody";
    expect(parseSkillMarkdown(md).description).toBe("42");
  });

  it("BOM 头正确剥离，frontmatter 仍可解析", () => {
    const md = "\uFEFF---\nname: x\ndescription: bom test\n---\n\nbody";
    const out = parseSkillMarkdown(md);
    expect(out.frontmatter).not.toBeNull();
    expect(out.description).toBe("bom test");
  });
});

describe("serializeSkillMarkdown", () => {
  it("无 frontmatter 且无 deps → 原样返回 body（旧格式零打扰）", () => {
    const parsed = parseSkillMarkdown("# Just body\n");
    expect(serializeSkillMarkdown("x", parsed)).toBe("# Just body\n");
  });

  it("保留未知字段（license），name 强制对齐，deps 写入", () => {
    const md = "---\nname: old-name\ndescription: d\nversion: 1.0.0\nlicense: MIT\n---\n\nbody";
    const out = serializeSkillMarkdown("new-name", parseSkillMarkdown(md), ["dep-a", "dep-b"]);
    const reparsed = parseSkillMarkdown(out);
    expect(reparsed.frontmatter!.name).toBe("new-name");
    expect(reparsed.frontmatter!.license).toBe("MIT");
    expect(reparsed.frontmatter!.version).toBe("1.0.0");
    expect(reparsed.dependencies).toEqual(["dep-a", "dep-b"]);
    expect(reparsed.body.trim()).toBe("body");
  });

  it("deps 去重", () => {
    const md = "---\nname: x\ndescription: d\n---\n\nbody";
    const out = serializeSkillMarkdown("x", parseSkillMarkdown(md), ["a", "a", "b"]);
    expect(parseSkillMarkdown(out).dependencies).toEqual(["a", "b"]);
  });

  it("parse → serialize 往返稳定", () => {
    const md = "---\nname: x\ndescription: d\nversion: 2.0.0\ndependencies:\n  - a\n---\n\nbody text";
    const once = serializeSkillMarkdown("x", parseSkillMarkdown(md));
    const twice = serializeSkillMarkdown("x", parseSkillMarkdown(once));
    expect(twice).toBe(once);
  });
});

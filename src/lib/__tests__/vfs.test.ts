import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  basename,
  dirname,
  grepSync,
  joinPath,
  normalizePath,
  onVfsEvent,
  parentPath,
  splitPath,
  vfs,
} from "@/lib/vfs";

// 特征化测试：锁定 vfs.ts 当前对外行为，作为重构安全网。
// Node 环境由 tests/setup.ts 提供 fake-indexeddb，持久化路径真实走一遍。

beforeEach(async () => {
  await vfs.clear();
});

describe("路径工具", () => {
  it("normalizePath 去首尾斜杠、合并重复斜杠", () => {
    expect(normalizePath("/a//b/")).toBe("a/b");
    expect(normalizePath("a/b")).toBe("a/b");
    expect(normalizePath("///")).toBe("");
    expect(normalizePath("")).toBe("");
  });

  it("splitPath / parentPath / basename / dirname", () => {
    expect(splitPath("a/b/c.txt")).toEqual({ parent: "a/b", name: "c.txt" });
    expect(basename("a/b/c.txt")).toBe("c.txt");
    expect(dirname("a/b/c.txt")).toBe("a/b");
    expect(parentPath("root.txt")).toBe("");
  });

  it("joinPath 拼接并归一化", () => {
    expect(joinPath("a", "b", "c.txt")).toBe("a/b/c.txt");
  });
});

describe("文件读写", () => {
  it("writeFile → readFile 往返", async () => {
    await vfs.writeFile("hello.txt", "hi");
    expect(await vfs.readFile("hello.txt")).toBe("hi");
  });

  it("writeFileSync → readFileSync 往返", () => {
    vfs.writeFileSync("sync.txt", "content");
    expect(vfs.readFileSync("sync.txt")).toBe("content");
  });

  it("读不存在的文件返回 null", async () => {
    expect(await vfs.readFile("nope.txt")).toBeNull();
    expect(vfs.readFileSync("nope.txt")).toBeNull();
  });

  it("writeFile 自动创建祖先目录", async () => {
    await vfs.writeFile("deep/nested/dir/file.txt", "x");
    const dir = vfs.statSync("deep/nested/dir");
    expect(dir?.type).toBe("dir");
    expect(await vfs.readFile("deep/nested/dir/file.txt")).toBe("x");
  });

  it("writeFile 覆盖保留 createdAt、更新 updatedAt", async () => {
    const first = await vfs.writeFile("f.txt", "v1");
    await new Promise((r) => setTimeout(r, 5));
    const second = await vfs.writeFile("f.txt", "v2");
    expect(second.createdAt).toBe(first.createdAt);
    expect(second.updatedAt).toBeGreaterThanOrEqual(first.updatedAt);
    expect(await vfs.readFile("f.txt")).toBe("v2");
  });

  it("写根路径抛错", async () => {
    await expect(vfs.writeFile("", "x")).rejects.toThrow();
  });
});

describe("目录操作", () => {
  it("mkdir + statSync + listSync", async () => {
    await vfs.mkdir("proj");
    vfs.writeFileSync("proj/a.txt", "1");
    vfs.writeFileSync("proj/b.txt", "2");
    const stat = vfs.statSync("proj");
    expect(stat?.type).toBe("dir");
    const list = vfs.listSync("proj");
    expect(list.map((n) => n.path).sort()).toEqual(["proj/a.txt", "proj/b.txt"]);
  });

  it("listAllFilesSync 只返回文件节点", async () => {
    await vfs.mkdir("d");
    vfs.writeFileSync("d/x.txt", "x");
    vfs.writeFileSync("top.txt", "t");
    const files = vfs.listAllFilesSync().map((n) => n.path);
    expect(files).toContain("d/x.txt");
    expect(files).toContain("top.txt");
    expect(files).not.toContain("d");
  });
});

describe("删除与重命名", () => {
  it("delete 文件返回 1，读回为 null", async () => {
    vfs.writeFileSync("f.txt", "x");
    expect(await vfs.delete("f.txt")).toBe(1);
    expect(vfs.statSync("f.txt")).toBeNull();
  });

  it("delete 不存在的路径返回 0", async () => {
    expect(await vfs.delete("ghost.txt")).toBe(0);
  });

  it("delete 目录递归删除子树", async () => {
    await vfs.mkdir("d/sub");
    vfs.writeFileSync("d/sub/f.txt", "x");
    vfs.writeFileSync("d/g.txt", "y");
    const removed = await vfs.delete("d");
    expect(removed).toBeGreaterThanOrEqual(4); // d + sub + 2 files
    expect(vfs.statSync("d")).toBeNull();
    expect(vfs.statSync("d/sub/f.txt")).toBeNull();
  });

  it("rename 迁移内容与路径", async () => {
    vfs.writeFileSync("old.txt", "data");
    await vfs.rename("old.txt", "new.txt");
    expect(vfs.readFileSync("old.txt")).toBeNull();
    expect(vfs.readFileSync("new.txt")).toBe("data");
  });
});

describe("grepSync", () => {
  beforeEach(async () => {
    vfs.writeFileSync("code/app.ts", "const a = 1;\nconst b = 2;\nexport { a };\n");
    vfs.writeFileSync("code/lib/util.ts", "export function util() {}\n");
    vfs.writeFileSync("readme.md", "# Readme\nconst in docs;\n");
  });

  it("全文搜索返回路径、行号、列、文本", () => {
    const hits = grepSync("const");
    expect(hits.length).toBeGreaterThanOrEqual(3);
    const inApp = hits.find((h) => h.path === "code/app.ts" && h.line === 1);
    expect(inApp).toMatchObject({ path: "code/app.ts", line: 1, text: "const a = 1;" });
    expect(inApp!.column).toBe(1);
  });

  it("限定 path 前缀", () => {
    const hits = grepSync("const", { path: "code" });
    expect(hits.every((h) => h.path.startsWith("code/"))).toBe(true);
  });

  it("caseSensitive 默认关闭", () => {
    expect(grepSync("CONST").length).toBeGreaterThan(0);
  });

  it("caseSensitive 开启后不命中大写", () => {
    expect(grepSync("CONST", { caseSensitive: true })).toEqual([]);
  });

  it("max 限制结果数", () => {
    vfs.writeFileSync("big.txt", Array.from({ length: 50 }, () => "hit").join("\n"));
    expect(grepSync("hit", { max: 10 }).length).toBe(10);
  });

  it("非法正则返回空数组不抛异常", () => {
    expect(grepSync("([unclosed", { regex: true })).toEqual([]);
  });
});

describe("treeSync", () => {
  it("输出树形结构包含目录与文件", async () => {
    await vfs.mkdir("proj/src");
    vfs.writeFileSync("proj/src/main.ts", "x");
    vfs.writeFileSync("proj/readme.md", "y");
    const tree = vfs.treeSync("proj");
    expect(tree).toContain("src");
    expect(tree).toContain("main.ts");
    expect(tree).toContain("readme.md");
  });
});

describe("事件订阅", () => {
  it("write 触发 write 事件，delete 触发 delete 事件", async () => {
    const events: string[] = [];
    const off = onVfsEvent((e) => events.push(e.type));
    try {
      await vfs.writeFile("f.txt", "x");
      await vfs.delete("f.txt");
    } finally {
      off();
    }
    expect(events).toContain("write");
    expect(events).toContain("delete");
  });

  it("退订后不再收到事件", async () => {
    const fn = vi.fn();
    const off = onVfsEvent(fn);
    off();
    await vfs.writeFile("f.txt", "x");
    expect(fn).not.toHaveBeenCalled();
  });
});

describe("clear", () => {
  it("清空后所有读取为空", async () => {
    vfs.writeFileSync("a.txt", "1");
    vfs.writeFileSync("b.txt", "2");
    await vfs.clear();
    expect(vfs.readFileSync("a.txt")).toBeNull();
    expect(vfs.readFileSync("b.txt")).toBeNull();
    expect(vfs.allSync()).toEqual([]);
  });
});

import { beforeEach, describe, expect, it } from "vitest";
import { toolBash } from "../bash";
import { vfs } from "@/lib/vfs";

// 特征化测试：锁定 bash.ts 当前对外行为，作为拆分 bash.ts 的回归安全网。
// 已知 bug 的行为用注释显式标注，修复时同步更新断言。

const run = (cmd: string) => toolBash({ command: cmd });

beforeEach(async () => {
  await run("cd /"); // 重置模块级会话 cwd
  await vfs.clear();
});

describe("基础命令", () => {
  it("echo 输出参数（空格连接）", async () => {
    const r = await run("echo hello world");
    expect(r.ok).toBe(true);
    expect(r.output).toBe("hello world");
  });

  it("echo 引号内空格保留", async () => {
    const r = await run('echo "hello   world"');
    expect(r.output).toBe("hello   world");
  });

  it("echo -e 解释 \\n \\t 转义", async () => {
    const r = await run('echo -e "a\\nb"');
    expect(r.output).toBe("a\nb");
  });

  it("未知命令给出沙箱能力提示", async () => {
    const r = await run("definitely-not-a-command");
    expect(r.ok).toBe(false);
    expect(r.output).toContain("command not supported in browser sandbox");
  });

  it("空命令报错", async () => {
    const r = await toolBash({ command: "   " });
    expect(r.ok).toBe(false);
    expect(r.output).toBe("Empty command");
  });
});

describe("管道与重定向", () => {
  it("管道：echo -e | sort", async () => {
    const r = await run('echo -e "b\\na\\nc" | sort');
    expect(r.ok).toBe(true);
    expect(r.output).toBe("a\nb\nc");
  });

  it("> 写入文件，cat 读回（重定向写入带尾换行）", async () => {
    await run("echo data > t.txt");
    const r = await run("cat t.txt");
    expect(r.output).toBe("data\n");
  });

  it(">> 追加不覆盖", async () => {
    const r = await run("echo a > f.txt && echo b >> f.txt && cat f.txt");
    expect(r.output).toBe("a\nb\n");
  });

  it("引号内管道符不是管道", async () => {
    const r = await run("echo 'x | y'");
    expect(r.output).toBe("x | y");
  });

  it("wc -l 统计文件行数（8 列宽格式）", async () => {
    await run("printf 'a\\nb\\nc' > f.txt");
    const r = await run("wc -l f.txt");
    expect(r.ok).toBe(true);
    expect(r.output).toContain("3 f.txt");
  });

  it("head 取前 N 行", async () => {
    await run("seq 1 100 > n.txt");
    const r = await run("head -3 n.txt");
    expect(r.output).toBe("1\n2\n3");
  });
});

describe("控制流", () => {
  it("&& 前者失败则短路", async () => {
    const r = await run("false && echo yes");
    expect(r.ok).toBe(false);
    expect(r.output).not.toContain("yes");
  });

  it("&& 前者成功才执行", async () => {
    const r = await run("true && echo yes");
    expect(r.ok).toBe(true);
    expect(r.output).toBe("yes");
  });

  it("|| 前者失败才执行（失败段带提示行）", async () => {
    const r = await run("false || echo no");
    expect(r.ok).toBe(true);
    expect(r.output).toBe("(command failed: false)\nno");
  });

  it("; 顺序无条件执行", async () => {
    const r = await run("false; echo after");
    expect(r.output).toBe("(command failed: false)\nafter");
  });

  it("for 循环展开变量", async () => {
    const r = await run("for f in a b c; do echo $f; done");
    expect(r.ok).toBe(true);
    expect(r.output).toBe("a\nb\nc");
  });
});

describe("test / [ 条件测试", () => {
  it("test -f 存在的文件为真", async () => {
    await run("touch f.txt");
    const r = await run("test -f f.txt");
    expect(r.ok).toBe(true);
  });

  it("test -f 缺失的文件为假", async () => {
    const r = await run("test -f missing.txt");
    expect(r.ok).toBe(false);
  });

  it("test ! -f 缺失的文件为真", async () => {
    const r = await run("test ! -f missing.txt");
    expect(r.ok).toBe(true);
  });

  it("test -d 目录为真", async () => {
    await run("mkdir d");
    const r = await run("test -d d");
    expect(r.ok).toBe(true);
  });

  it("test -d 文件为假", async () => {
    await run("touch f.txt");
    const r = await run("test -d f.txt");
    expect(r.ok).toBe(false);
  });

  // 已修复：`[` 此前是恒真空壳（bash.ts 旧 1887 行），现复用 test 语义
  it("[ -f 缺失的文件为假（复用 test 语义，剥离尾 ]）", async () => {
    const r = await run("[ -f missing.txt ]");
    expect(r.ok).toBe(false);
  });

  it("[ -f 存在的文件为真", async () => {
    await run("touch f.txt");
    const r = await run("[ -f f.txt ]");
    expect(r.ok).toBe(true);
  });
});

describe("seq", () => {
  it("seq 1 5", async () => {
    const r = await run("seq 1 5");
    expect(r.output).toBe("1\n2\n3\n4\n5");
  });

  it("单参数 seq 5 等价 1..5", async () => {
    const r = await run("seq 5");
    expect(r.output).toBe("1\n2\n3\n4\n5");
  });

  it("seq 1 2 9 步进", async () => {
    const r = await run("seq 1 2 9");
    expect(r.output).toBe("1\n3\n5\n7\n9");
  });

  it("step>0 且 start>end 输出为空占位（不无限循环）", async () => {
    const r = await run("seq 5 1");
    expect(r.ok).toBe(true);
    expect(r.output).toBe("(command completed with no output)");
  });

  // 已修复：step=0 此前落入无限循环分支，现按真实 seq 语义报错
  it("step=0 报错（不无限循环）", async () => {
    const r = await run("seq 1 0 5");
    expect(r.ok).toBe(false);
    expect(r.output).toContain("step cannot be 0");
  });

  it("超天文行数直接报错（预计算，不实际生成）", async () => {
    const r = await run("seq 1 999999999999");
    expect(r.ok).toBe(false);
    expect(r.output).toContain("sandbox limit");
  });

  it("单级输出超过 1MB 截断并提示（cat 路径）", async () => {
    await run("seq 1 900000 > big.txt");
    const r = await run("cat big.txt");
    expect(r.ok).toBe(true);
    expect(r.output.length).toBeGreaterThan(900_000);
    expect(r.output.length).toBeLessThan(1_100_000);
    expect(r.output).toContain("truncated at 1000000");
  });
});

describe("grep 截断上限", () => {
  // 100 条上限 + 截断提示只作用于目录/全工作区 grep（走 grepSync）。
  // 注意：单文件 grep 走 formatMatches，无上限 —— 已记入阶段 3 修复清单。
  it("全工作区搜索超过 100 条截断并提示", async () => {
    await run("seq 1 200 > n.txt");
    const r = await run('grep "1"');
    expect(r.ok).toBe(true);
    expect(r.output).toContain("TRUNCATED at 100");
  });

  it("少量结果不截断", async () => {
    await run("printf 'apple\\nbanana\\ncherry' > f.txt");
    const r = await run('grep "an"');
    expect(r.output).toContain("banana");
    expect(r.output).not.toContain("TRUNCATED");
  });
});

describe("cwd 会话级状态", () => {
  it("cd 后 pwd 反映目录，cd / 回根", async () => {
    await run("mkdir dir");
    await run("cd dir");
    const r = await run("pwd");
    expect(r.output).toBe("/dir");
    await run("cd /");
    expect((await run("pwd")).output).toBe("/");
  });

  it("相对路径基于 cwd 解析", async () => {
    await run("mkdir dir");
    await run("cd dir");
    await run("echo x > a.txt");
    await run("cd /");
    const r = await run("cat dir/a.txt");
    expect(r.output).toBe("x\n");
  });

  it("cd 无参回根", async () => {
    await run("mkdir dir");
    await run("cd dir");
    await run("cd");
    expect((await run("pwd")).output).toBe("/");
  });
});

describe("VFS 交互", () => {
  it("mkdir + ls 列出条目", async () => {
    await run("mkdir a");
    await run("touch a/f1.txt");
    const r = await run("ls a");
    expect(r.output).toContain("f1.txt");
  });

  it("rm 删除文件", async () => {
    await run("echo x > f.txt");
    await run("rm f.txt");
    const r = await run("cat f.txt");
    expect(r.ok).toBe(false);
  });

  it("管道写入文件：cat | sort > out", async () => {
    await run("printf 'b\\na' > in.txt");
    await run("cat in.txt | sort > out.txt");
    const r = await run("cat out.txt");
    expect(r.output).toBe("a\nb\n");
  });
});

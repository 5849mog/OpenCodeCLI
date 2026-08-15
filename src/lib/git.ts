/**
 * git.ts — 本地 Git 版本管理（isomorphic-git + lightning-fs）。
 *
 * 浏览器内跑真实的 git 操作：init / add / commit / log / status / diff / branch。
 * 用 @isomorphic-git/lightning-fs（IndexedDB 二进制）作为 fs 后端，与文件袋
 * VFS（string-only）隔离——git 仓库存独立 IndexedDB，不碰文件袋内容。
 *
 * 本次仅本地；远程（clone/push/pull）需二进制 HTTP client + auth，后续。
 *
 * 用法：
 *   const root = "/repo"; // lightning-fs 工作区根
 *   await gitInit(root);
 *   await gitWriteFile(root, "src/a.ts", "console.log(1)");
 *   await gitAdd(root, "src/a.ts");
 *   await gitCommit(root, "feat: init", author);
 */

import LightningFS from "@isomorphic-git/lightning-fs";
import * as git from "isomorphic-git";

let fsInstance: InstanceType<typeof LightningFS> | null = null;

function getFS() {
  if (!fsInstance) {
    // 独立 IndexedDB 库（worker 为 false，主线程同步 IndexedDB——lightning-fs
    // 兼容无 worker 环境，GitHub Pages 静态部署最简单）。
    fsInstance = new LightningFS("opencode-git");
  }
  return fsInstance;
}

/** 在指定根目录初始化 git 仓库（幂等）。 */
export async function gitInit(dir: string): Promise<void> {
  await git.init({ fs: getFS(), dir });
}
export async function gitInitIfNb(dir: string): Promise<void> {
  try {
    await gitInit(dir);
  } catch {
    /* 已存在或不可 init — 忽略 */
  }
}

/** 写一个文件进 git 工作区（lightning-fs，非 file-bag VFS）。 */
export async function gitWriteFile(dir: string, path: string, content: string): Promise<void> {
  const f = getFS();
  await f.promises.writeFile(`${dir}/${path}`, content);
}

/** 读 git 工作区文件。 */
export async function gitReadFile(dir: string, path: string): Promise<string> {
  const f = getFS();
  return f.promises.readFile(`${dir}/${path}`, "utf8");
}

/** git add（单个文件或目录，'.' = 全部）。 */
export async function gitAdd(dir: string, filepath: string): Promise<void> {
  await git.add({ fs: getFS(), dir, filepath });
}

/** git commit。author 缺省用通用身份。 */
export async function gitCommit(
  dir: string,
  message: string,
  author: { name: string; email: string } = { name: "OpenCode", email: "opencode@local" },
): Promise<string> {
  return git.commit({ fs: getFS(), dir, message, author });
}

/** git log：返回 [{ oid, message, author, date }]。 */
export async function gitLog(dir: string, depth = 30): Promise<{ oid: string; message: string; author: string; date: string }[]> {
  const commits = await git.log({ fs: getFS(), dir, depth });
  return commits.map((c) => ({
    oid: c.oid.slice(0, 7),
    message: c.commit.message.split("\n")[0],
    author: c.commit.author.name,
    date: new Date(c.commit.author.timestamp * 1000).toISOString(),
  }));
}

/** git statusMatrix：文件级状态。1=未改 2=新增未add 3=已add 4=修改未add 5=修改已add。 */
export async function gitStatus(dir: string): Promise<{ path: string; code: number }[]> {
  const matrix = await git.statusMatrix({ fs: getFS(), dir });
  return matrix.map(([filepath, , status2, status3]) => {
    let code: number;
    if (status2 === 0) code = status3 === 0 ? 2 : 3; // 新增
    else if (status3 === 0) code = 4; // 修改未 add（2 + 工作区改动）
    else code = 5;
    return { path: filepath as string, code };
  });
}

/** git diff（工作区 vs HEAD；无 commit 时 diff 为空）。 */
export async function gitDiff(dir: string, ref?: string): Promise<string> {
  try {
    // isomorphic-git 的 diff 在运行时存在但类型未导出——显式访问。
    const g = git as unknown as { diff: (o: object) => Promise<string> };
    const diff = await g.diff({ fs: getFS(), dir, ref: ref ?? "HEAD" });
    return diff ?? "";
  } catch {
    return "(尚无 commit 可对比)";
  }
}

/** 当前分支。 */
export async function gitCurrentBranch(dir: string): Promise<string> {
  return (await git.currentBranch({ fs: getFS(), dir })) ?? "(无分支)";
}

/** 是否已是 git 仓库。 */
export async function gitIsRepo(dir: string): Promise<boolean> {
  try {
    await git.currentBranch({ fs: getFS(), dir });
    return true;
  } catch {
    return false;
  }
}

/** 列出 git 工作区所有文件。 */
export async function gitListFiles(dir: string): Promise<string[]> {
  try {
    return await git.listFiles({ fs: getFS(), dir });
  } catch {
    return [];
  }
}

export const gitEngine = {
  init: gitInit,
  initIfNb: gitInitIfNb,
  writeFile: gitWriteFile,
  readFile: gitReadFile,
  add: gitAdd,
  commit: gitCommit,
  log: gitLog,
  status: gitStatus,
  diff: gitDiff,
  currentBranch: gitCurrentBranch,
  isRepo: gitIsRepo,
  listFiles: gitListFiles,
  getFS,
};

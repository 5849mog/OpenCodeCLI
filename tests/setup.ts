import "fake-indexeddb/auto";

// vfs.getDB() 以 `typeof window === "undefined"` 判定浏览器环境。Node 测试
// 环境补一个指向 globalThis 的 window，让上面的 fake-indexeddb 生效——否则
// 每次 VFS 写入的 fire-and-forget persist 会产生未处理的 Promise 拒绝。
const g = globalThis as { window?: unknown };
if (g.window === undefined) {
  g.window = globalThis;
}

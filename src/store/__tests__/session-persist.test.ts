import { beforeEach, describe, expect, it } from "vitest";
import { flushPersist, schedulePersist } from "@/store/session-persist";
import {
  listSessions,
  loadSession,
  renameSession,
} from "@/lib/session-storage";

// 会话管理审查的回归测试：
// 1) 仅「查看」一个会话不应刷新它的 updatedAt / 排序位置（查看≠修改）。
// 2) 未发生改动的会话不得被 flush 落盘（脏标记语义）。
// 3) 重命名只改标题，不刷新排序时间。

const DAY = 86_400_000;

// SessionState 中 flushPersist 实际读取的最小子集
function mkState(id: string, userText: string) {
  return {
    sessionId: id,
    title: id,
    messages: [
      { role: "user", content: userText },
      { role: "assistant", content: "ok" },
    ],
    events: [
      { id: `${id}-u`, kind: "user", text: userText, ts: 1 },
      { id: `${id}-a`, kind: "assistant-message", text: "ok", ts: 2 },
    ],
    totalTokens: 0,
    lastUsage: null,
    compactedReleases: 0,
    compactCount: 0,
    usageHistory: [],
    vfsChangeLog: [],
    agentPreset: "full",
    refreshSessionList: async () => {},
  };
}

type GetFn = Parameters<typeof flushPersist>[0];
function asStore(state: ReturnType<typeof mkState>): GetFn {
  return (() => state) as unknown as GetFn;
}

async function openDB(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open("opencode-web-sessions", 2);
    r.onupgradeneeded = () => {
      const d = r.result;
      if (!d.objectStoreNames.contains("sessions")) d.createObjectStore("sessions");
      if (!d.objectStoreNames.contains("session-meta"))
        d.createObjectStore("session-meta", { keyPath: "id" });
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

async function seedRaw(rec: Record<string, unknown>) {
  const db = await openDB();
  // mkState 里夹带的 refreshSessionList 函数无法 structured clone——JSON 净化剔除
  const data = JSON.parse(JSON.stringify(rec)) as Record<string, unknown>;
  await new Promise<void>((res, rej) => {
    const tx = db.transaction(["sessions", "session-meta"], "readwrite");
    tx.objectStore("sessions").put(data, data.id as string);
    tx.objectStore("session-meta").put({
      id: data.id,
      title: data.title,
      createdAt: data.createdAt,
      updatedAt: data.updatedAt,
      totalTokens: 0,
      messageCount: 2,
      agentPreset: "full",
    });
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
  });
  db.close();
}

beforeEach(async () => {
  const db = await openDB();
  await new Promise<void>((res) => {
    const tx = db.transaction(["sessions", "session-meta"], "readwrite");
    tx.objectStore("sessions").clear();
    tx.objectStore("session-meta").clear();
    tx.oncomplete = () => res();
  });
  db.close();
});

describe("会话管理：查看不落盘、改名不重排", () => {
  it("在 A 聊天 → 切到旧会话 B 只查看 → 离开，B 的 updatedAt 应保持不变", async () => {
    const oldTs = Date.now() - 30 * DAY;
    const b = mkState("sB", "B 的历史消息");
    await seedRaw({ ...b, id: "sB", createdAt: oldTs, updatedAt: oldTs });

    // 在会话 A 中聊过天（正常脏标记 → 落盘）
    let state = mkState("sA", "A 的消息");
    schedulePersist(asStore(state));
    await flushPersist(asStore(state));

    // 用户切到 B（仅查看，无任何修改），随后切走 → switchSession 的离开 flush
    state = mkState("sB", "B 的历史消息"); // 与种子内容一致 = 未修改
    await flushPersist(asStore(state));

    const rec = await loadSession("sB");
    expect(rec).not.toBeNull();
    expect(rec!.updatedAt).toBe(oldTs);
  });

  it("仅查看过的旧会话不应跳到排序列表首位", async () => {
    const oldTs = Date.now() - 30 * DAY;
    const b = mkState("sB", "B 的历史消息");
    await seedRaw({ ...b, id: "sB", createdAt: oldTs, updatedAt: oldTs });

    let state = mkState("sA", "A 的消息");
    schedulePersist(asStore(state));
    await flushPersist(asStore(state));

    state = mkState("sB", "B 的历史消息");
    await flushPersist(asStore(state));

    const metas = await listSessions();
    // A 刚保存过（真正的更新），B 只是被查看——排序首位应是 A 而非 B
    expect(metas[0]?.id).toBe("sA");
  });

  it("未发生改动的会话（无 schedulePersist）flush 不得落盘", async () => {
    await flushPersist(asStore(mkState("sC", "只看不动")));
    expect(await loadSession("sC")).toBeNull();
  });

  it("重命名只改标题，不刷新排序时间", async () => {
    const oldTs = Date.now() - 30 * DAY;
    const b = mkState("sB", "B 的历史消息");
    await seedRaw({ ...b, id: "sB", createdAt: oldTs, updatedAt: oldTs });

    await renameSession("sB", "改名后的会话");

    const meta = (await listSessions()).find((m) => m.id === "sB");
    expect(meta?.title).toBe("改名后的会话");
    expect(meta?.updatedAt).toBe(oldTs);
    const rec = await loadSession("sB");
    expect(rec?.title).toBe("改名后的会话"); // loadSession 会用 meta 标题合并
    expect(rec?.updatedAt).toBe(oldTs);
  });
});

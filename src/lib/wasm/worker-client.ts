/**
 * worker-client.ts — 常驻 Web Worker 池化客户端（每个 worker 文件一个单例）。
 *
 * 背景：check_types / check_syntax / transpile 共用同一套 Worker 加载模式，但此前
 * 每次调用都 new Worker + 用完 terminate——esbuild.initialize（~9MB wasm 初始化）
 * 和 typescript.js（9MB 解析）每次都重新加载。本模块把生命周期收拢成可复用的客户端：
 *
 *  - 惰性单例：首个 request 才 new Worker（不占内存），此后跨调用复用；
 *  - id 路由：每请求自增 id，回包按 id 分发（worker 顺序处理消息、响应各归各，
 *    并发请求正确但串行执行；乱序到达也各就各位）；
 *  - 超时/取消 = 强杀重建：与既有"超时即 terminate"语义一致，同刻其他 pending
 *    请求一并失败，下个请求自动重开新 worker；
 *  - 加载期错误（无 id 回包，如 importScripts 失败）→ 全部 pending 失败 + 重置；
 *  - 超时计时覆盖"worker 创建 + 执行"全过程（9MB 首次加载也计入）。
 *
 * 协议约定：worker 的成功/失败回包必须带请求 id；仅加载期致命错误不带 id。
 *
 * 用法：createWorkerClient(url).request(payload, { timeoutMs, signal })
 */

export interface WorkerClientOptions {
  /** 请求超时毫秒；默认 120_000。覆盖 worker 创建 + 执行全过程。 */
  timeoutMs?: number;
  /** 取消信号：触发即 reject 该请求并强杀重建 worker（连带其他 pending）。 */
  signal?: AbortSignal;
}

export interface WorkerClient {
  request<T = unknown>(
    payload: Record<string, unknown>,
    opts?: WorkerClientOptions,
  ): Promise<T>;
}

interface PendingEntry {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
  /** 请求结算时移除 signal 监听（防泄漏）。 */
  detachAbort?: () => void;
}

export function createWorkerClient(
  workerUrl: string,
  defaultTimeoutMs = 120_000,
): WorkerClient {
  let worker: Worker | null = null;
  let creating: Promise<Worker> | null = null;
  let creatingReject: ((err: Error) => void) | null = null;
  let seq = 0;
  const pending = new Map<number, PendingEntry>();

  /** 全部 pending 请求立即失败（worker 已不可用）。 */
  function failAll(err: Error): void {
    for (const [, p] of pending) {
      clearTimeout(p.timer);
      p.detachAbort?.();
      p.reject(err);
    }
    pending.clear();
  }

  /** 终止并清空单例（下次 request 自动重建）。 */
  function killAndReset(): void {
    if (worker) {
      try { worker.terminate(); } catch { /* ignore */ }
    }
    worker = null;
    creating = null;
    creatingReject = null;
  }

  function ensureWorker(): Promise<Worker> {
    if (worker) return Promise.resolve(worker);
    if (creating) return creating;
    creating = new Promise<Worker>((resolve, reject) => {
      creatingReject = reject;
      try {
        const w = new Worker(workerUrl, { type: "classic" });
        w.onmessage = (e: MessageEvent) => {
          const msg = e.data as { id?: number; ok?: boolean; error?: string; result?: unknown };
          if (typeof msg.id !== "number") {
            // 无 id 回包 = 加载期致命错误（importScripts 失败、引擎缺失等）
            const err = new Error(msg?.error || "worker 加载失败");
            failAll(err);
            killAndReset();
            reject(err);
            return;
          }
          const p = pending.get(msg.id);
          if (!p) return; // 已超时/已取消的迟到回包，丢弃
          pending.delete(msg.id);
          clearTimeout(p.timer);
          p.detachAbort?.();
          if (msg.ok === false) p.reject(new Error(msg.error || "worker 执行失败"));
          else p.resolve(msg);
        };
        w.onerror = (ev: ErrorEvent) => {
          const err = new Error(ev?.message || "worker 异常");
          failAll(err);
          killAndReset();
          if (creatingReject) {
            const r = creatingReject;
            creatingReject = null;
            r(err);
          }
        };
        worker = w;
        resolve(w);
      } catch (e) {
        reject(e instanceof Error ? e : new Error(String(e)));
      }
    });
    // 结算（成功或失败）后清空 creating，让下一次调用可重建。
    // 注意：不能在上面的 executor 里重置——`creating = new Promise(...)` 是在
    // executor 跑完之后才赋值的，executor 里写 creating = null 会被覆盖，导致
    // 构造失败后 creating 永久保留 rejected promise、worker 永远无法恢复。
    const p = creating;
    const settle = () => {
      if (creating === p) {
        creating = null;
        creatingReject = null;
      }
    };
    p.then(settle, settle);
    return p;
  }

  function request<T>(
    payload: Record<string, unknown>,
    opts?: WorkerClientOptions,
  ): Promise<T> {
    const id = ++seq;
    const timeoutMs = opts?.timeoutMs ?? defaultTimeoutMs;
    return new Promise<T>((resolve, reject) => {
      if (opts?.signal?.aborted) {
        reject(new Error("worker 请求已取消"));
        return;
      }
      const entry: PendingEntry = {
        resolve: (v) => resolve(v as T),
        reject,
        timer: setTimeout(() => {
          // 超时 = 认为 worker 卡死（或加载过久）→ 强杀重建（语义同既有"超时即 terminate"）
          const err = new Error(`worker 请求超时（${Math.round(timeoutMs / 1000)}s）`);
          failAll(err);
          killAndReset();
          reject(err);
        }, timeoutMs),
      };
      if (opts?.signal) {
        const onAbort = () => {
          if (!pending.has(id)) return;
          const err = new Error("worker 请求已取消");
          failAll(err);
          killAndReset();
          reject(err);
        };
        entry.detachAbort = () => opts.signal!.removeEventListener("abort", onAbort);
        opts.signal.addEventListener("abort", onAbort, { once: true });
      }
      pending.set(id, entry);
      ensureWorker().then(
        (w) => {
          // 若已在超时/取消中被清掉，则不再发（worker 已被重建，发出去也无人认领）
          if (pending.has(id)) w.postMessage({ id, ...payload });
        },
        (e) => {
          const p = pending.get(id);
          if (!p) return;
          clearTimeout(p.timer);
          p.detachAbort?.();
          pending.delete(id);
          reject(e instanceof Error ? e : new Error(String(e)));
        },
      );
    });
  }

  return { request };
}

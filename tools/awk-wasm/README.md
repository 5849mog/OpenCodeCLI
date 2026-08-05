# awk-wasm — 浏览器原生 awk 引擎

将 [onetrueawk/awk](https://github.com/onetrueawk/awk)（Brian Kernighan 的经典 awk，标准 POSIX awk）编译为 WebAssembly，在浏览器中运行真正的 awk 解释器。

## 为什么

- 原 JS 模拟器（`src/lib/tools/awk.ts`）是正则近似实现：**没有算术**（`$3*$4` 原样输出）、**没有关联数组**、**没有循环/函数**。
- Wasm 方案提供 100% 兼容的 POSIX awk（字段、算术、数组、函数、循环、printf、正则、sub/gsub 等）。
- 编译在 CI 中自动完成，浏览器加载 wasm 即可运行（与 bc-wasm 同一套管线）。

## 用法

```bash
# 在本地编译（需要 Emscripten SDK + bison；CI 会自动编译）
./build.sh
```

本地没有工具链时，awk 命令自动回退到 JS 降级实现（同 bc）。

## 编译流程

1. 克隆 onetrueawk/awk（无 tag，锁定 `master` 分支）
2. `bison -d awkgram.y` 生成语法表 `awkgram.tab.c/.h`（仓库未提交，必须现场生成）
3. `maketab` 生成 `proctab.c`（用 emcc 编成 node 程序、`NODERAWFS` 直读宿主机磁盘；node 不可用时回退宿主 cc）
4. `emcc -O2 -c` 逐个编译 9 个目标文件，`-lm` 链接
5. **硬门槛冒烟测试**：`BEGIN{print 6*7}` → `42`，以及 `printf` 无换行的 flush 验证

## 输出

| 文件 | 路径 | 用途 |
|------|------|------|
| `awk.wasm` | `public/wasm/awk.wasm` | WebAssembly 二进制 |
| `awk.js` | `public/wasm/awk.js` | Emscripten JS 模块加载器（经典脚本，`window.AWKModule`） |

## 集成

前端通过 `src/lib/wasm/awk-wasm.ts` 调用，提供 `evaluate({ script, args, files, stdin })` API。
`bash.ts` 的 `case "awk":` 重写为调用该引擎；wasm 不可用时回退 `runAwk`（`src/lib/tools/awk.ts`）。

## 调试（CI 优先）

本地**不编译、不装 emsdk**。push 后在 GitHub Actions 的 `Build awk.wasm` 步骤看日志：
要么看到 `Smoke test passed`，要么看到具体报错（bison / maketab / 链接 / undefined symbol），
按报错迭代即可。这是 bc 当初调通的同一路径。

## 许可

onetrueawk/awk 基于 MIT 许可。本工具链脚本遵循项目主体许可。

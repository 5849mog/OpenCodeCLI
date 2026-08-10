# lua-wasm — 浏览器原生 Lua 引擎

将 [lua/lua](https://github.com/lua/lua)（Lua 官方源码镜像，5.4.x）编译为 WebAssembly，让 AI 在浏览器内存中运行真正的 Lua 解释器，做纯计算与复杂数据转换。

## 为什么

- bash 沙箱明确禁止执行任意代码（`NO code execution`）。awk 虽图灵完备，但处理**嵌套数据结构、状态机、跨多个读取结果的累计逻辑、JSON/结构化重组**时非常别扭。
- Lua 是**通用可编程语言**：表、一等函数、闭包、字符串模式匹配、完整控制流——专门补 awk 的短板。
- 安全上**只做内存里的纯计算**：不改 VFS 磁盘、不访问网络、不持久化任何东西。API key 早已只存 sessionStorage（AES-GCM），关页即清空，任何代码都无法持久读出明文钥匙。
- 体积极小：Lua 核心 C 代码约 20 万行量级，编译为 wasm 后远小于 Python(pyodide)。

## 安全边界（严格）

**run_lua 只能做纯计算。** 以下均不可行：
- ❌ 写/改/删文件（VFS 一律不可访问）
- ❌ 发起网络请求 / fetch
- ❌ 持久化任何数据（localStorage / IndexedDB 不可写）
- ❌ 当作通用 shell（无 io/os 系统级操作）

它等价于「在内存里跑一个计算器/转换器」，结果以文本回传。

## 用法

```bash
# 在本地编译（需要 Emscripten SDK；CI 会自动编译）
./build.sh
# 或自动选择策略（编译/已有产物/下载）
./prepare.sh
```

本地没有工具链时，Lua wasm 未就绪则回退到（受限的）JS 降级实现。

## 编译流程

1. 克隆 lua/lua（官方镜像，默认 tag `v5.4.7`；找不到时回退 HEAD）
2. 布局自动兼容（`src/` 子目录或根目录平铺），定位到 lua.c
3. 逐文件 `emcc -O2 -DLUA_USE_POSIX -c` 编译官方 5.4 全部源文件（20 核心 + 12 标准库 + lua.c，**不依赖 Makefile**——镜像仓库布局与官方 tarball 不同，make 目标不可靠）
4. **硬门槛冒烟测试**（node）：`print(6*7)` → `42`，以及 `gsub` 字符串替换
5. 用 awk/bc 同款 emcc 旗标链接成 `window.LUAModule`

## 输出

| 文件 | 路径 | 用途 |
|------|------|------|
| `lua.wasm` | `public/wasm/lua.wasm` | WebAssembly 二进制 |
| `lua.js` | `public/wasm/lua.js` | Emscripten JS 模块加载器（经典脚本，`window.LUAModule`） |

## 集成

前端通过 `src/lib/wasm/lua-wasm.ts` 调用，提供 `evaluate({ script, stdin })` API。
`src/lib/tools/lua.ts` 的 `run_lua` 工具调用该引擎；wasm 不可用时回退受限 JS 实现。

## 调试（CI 优先）

本地**不编译、不装 emsdk**。push 后在 GitHub Actions 的 `Build lua.wasm` 步骤看日志：
要么看到 `Smoke test passed`，要么看到具体报错（configure / make / undefined symbol），
按报错迭代即可。这是 bc / awk 当初调通的同一路径。

## 许可

Lunarmodules/lua 基于 MIT 许可。本工具链脚本遵循项目主体许可。

# bc-wasm — 浏览器原生 bc 引擎

将 [gavinhoward/bc](https://github.com/gavinhoward/bc) 编译为 WebAssembly，在浏览器中运行真正的 bc 解释器。

## 为什么

- 原 JS 模拟器不支持 bc 的完整语法（变量、函数、循环、进制转换等）
- Wasm 方案提供 100% 兼容的 POSIX bc
- 编译在 CI 中自动完成，浏览器加载 wasm 即可运行

## 用法

```bash
# 在本地编译（需要 Emscripten SDK）
./build.sh
```

## 编译流程

1. 克隆 gavinhoward/bc（`--disable-readline --disable-history` 关掉交互特性）
2. 用 emscripten 编译为静态库
3. 链接为 bc.wasm（WebAssembly 二进制）+ bc.mjs（JS loader）

## 输出

| 文件 | 路径 | 用途 |
|------|------|------|
| `bc.wasm` | `public/wasm/bc.wasm` | WebAssembly 二进制 |
| `bc.mjs` | `public/wasm/bc.mjs` | Emscripten JS 模块加载器 |

## 集成

前端通过 `src/lib/wasm/bc-wasm.ts` 调用，提供 `evaluate(expr)` API。

## 许可

gavinhoward/bc 基于 BSD 2-Clause 许可。本工具链脚本遵循项目主体许可。

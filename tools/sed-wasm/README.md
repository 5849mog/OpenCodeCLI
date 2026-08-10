# sed-wasm — 浏览器原生 GNU sed 引擎

将 [GNU sed](https://www.gnu.org/software/sed/)（4.9）编译为 WebAssembly，替换 bash 里那个手写 JS sed（只支持 `s/// d p q a i c` 子集），补齐 `-E`/`-n`/`-e`/`-f`、`y///`、hold/pattern space、`b`/`t` 分支、完整地址语法等真实 sed 能力。

## 为什么

- 原 JS 模拟器（`src/lib/tools/sed.ts` 的 `runSed`）是正则近似实现：无 `-E`（JS 正则默认扩展）、无 `-n`、无 `y///`、无 hold space/分支跳转、无 `-e`/`-f` 多脚本。
- Wasm 方案提供 100% 兼容的 GNU sed（POSIX + GNU 扩展），AI 写复杂 sed 不再需要绕路换 awk。
- 编译在 CI 中自动完成，浏览器加载 wasm 即可运行（与 awk/bc/lua 同一套管线）。

## 用法

```bash
# 在本地编译（需要 Emscripten SDK；CI 会自动编译）
./build.sh
# 或自动选择策略（编译/已有产物/下载）
./prepare.sh
```

本地没有工具链时，sed 命令自动回退到 JS 降级实现（`runSed`，行为与旧版一致）。

## 编译流程

1. **主路径（GNU sed 4.9）**：release tarball（自带 configure）→ `emconfigure ./configure --disable-nls --disable-i18n --disable-acl --without-selinux` → `emmake make`
2. **硬门槛冒烟测试**（node，三个用例全过才算绿）：`s/hi/bye/`、`-E` 扩展正则、`y/abc/xyz/`
3. **回退路径（BusyBox sed）**：GNU 构建任一步失败（CI 上 autotools/gnulib 偶发报错）自动切换——`allnoconfig + CONFIG_SED` 只编 sed applet，shim main 直连 `sed_main`（绕开 busybox 的 argv[0] applet 分发——浏览器里 argv[0] 恒为 `this.program`）
4. 浏览器产物用 awk/bc/lua 同款 emcc 旗标链接成 `window.SedModule`

## 输出

| 文件 | 路径 | 用途 |
|------|------|------|
| `sed.wasm` | `public/wasm/sed.wasm` | WebAssembly 二进制 |
| `sed.js` | `public/wasm/sed.js` | Emscripten JS 模块加载器（经典脚本，`window.SedModule`） |

## 集成

前端通过 `src/lib/wasm/sed-wasm.ts` 调用，提供 `evaluate({ argv, files, stdin, fallback })` API。

接口刻意用「完整 argv + files 内容表」而非 awk 的 script/args 分离：
sed 的 `-f` 脚本文件与数据文件都在 files 里，若像 awk 那样把 files 键全追加到 argv，
会把 `-f` 脚本文件二次当作输入文件（设计时踩坑）。

`bash.ts` 的 `case "sed"` 负责：旗标解析（`-E/-n/-e/-f/-i`）、`-i` 原地写回 VFS
（不把 `-i` 传引擎，引擎输出后由 wrapper 写回，Plan 模式只读拦截不变）、
`-f` 脚本文件读 VFS 注入 MEMFS。wasm 不可用时回退 `runSed`（`src/lib/tools/sed.ts`）。

## 调试（CI 优先）

本地**不编译、不装 emsdk**。push 后在 GitHub Actions 的 `Build sed.wasm` 步骤看日志：
要么看到三行 `smoke OK`，要么看到具体报错（configure / make / 链接 / undefined symbol）。
GNU 失败会自动回退 BusyBox（日志有 `=== GNU sed build failed; falling back` 标记）。
这是 bc/awk/lua 当初调通的同一路径。

## 许可

GNU sed 基于 GPL-3.0；BusyBox 基于 GPL-2.0。本工具链脚本遵循项目主体许可。

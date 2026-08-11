# `run_js` 能力测试报告（QuickJS WebAssembly 引擎）

> 针对新工具 `run_js`（JavaScript → QuickJS WebAssembly）的能力验证矩阵。
> QuickJS 是完整现代 JS 引擎（同 Vue/TypeScript 生态级）——箭头函数、map/filter/reduce、
> 模板字符串、解构、class、原生 JSON 全部支持。
> 引擎：`quickjs-emscripten`（npm 包，release-sync 变体），wasm 由 tools/js-wasm/prepare.sh
> 从 node_modules 拷贝到 public/wasm/js.wasm。

## 记录表

| 编号 | 要验证的能力 | 预期结果 | 是否通过 |
|------|--------------|----------|----------|
| 1    | 基础算术 | `return 6*7` → `42` | ✅ |
| 2    | 箭头函数 | `const f=x=>x*2; return f(21)` → `42` | ✅ |
| 3    | 数组 map/filter/reduce | `[1,2,3,4,5].filter(x=>x%2).map(x=>x*10).reduce((s,x)=>s+x,0)` → `90` | ✅ |
| 4    | 模板字符串 | `const {name} = {name:"AI"}; return \`hi ${name}\`` → `hi AI` | ✅ |
| 5    | 对象解构 | `const {a,b}={a:1,b:2}; return a+b` → `3` | ✅ |
| 6    | class | `class A { add(x){return x+1} } return new A().add(41)` → `42` | ✅ |
| 7    | **原生 JSON parse** | `JSON.parse('{"a":1}')` → 对象 | ✅ |
| 8    | **原生 JSON stringify** | `JSON.stringify({a:1})` → `'{"a":1}'` | ✅ |
| 9    | input 注入 | `JSON.parse(globalThis.__input)` → 读取 input 内容 | ✅ |
| 10   | files 注入 | `globalThis.__files["data.csv"]` → 读到工作区文件副本 | ✅ |
| 11   | args 注入 | `globalThis.__args[0]` → 参数 | ✅ |
| 12   | outputs 写回 | `globalThis.__outputs = {path: content}` → VFS 出现该文件 | ✅ |
| 13   | console.log 捕获 | `console.log("hello")` → stdout | ✅ |
| 14   | 脚本错误 | `throw new Error("x")` → 返回错误信息（含栈） | ✅ |
| 15   | 大输出截断 | 超 20K 字符给截断提示 | ✅ |
| 16   | 空脚本 | missing script 报错 | ✅ |
| 17   | 权限：无网络 | fetch/XMLHttpRequest 不可用（无 DOM/浏览器 API） | ✅ |
| 18   | 权限：无持久化 | localStorage/IndexedDB 不可达 | ✅ |
| 19   | 权限：VFS 只读 | 未注入路径不可达（只读 files 白名单副本） | ✅ |
| 20   | Plan 模式拦截 | 带 outputs → blocked | ✅ |
| 21   | outputs undo | 写回后 undo_edit 可撤销 | ✅ |
| 22   | 降级路径 | wasm 未加载时诚实报错（不降级到裸 eval） | ✅ |

## 与 run_lua 的差异

| 维度 | run_lua | run_js |
|------|---------|--------|
| 引擎 | Lua 5.4 WASM（emcc 编译） | QuickJS WASM（npm 包自带） |
| 输入 | `io.read()` / `io.open('input.txt')`（C 式 stdin） | `globalThis.__input`（全局变量注入） |
| 文件读取 | `io.open(path)`（files 注入 MEMFS） | `globalThis.__files[path]`（全局对象） |
| 输出 | `print()` / return | `console.log` / return 值 |
| 写回 | `io.open(path,'w')`（outputs 白名单） | `globalThis.__outputs = {path: content}` |
| JSON | ❌ 需手写（无 cjson） | ✅ 原生 JSON.parse/stringify |
| 生态 | 标准库（表/字符串模式匹配） | 完整现代 JS 语法 |

## 何时用 run_js（vs run_lua）

- **JSON 处理**（解析/生成/重组）→ run_js 原生支持，run_lua 只能手写
- **现代 JS 风格数据处理**（数组方法链、解构、模板字符串）→ run_js
- **需要 Lua 特性**（coroutine 协程、字符串模式匹配 `%d %a %1`、表原生）→ run_lua
- **文本行列处理** → bash awk/sed（两者都不用）

## 边界

- ⚠️ **同步 JS only**——无 async/await（需要 asyncify 重量级变体，未启用）
- ⚠️ 无 DOM/浏览器 API（document/window/fetch/localStorage 全部不可用）
- ⚠️ 输入一次性预置（非实时交互）
- ❌ 不联网、不持久化、不写白名单外路径

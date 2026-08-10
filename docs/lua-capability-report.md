# `run_lua` 能力测试报告（lua-wasm 原生引擎）

> 针对新工具 `run_lua`（Lua 5.4 → WebAssembly）的能力验证矩阵。
> 背景：bash 沙箱此前明确禁止执行任意代码（`NO code execution`）。`run_lua` 是**唯一允许的执行能力**——在浏览器内存中运行真正的 Lua 解释器，做纯计算；引擎边界保证它不改文件、不联网、不持久化。
> 结果列在 **部署后**（GitHub Pages 链接，应用内直接调用 run_lua）逐条实测填写。

## 记录表

| 编号 | 要验证的能力 | 预期结果 | 实际结果 | 是否通过 |
|------|--------------|----------|----------|----------|
| 1    | 基础算术 | `print(6*7)` → `42` | `42` | ✅ |
| 2    | 字符串拼接 | `print("a".."b"..3)` → `ab3` | `ab3` | ✅ |
| 3    | 字符串格式化 | `string.format("%.2f", 3.14159)` → `3.14` | `3.14` | ✅ |
| 4    | Lua 模式匹配 | `("hello 123"):match("(%d+)")` → `123` | `123` | ✅ |
| 5    | gsub 替换 | `("a1b2"):gsub("%d","#")` → `a#b#` | `a#b# 2`（Lua 返回替换串+次数） | ✅ |
| 6    | 表 / 数组 | `local t={1,2,3} print(#t)` → `3` | `3` | ✅ |
| 7    | 表 / 字典 + 遍历 | `for k,v in pairs({a=1}) do print(k,v) end` → `a 1` | `a 1` | ✅ |
| 8    | 嵌套表 | 嵌套结构组装/取值 | `test 1 2` | ✅ |
| 9    | 循环/条件 | `for i=1,3 do ... end` / `if ... else` | `1 two 3` | ✅ |
| 10   | 函数 + 闭包 | 自定义函数、upvalue | `1 2 3` | ✅ |
| 11   | stdin `io.read("*a")` | 读取 `input` 全部内容 | 修复后复测（见 BUG 记录） | ⏳ |
| 12   | stdin `io.lines()` | 逐行处理 `input` | 修复后复测 | ⏳ |
| 13   | `io.open("input.txt")` | 以文件形式读取同一份 `input` | 修复后复测 | ⏳ |
| 14   | input 分组聚合 | 对多行数字求和/计数/分组 | 修复后复测 | ⏳ |
| 15   | 语法错误 | stderr 返回 `lua: ...` 错误信息，ok:false | `syntax error near 'is'` | ✅ |
| 16   | 运行期错误 | 除零/索引 nil → 报错含 traceback | `attempt to index a nil value` + traceback | ✅ |
| 17   | 大输出截断 | 超 20k 字符给截断提示 | `truncated at 20,000 chars; original 48,892` | ✅ |
| 18   | 空脚本 | `run_lua({script:""})` → 提示 missing script | `run_lua: missing script` | ✅ |
| 19   | 无 input 时 io.read | `io.read('*a')` 返回空 | `EMPTY`（无 input 时空输入） | ✅ |
| 20   | 权限边界：VFS 只读 | 未注入的 VFS 路径不可达（只能读 files 参数注入的副本） | `io.open("/etc/passwd")` → `open failed`；未列出的 `src/...` 同样不可达 | ✅ |
| 21   | 权限边界：无网络 | 脚本内发起请求 → 无此能力 | `socket`/`http` 均 nil，`require` 报 not found | ✅ |
| 22   | Plan 模式可用性 | run_lua 在 Plan 模式可调用（纯计算非变更） | 代码层确认：不在 Plan 模式 mutating 拦截集合 | ✅ |
| 23   | 降级路径 | wasm 未加载时返回「原生引擎不可用」而非假执行 | 本地 dispatch 全链路测试产出该信息 | ✅ |
| 24   | files 读取：`io.open(path)` | `files=['data.csv']`，脚本读到工作区文件真实内容 | `apple,3\nbanana,5\napple,2` 完整读回 | ✅ |
| 25   | files 嵌套路径 | `files=['src/util.ts']`，io.open 可读（父目录自动创建） | `export function util() {...}` 完整读回 | ✅ |
| 26   | files 缺失文件 | `files=['nope.txt']` → ok:false 列明缺失，不运行脚本 | `run_lua: 无法读取指定文件 — 文件不存在: nope.txt`（脚本未执行） | ✅ |
| 27   | files 写入隔离 | 脚本 `io.open(path,'w')` 只改 MEMFS 副本，VFS 原文件不变 | 脚本写入 `HACKED` 后 read_file 读回原内容，VFS 未污染 | ✅ |
| 28   | files 超限 | 文件数 >20 或单文件 >200KB → ok:false 列明原因 | `文件过大(>200,000 字符): big.txt`（233KB，脚本未执行） | ✅ |
| 29   | 脚本以 `--` 开头 | `-- 注释` 开头的脚本正常运行（脚本作为 MEMFS 文件执行，不走 -e 选项解析） | `--`/前导空格/块注释/`-` 开头 4 种均正常（旧版全报 `'-e' needs argument`） | ✅ |
| 30   | script_file 直接跑脚本 | `write_file` 写 tools/filter.lua → `run_lua({script_file:'tools/filter.lua'})` 直接执行 | 部署后实测 | ⏳ |
| 31   | script_file 缺失 | `script_file:'nope.lua'` → ok:false「脚本文件不存在」 | 部署后实测 | ⏳ |
| 32   | script 与 script_file 互斥 | 同时传 → ok:false「只能二选一」 | 部署后实测 | ⏳ |
| 33   | args 参数化 | 脚本读 arg[1..]，同一脚本换参复用 | 部署后实测 | ⏳ |
| 34   | outputs 写回 | outputs=['result.csv']，脚本 io.open 写 → VFS 出现该文件，回传摘要（路径/大小/行数）而非全文 | 部署后实测 | ⏳ |
| 35   | outputs 白名单 | 脚本写未声明路径 → 不同步（VFS 无此文件） | 部署后实测 | ⏳ |
| 36   | outputs 未产生 | 声明了但脚本没写 → 摘要注明「未产生」 | 部署后实测 | ⏳ |
| 37   | outputs 超限 | 单文件 >200KB → ok:false「输出文件过大」 | 部署后实测 | ⏳ |
| 38   | outputs Plan 拦截 | Plan 模式下带 outputs 的 run_lua → blocked | 代码层确认 + 部署实测 | ⏳ |
| 39   | outputs undo | 写回后 undo_edit 可撤销 | 部署后实测 | ⏳ |

## BUG 记录（2026-08-10 实测发现并修复）

**input 参数被 Lua 当作脚本执行**（11-14 首测失败）：见上条。

**`--` 开头的脚本报 `'-e' needs argument`**（实测发现）：
- 现象：脚本第一个字符是 `--`（Lua 注释）时，报 `'-e' needs argument`；行内/行尾注释正常。
- 根因：桥接层用 `lua -e 'script'` 传脚本，`-e` 是命令行选项，选项解析器会碰脚本内容——`--` 开头的脚本被误判为选项标记。
- 修复（`src/lib/wasm/lua-wasm.ts`）：script 改为写成 MEMFS `script.lua` 后 `lua script.lua` 执行（位置参数，内容不经过选项解析，任何开头都安全）；错误信息附带文件名（`script.lua:2: ...`），更清晰。最后写入避免与 files/input.txt 同名冲突。

## BUG 记录（2026-08-10 实测发现并修复）

**input 参数被 Lua 当作脚本执行**（11-14 首测失败）：
- 现象：`input` 内容被解释器当 Lua 源码解析——传 `line1\nline2` 报 `input.txt:2: syntax error near 'line2'`；传合法 Lua 代码则被直接执行；`arg[1]` 恒为 `-e`。
- 根因：桥接层把 `input.txt` 放进了 argv（`lua -e 'script' input.txt`）。Lua 会把**第一个非选项参数当脚本执行**（`handle_script`），input 数据因此在 -e 主脚本跑完后被当代码解析。
- 修复（`src/lib/wasm/lua-wasm.ts`）：input.txt **不再进 argv**，只通过 stdin 回调喂字节（`io.read('*a')`/`io.lines()`），同时写 MEMFS `input.txt` 供 `io.open("input.txt")` 读取。文档同步修正（不再提 `io.open(arg[1])`）。
- 复测路径：重新部署后按 11-14 预期结果验证。

## 测试结论

**（部署后填写）**

### ✅ 说明

- **安全边界是引擎级强制**：wasm 内的 Lua 只有 emscripten 给的 stdin/stdout/MEMFS 文件注入，
  没有 VFS、没有 DOM、没有网络 API——「不改文件/不联网/不持久化」不是提示词建议，而是物理不可达。
- **os/io 库的细微边界**（2026-08-10 实测确认）：`os.execute`、`io.popen`、`os.remove`、
  `os.getenv` 等**函数存在**，但它们触达的是 emscripten 内存沙箱：`os.execute`/`io.popen` 在
  web 环境无宿主进程可调（直接失败），`io.open("/etc/passwd")` 实测 `open failed`（无真实文件系统），
  `os.remove` 只能删 MEMFS 内存文件（如 input.txt），摸不到工作区 VFS。边界成立。
- 本地 `bun dev`（未装 emsdk）时 run_lua 走降级路径（诚实报「原生引擎不可用」），
  以上矩阵反映的是 **部署版（CI 构建的 wasm）** 的行为。
- 简单行列处理（取列、求和、替换）仍应使用 bash awk/sed；run_lua 服务于 awk 表达不了的复杂逻辑。

## 何时不要用 run_lua

- 取第 N 列 / 替换文本 / 行号过滤 → 用 bash `awk` / `sed` / `cut`
- 计算器级算术 → 用 bash `bc`
- 任何「改文件、跑构建、装包、联网」的诉求 → 一律不可行，换用 read/write/edit 工具按步完成

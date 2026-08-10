import type { ToolDefinition } from "../ai-client";

export const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "dispatch_subagent",
      description:
        "⭐ 探索与多文件研究的默认工具——先于 read_file/read_multiple_files 考虑。Dispatch a subagent with its OWN clean context (it does not see this conversation) to explore, read, and analyze files, then return only a conclusion. **Whenever the answer requires reading 2+ files to understand something (how does X work? where is Y? 梳理/探索项目), call THIS first** — it reads in its own context so the file contents never enter yours. Give a precise task: specific paths/glob, the exact question, a return format, a max_iterations cap. It shares the workspace — its edits are visible to you. Returns its final summary. Don't reach for it for a single small edit — but for ANY multi-file exploration it is the default, not the exception.",
      parameters: {
        type: "object",
        properties: {
          task: {
            type: "string",
            description: "A clear description of the subtask. The subagent sees ONLY this (not your conversation). Include specific paths/glob/search keywords, the exact question to answer, and the expected return format.",
          },
          max_iterations: {
            type: "number",
            description: "Max tool-call iterations for the subagent. Default 8. Pure read-only exploration needs 4-6. Increase for complex subtasks.",
          },
        },
        required: ["task"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "read_file",
      description:
        "Read the content of a file from the workspace (文件袋). For files over 1500 lines, only the first 1500 lines are returned by default — use the offset and limit parameters to paginate. Returns the file content as text.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description:
              "Path to the file, relative to the workspace root. e.g. 'src/index.ts', 'README.md'. No leading slash.",
          },
          offset: {
            type: "number",
            description: "1-based line number to start reading from. Useful for paginating large files.",
          },
          limit: {
            type: "number",
            description: "Maximum number of lines to return. Default 1500 for large files, unlimited for small files.",
          },
        },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "write_file",
      description:
        "Create a new file or overwrite an existing file in the workspace (文件袋) with the given content. Parent directories are created automatically. Use this when creating new files or replacing the entire content of an existing file.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description:
              "Path to the file, relative to workspace root. No leading slash.",
          },
          content: {
            type: "string",
            description: "The full content to write to the file.",
          },
        },
        required: ["path", "content"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "edit_file",
      description:
        "Make a targeted edit to an existing file by replacing a unique occurrence of `old_string` with `new_string`. Prefer this over write_file for surgical edits — it preserves the surrounding context and produces a clean diff. The `old_string` MUST appear exactly once in the file; if it appears multiple times, include more surrounding context to disambiguate. Set `replace_all` to true to replace every occurrence.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "Path to the file to edit.",
          },
          old_string: {
            type: "string",
            description:
              "The exact text to find in the file. Must match whitespace and indentation precisely.",
          },
          new_string: {
            type: "string",
            description: "The text to replace it with.",
          },
          replace_all: {
            type: "boolean",
            description: "Replace every occurrence instead of just the first. Default false.",
          },
        },
        required: ["path", "old_string", "new_string"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "delete_file",
      description:
        "Delete a file or a directory (recursively) from the workspace. Use with caution — deletion is permanent.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "Path to the file or directory to delete.",
          },
        },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_files",
      description:
        "List the direct children of a directory in the workspace. Returns one entry per line with type prefix (dir/file). Use this to explore the project layout.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description:
              "Directory path. Use empty string '' for the workspace root. Default ''.",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_dirs",
      description:
        "Recursively list the entire directory tree of the workspace (or a subdirectory). Returns an indented tree view. Use this for a quick overview of the project structure.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "Optional subdirectory to start from. Default '' (root).",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_dir",
      description: "Create a directory (mkdir -p). Parent directories are created automatically. Succeeds silently if the directory already exists.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Directory path to create." },
        },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "move_file",
      description:
        "Move or rename a file or directory. If the destination is an existing directory, the source is moved INTO it (like mv src/ dest/). Overwrites files at the destination path. Works across directories — use this to reorganize files.",
      parameters: {
        type: "object",
        properties: {
          from: { type: "string", description: "Source path." },
          to: { type: "string", description: "Destination path." },
        },
        required: ["from", "to"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_files",
      description:
        "Search for a text pattern across files in the workspace (grep). Returns matching lines with file path and line number. IMPORTANT: by default the pattern is treated as a LITERAL string (regex=false). Only set regex=true if you intentionally want regex metacharacters (.*, \\d, ^, $, etc.) interpreted. If you pass a pattern containing regex metacharacters but leave regex=false, they are matched literally. Supports context lines (-A/-B/-C like grep) and include/exclude glob filters for file types (like grep --include/--exclude). Results are capped at 100 — if the output says 'TRUNCATED', narrow the search.",
      parameters: {
        type: "object",
        properties: {
          pattern: { type: "string", description: "The search pattern. LITERAL by default; set regex=true to interpret as a regular expression." },
          path: {
            type: "string",
            description: "Optional directory to scope the search. Default '' (entire workspace).",
          },
          regex: {
            type: "boolean",
            description: "Treat pattern as a regex. Default false (literal). Set true only when you need regex metacharacters.",
          },
          case_sensitive: { type: "boolean", description: "Default false." },
          after: { type: "number", description: "Number of context lines AFTER each match (like grep -A)." },
          before: { type: "number", description: "Number of context lines BEFORE each match (like grep -B)." },
          context: { type: "number", description: "Number of context lines both before and after (like grep -C). Shortcut for setting both after and before." },
          include: {
            description: "Optional file-type filter: search only files whose path matches ANY of these glob patterns (e.g. '*.ts', '**/*.tsx'). May be a single pattern string or an array of patterns. Each glob is matched against the file's full path, its path relative to 'path', and its basename — so both 'src/**/*.ts' and '*.ts' work. Default: all files.",
            oneOf: [
              { type: "string" },
              { type: "array", items: { type: "string" } },
            ],
          },
          exclude: {
            description: "Optional file-type filter: skip files whose path matches ANY of these glob patterns (e.g. '**/*.test.ts'). May be a single pattern string or an array. Same matching rules as include; applied after include. Default: exclude nothing.",
            oneOf: [
              { type: "string" },
              { type: "array", items: { type: "string" } },
            ],
          },
        },
        required: ["pattern"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "bash",
      description:
        "Run a SIMULATED shell command against the workspace. Supports PIPES (|), OUTPUT redirection (> >>), and INPUT redirection (<). 55+ commands: ls, cat, head, tail, wc, mkdir, rm, touch, echo(-e), printf, cp, mv, find(-name -iname -type -exec), grep(-o -n -i), tree, pwd, cd, sort(-n -r -k -t), uniq(-c), cut(-d -f -c), tr(\\t \\n), sed(native GNU engine: s/// y/// -E -n -i -e -f addresses), nl, awk, paste, bc, expr, xargs, column, comm, join, file, stat, diff, tee, env, hostname, whoami, uname, date, seq, basename, dirname, test, etc. Examples: 'cat file | grep x', 'sort words.txt | uniq -c | sort -rn', 'awk '{print $2}' file', 'sed -i 's/old/new/' file.txt', 'echo hello > out.txt', 'echo -e \"a\\nb\"', 'printf '%5.2f\\n' 3.14159'. In Plan mode bash runs READ-ONLY: writes (>, >>, mkdir, rm, rmdir, touch, cp, mv, sed -i, tee) are BLOCKED. NO package install, NO code execution, NO 2>/2>&1, NO heredoc.",
      parameters: {
        type: "object",
        properties: {
          command: {
            type: "string",
            description: "The shell command to run. Multiple commands can be joined with '&&' or ';'.",
          },
        },
        required: ["command"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "multi_edit",
      description:
        "Apply multiple edits across one or more files in a single coordinated call. Each edit replaces a unique occurrence of old_string with new_string. Use this when you need to make coordinated changes across several files (e.g. renaming a function and updating all its callers). Returns a summary of all edits applied. Note: each edit is independent — if one edit fails, successful ones are NOT rolled back.",
      parameters: {
        type: "object",
        properties: {
          edits: {
            type: "array",
            description: "List of edits to apply. Each edit is independent.",
            items: {
              type: "object",
              properties: {
                path: { type: "string", description: "File path." },
                old_string: { type: "string", description: "Text to find (must be unique unless replace_all is set)." },
                new_string: { type: "string", description: "Replacement text." },
                replace_all: { type: "boolean", description: "Replace all occurrences. Default false." },
              },
              required: ["path", "old_string", "new_string"],
            },
          },
        },
        required: ["edits"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "glob",
      description:
        "Find files in the workspace by glob pattern. Supports * (matches within a single path segment), ** (matches across segments), and ? (single char). e.g. 'src/**/*.ts' finds all TypeScript files under src/, '*.md' finds markdown at the root. Returns matching file paths, sorted. Matching is case-insensitive by default; set case_sensitive to override. Set regex to true to treat the pattern as a regular expression matched against file paths instead of glob syntax.",
      parameters: {
        type: "object",
        properties: {
          pattern: {
            type: "string",
            description: "Glob pattern (e.g. 'src/**/*.ts', '*.md', '**/*.{js,jsx}') or a regex when regex=true.",
          },
          path: {
            type: "string",
            description: "Optional directory to scope the search. The pattern is matched against paths relative to this directory (e.g. path='src/utils' with pattern '*.ts' finds .ts files under src/utils). Default '' (root).",
          },
          case_sensitive: {
            type: "boolean",
            description: "Match case-sensitively. Default false (case-insensitive).",
          },
          regex: {
            type: "boolean",
            description: "Treat pattern as a regular expression matched against file paths. Default false (glob syntax).",
          },
        },
        required: ["pattern"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_symbols",
      description:
        "Search for symbol definitions (functions, classes, methods, interfaces, types, constants) across the workspace using regex patterns. Returns the file, line number, and the matching line. Useful for finding where a function/class is defined without reading whole files. Patterns are matched against lines; use patterns like 'function\\s+myFunc', 'class\\s+MyClass', 'const\\s+MY_CONST'.",
      parameters: {
        type: "object",
        properties: {
          pattern: {
            type: "string",
            description: "Regex pattern to match definition lines. e.g. 'function\\s+greet', 'class\\s+User', 'interface\\s+Config'.",
          },
          path: {
            type: "string",
            description: "Optional directory to scope the search. Default '' (entire workspace).",
          },
          case_sensitive: { type: "boolean", description: "Default false." },
        },
        required: ["pattern"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "update_plan",
      description:
        "Maintain a structured task plan in PLAN.md. The plan is automatically shown in your system prompt every turn — you and the user always see current progress. Best practices: (1) Call this BEFORE starting multi-step work to lay out your approach. (2) Update after each completed step to track progress. (3) Use '- [ ]' / '- [x]' / '- [/]' / '- [-]' for todo/done/in-progress/blocked. (4) Indent with 2 spaces for subtasks. (5) Prefix with '# Title' and use '## Section' for grouping. (6) Add [high] [bug] [feat] tags for priority labels. The current plan summary is always visible in the header and system prompt.",
      parameters: {
        type: "object",
        properties: {
          plan: {
            type: "string",
            description: "Full Markdown content of the plan. Will overwrite PLAN.md. Use '# Plan' as heading, then '- [ ] step' / '- [x] done step' items.",
          },
        },
        required: ["plan"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "append_file",
      description:
        "Append text to the end of a file. If the file does not exist, it is created. More efficient than read_file + write_file when you only need to add content (e.g. logging, appending a function, adding to a TODO list).",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Path to the file." },
          content: { type: "string", description: "Text to append." },
        },
        required: ["path", "content"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "undo_edit",
      description:
        "Undo the last file mutation made by any tool (write_file, edit_file, multi_edit, delete_file, append_file, move_file). Restores all files to their state before the most recent tool call that changed them. Use this when you realize a previous edit was wrong. Can be called multiple times to undo further back. Returns the label of the restored snapshot.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "apply_patch",
      description:
        "Apply a unified-diff style patch to one or more files. This is the most efficient tool for large, multi-location changes — preferred over multiple edit_file calls when you need to change many lines across one or more files. Format:\n\n```\n*** Begin Patch\n*** Update File: path/to/file.ts\n@@\n context line\n-old line\n+new line\n context line\n*** End Patch\n```\n\nRules:\n- Lines starting with `-` are removed, `+` are added, space-prefixed are context (unchanged, used for matching).\n- Context lines MUST match the current file exactly (including indentation).\n- Multiple `*** Update File:` sections can appear in one patch for multi-file changes.\n- Use `*** Add File: path` to create a new file (only `+` lines, no context).\n- Use `*** Delete File: path` to delete a file.\n- If a context line doesn't match, the whole patch fails and no changes are applied (atomic).",
      parameters: {
        type: "object",
        properties: {
          patch: {
            type: "string",
            description: "The full patch text in the format described above.",
          },
        },
        required: ["patch"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "view_outline",
      description:
        "Get a structural outline of a file — lists all functions, classes, methods, interfaces, types, and exports with their line numbers. Much cheaper than read_file when you only need to understand the file's structure. Supports JS/TS, Python, Go, Rust, Java, and other C-like languages. Returns one symbol per line: `lineNum  type  name`.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Path to the file to outline." },
        },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "insert_at",
      description:
        "Insert text at a specific line number in a file. Lines are 1-indexed; line 1 inserts at the very top. To insert at the end, pass a line number larger than the file's line count (e.g. 999999). More efficient than read_file + edit_file when you know exactly where to insert (e.g. 'add a new function after line 42').",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Path to the file." },
          line: { type: "number", description: "1-indexed line number to insert AT (before this line). Use a very large number to append." },
          content: { type: "string", description: "Text to insert." },
        },
        required: ["path", "line", "content"],
      },
    },
  },
  {
    type: "function",
    function: {
    name: "orchestrate_task",
    description:
      "Decompose a task into genuinely INDEPENDENT subtasks, run each in its own sub-agent in PARALLEL, and synthesize the results. Use it when subtasks have no ordering or data dependency between them — e.g. producing several unrelated files or features at once: this parallelizes work that would otherwise be sequential. If subtask B cannot be finished until it sees subtask A's output, they are NOT independent: do them yourself, in sequence. Each sub-agent runs its own bounded loop and spends its own token budget — you must review its output before accepting it. Boundary: for read-only exploration across many files, use dispatch_subagent instead; orchestrate_task is for producing independent work product, not for research.",
      parameters: {
        type: "object",
        properties: {
          task: {
            type: "string",
            description: "The high-level task description. Will be automatically decomposed into independent subtasks.",
          },
          max_sub_agents: {
            type: "number",
            description: "Maximum number of parallel sub-agents. Default 3. Capped at 5.",
          },
          sub_agent_max_iterations: {
            type: "number",
            description: "Max tool-call iterations per sub-agent. Default 8.",
          },
        },
        required: ["task"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "read_multiple_files",
      description:
        "Read MULTIPLE files at once. Takes an array of file paths and returns each file's content with a clear header separator. More efficient than calling read_file repeatedly when you need to understand several files together. Maximum 20 files per call. **NOT for exploration.** If you are reading files to figure out how something works, use dispatch_subagent instead — it reads in its own context and returns a conclusion, keeping file contents out of your context. read_multiple_files is ONLY for when you are about to EDIT those files and need their exact content/line context, or the user explicitly asked to see the contents. **COST WARNING: the full contents land in YOUR context and are re-sent on every later round-trip.**",
      parameters: {
        type: "object",
        properties: {
          paths: {
            type: "array",
            items: { type: "string" },
            description: "Array of file paths to read, relative to workspace root. e.g. ['src/index.ts', 'src/utils.ts', 'README.md']",
          },
        },
        required: ["paths"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "project_stats",
      description:
        "Get workspace statistics: file/directory count, total lines of code, characters, file type breakdown by extension, TODO/FIXME markers count, largest files, and recently modified files. Pass an optional 'path' to scope the analysis to a subdirectory.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "Optional subdirectory path to scope the analysis (e.g. 'src/components'). If omitted, analyzes the entire workspace.",
          },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "ask_user_input",
      description:
        "向用户展示结构化问答面板，支持单选/多选/其他输入和必填校验。用户填写提交后结果会返回给你。当你需要用户做选择、确认、或提供信息时使用此工具。",
      parameters: {
        type: "object",
        properties: {
          title: {
            type: "string",
            description: "问答面板的标题（可选）",
          },
          description: {
            type: "string",
            description: "问答说明文字（可选）",
          },
          submit_label: {
            type: "string",
            description: "提交按钮文案（可选，默认'提交'）",
          },
          questions: {
            type: "array",
            description: "问题数组（必填，至少一个问题）",
            items: {
              type: "object",
              properties: {
                id: {
                  type: "string",
                  description: "问题 ID（可选，不传自动生成）",
                },
                question: {
                  type: "string",
                  description: "问题文案",
                },
                type: {
                  type: "string",
                  enum: ["single_select", "multi_select", "text_input"],
                  description: "single_select=单选, multi_select=多选, text_input=自由文本输入",
                },
                options: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      id: {
                        type: "string",
                        description: "选项 ID（可选）",
                      },
                      label: {
                        type: "string",
                        description: "选项显示文本",
                      },
                      description: {
                        type: "string",
                        description: "选项说明（可选）",
                      },
                    },
                    required: ["label"],
                  },
                },
                required: {
                  type: "boolean",
                  description: "是否必填（默认 true）",
                },
                allow_other: {
                  type: "boolean",
                  description: "是否允许其他输入（默认 false）",
                },
              },
              required: ["question", "type"],
            },
          },
        },
        required: ["questions"],
      },
    },
  },
  // ── Web & Network tools ──
  {
    type: "function",
    function: {
      name: "web_search",
      description:
        "Search the internet for current information. Returns results with titles, URLs, and snippets. Works out of the box — no configuration needed. Use this when you need documentation for a library/API, the user asks about current events or external topics, or fetch_url fails due to CORS. Users can optionally set their own API key in Settings → Web & Search for higher rate limits.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description:
              "The search query. Be specific — include keywords, technology names, and context for best results.",
          },
          max_results: {
            type: "number",
            description:
              "Maximum number of search results to return (1-10). Default 5.",
          },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "fetch_url",
      description:
        "Fetch and read the content of a URL from the internet. Works for CORS-enabled websites and APIs (e.g., GitHub API, package registries, documentation sites). For websites that block CORS, try using web_search to find the information instead, or enable Jina AI Reader in Settings. Returns the page content as text, truncated to ~5000 characters for the agent context.",
      parameters: {
        type: "object",
        properties: {
          url: {
            type: "string",
            description:
              "The full URL to fetch (must start with http:// or https://).",
          },
          format: {
            type: "string",
            enum: ["text", "json"],
            description:
              "Expected response format. 'json' will parse and pretty-print JSON responses. 'text' returns raw text. Default 'text'.",
          },
        },
        required: ["url"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "zip_archive",
      description:
        "把工作区里选定的文件/目录打包成一个真实 .zip 并触发浏览器下载（目录自动递归展开）。IMPORTANT: 本工具只返回短摘要（文件数/总字节/前若干文件名）——文件内容绝不进入对话，真正的 .zip 由浏览器下载。用户要『下载/导出』部分或全部工作区时使用。",
      parameters: {
        type: "object",
        properties: {
          paths: {
            type: "array",
            items: { type: "string" },
            description:
              "要包含的文件或目录路径（相对工作区根，无前导斜杠）。目录会递归展开。如 ['src/', 'README.md']。",
          },
          name: {
            type: "string",
            description:
              "可选输出文件名（可带或不带 .zip）。默认 opencode-workspace-<时间戳>.zip。",
          },
        },
        required: ["paths"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "unzip_archive",
      description:
        "请求用户从本机选择一个 .zip 文件，解压后把文本条目写进工作区（文件袋）。文本文件按内部路径写入；二进制/超大条目写成占位符；zip-slip 路径会被净化。IMPORTANT: 只返回短摘要（文件数/总字节/前若干文件名），文件内容绝不进入对话。用户要『导入/解压』一个 zip 时使用。",
      parameters: {
        type: "object",
        properties: {},
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "run_lua",
      description:
        "在浏览器内存中运行真正的 Lua 5.4 解释器（WebAssembly 原生引擎）——用于 awk 表达不了的复杂逻辑：嵌套数据结构/分组聚合转换、状态机、跨多个读取结果的累计处理、字符串模式匹配、自定义算法。**脚本来源二选一**：`script` 内联程序文本（如 'local t={} for l in io.lines() do t[#t+1]=l end print(#t)'）；或 `script_file` 直接指定工作区 .lua 脚本文件运行（脚本资产化：write_file 写好脚本 → 直接跑，可复用可 review；缺失报错）。可选 `input` 作为数据输入（io.read('*a')/io.lines() 或 io.open('input.txt')）；可选 `files` 读取工作区文件（只传路径，注入只读副本，io.open(path) 读取）；可选 `args` 传给脚本 argv（脚本读 arg[1..]）；可选 `outputs` 声明写回白名单——脚本 io.open(path,'w') 写 MEMFS 后同步回工作区，**回传摘要而非全文（长结果落盘，需要内容用 read_file）**。安全边界（引擎强制）：不访问网络、不持久化；写回仅限 outputs 白名单（未声明路径不同步）、Plan 模式带 outputs 被拦截、可 undo 撤销。简单行列处理用 bash awk/sed。脚本出错返回 lua 错误信息。",
      parameters: {
        type: "object",
        properties: {
          script: {
            type: "string",
            description:
              "Lua 5.4 程序文本（与 script_file 二选一）。例如：'print(6*7)'、'local s=0 for l in io.lines() do s=s+tonumber(l) end print(s)'。多行脚本请用 \\n 换行。",
          },
          script_file: {
            type: "string",
            description:
              "可选。工作区 .lua 脚本文件路径（相对工作区根，如 'tools/filter.lua'），直接运行该脚本（脚本资产化）。与 script 二选一；文件不存在会报错。",
          },
          args: {
            type: "array",
            items: { type: "string" },
            description:
              "可选。传给脚本的 argv，脚本用 arg[1..] 读取（如 ['--mode=fast', 'input.csv']）。用于同一脚本参数化复用。",
          },
          outputs: {
            type: "array",
            items: { type: "string" },
            description:
              "可选。写回白名单——脚本里 io.open(path,'w') 写出的文件路径数组（相对工作区根）。求值后白名单内的文件同步回工作区；**回传摘要而非全文**（长结果落盘，需要内容用 read_file）。未声明路径不同步；最多 20 个、单文件 ≤200KB；Plan 模式下带 outputs 的调用被拦截；可 undo 撤销。",
          },
          input: {
            type: "string",
            description:
              "可选。作为脚本的数据输入：io.read('*a') 读取全部，io.lines() 逐行，或 io.open('input.txt') 以文件形式读同一份数据。用于处理文本数据（如表格、日志）。",
          },
          files: {
            type: "array",
            items: { type: "string" },
            description:
              "可选。要读取的工作区文件路径数组（相对工作区根，无前导斜杠，如 ['data.csv', 'src/util.ts']）。只传路径——内容由系统注入为只读内存副本，脚本用 io.open(path) 读取，无法写回工作区。最多 20 个、单文件 ≤200KB。",
          },
        },
        required: ["script"],
      },
    },
  },
];

export function getToolByName(name: string): ToolDefinition | undefined {
  return TOOL_DEFINITIONS.find((t) => t.function.name === name);
}

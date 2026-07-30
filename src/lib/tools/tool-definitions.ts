import type { ToolDefinition } from "../ai-client";

export const TOOL_DEFINITIONS: ToolDefinition[] = [
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
        "Search for a text pattern across files in the workspace (grep). Returns matching lines with file path and line number. Supports regex and context lines (-A/-B/-C like grep).",
      parameters: {
        type: "object",
        properties: {
          pattern: { type: "string", description: "The search pattern (regex supported)." },
          path: {
            type: "string",
            description: "Optional directory to scope the search. Default '' (entire workspace).",
          },
          regex: {
            type: "boolean",
            description: "Treat pattern as a regex. Default false (literal).",
          },
          case_sensitive: { type: "boolean", description: "Default false." },
          after: { type: "number", description: "Number of context lines AFTER each match (like grep -A)." },
          before: { type: "number", description: "Number of context lines BEFORE each match (like grep -B)." },
          context: { type: "number", description: "Number of context lines both before and after (like grep -C). Shortcut for setting both after and before." },
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
        "Run a SIMULATED shell command against the workspace. Supports PIPES (|), OUTPUT redirection (> >>), and INPUT redirection (<). 55+ commands: ls, cat, head, tail, wc, mkdir, rm, touch, echo(-e), cp, mv, find, grep(-o -n -i), tree, pwd, cd, sort(-n -r -k -t), uniq(-c), cut(-d -f -c), tr(\\t \\n), sed(s/// Nd /pat/d), nl, awk, paste, bc, expr, xargs, column, comm, join, file, stat, diff, tee, env, hostname, whoami, uname, date, seq, basename, dirname, test, etc. Examples: 'cat file | grep x', 'sort words.txt | uniq -c | sort -rn', 'awk '{print $2}' file', 'echo hello > out.txt', 'echo -e \"a\\nb\"'. NO package install, NO code execution, NO 2>/2>&1, NO heredoc.",
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
        "Find files in the workspace by glob pattern. Supports * (matches within a single path segment), ** (matches across segments), and ? (single char). e.g. 'src/**/*.ts' finds all TypeScript files under src/, '*.md' finds markdown at the root. Returns matching file paths, sorted.",
      parameters: {
        type: "object",
        properties: {
          pattern: {
            type: "string",
            description: "Glob pattern. e.g. 'src/**/*.ts', '*.md', '**/*.{js,jsx}'.",
          },
          path: {
            type: "string",
            description: "Optional directory to search in. Default '' (root).",
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
      name: "dispatch_subagent",
      description:
        "Dispatch a subagent to work on an independent subtask. The subagent gets a CLEAN conversation context (it does NOT see the main conversation) and runs its own agent loop with full tool access. Use this for: (1) tasks that would pollute the main context with many tool calls, (2) parallel-ish independent subtasks, (3) deep exploration of a specific area. The subagent shares the same workspace — its file changes are visible to you immediately. Returns the subagent's final text summary. Use sparingly — each subagent call consumes its own token budget.",
      parameters: {
        type: "object",
        properties: {
          task: {
            type: "string",
            description: "A clear description of the subtask. The subagent sees ONLY this (not your conversation). Include enough context for it to work independently.",
          },
          max_iterations: {
            type: "number",
            description: "Max tool-call iterations for the subagent. Default 8. Increase for complex subtasks.",
          },
        },
        required: ["task"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "orchestrate_task",
      description:
        "[PREFERRED for multi-file tasks] Decompose a complex task into independent subtasks, execute them with PARALLEL sub-agents, and synthesize the results. EACH sub-agent runs independently so the total wall-clock time is much FASTER than doing it yourself. Use this WHENEVER the request asks for multiple independent files, features, or components that don't depend on each other (e.g. creating 4 independent project files, building a frontend + backend + docs simultaneously). More efficient than dispatching sub-agents one-by-one. Do NOT treat this as a 'last resort' — it's the BEST tool for multi-component work.",
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
        "Read MULTIPLE files at once. Takes an array of file paths and returns each file's content with a clear header separator. More efficient than calling read_file repeatedly when you need to understand several files together. Maximum 20 files per call. For individual files with pagination, use read_file instead.",
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
];

export function getToolByName(name: string): ToolDefinition | undefined {
  return TOOL_DEFINITIONS.find((t) => t.function.name === name);
}

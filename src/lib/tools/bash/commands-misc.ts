/** 杂项命令族（echo/printf/seq/test/cd/bc/...） */
import * as bcWasm from "../../wasm/bc-wasm";
import { evalArithmetic } from "../../math-eval";
import { bashPrintf } from "../printf";
import { vfs, resolvePath, getCwd, setCwd } from "./context";
import type { BashCaseCtx, CaseResult } from "./context";

export async function runMiscCommands(ctx: BashCaseCtx): Promise<CaseResult> {
  const { program, rest, stdin } = ctx;
  switch (program) {
    case "pwd": {
      const cwd = getCwd();
      return { ok: true, output: cwd ? `/${cwd}` : "/" };
    }

    case "cd": {
      // cd 持久化：更新会话级 cwd。cd（无参）→ 回根；cd .. → 父目录。
      const target = rest[0];
      if (target === undefined) {
        setCwd("");
        return { ok: true, output: "" };
      }
      const resolved = resolvePath(target);
      // 根目录（""）在 VFS cache 中无节点，特判为合法目标。
      if (resolved === "") {
        setCwd("");
        return { ok: true, output: "" };
      }
      // 校验目标存在且是目录
      const stat = vfs.statSync(resolved);
      if (!stat) {
        return { ok: false, output: `cd: ${target}: No such file or directory` };
      }
      if (stat.type !== "dir") {
        return { ok: false, output: `cd: ${target}: Not a directory` };
      }
      setCwd(resolved);
      return { ok: true, output: "" };
    }

    case "clear":

    case "cls":
      return { ok: true, output: "" };

    case "echo": {
      let restArgs = rest;
      const interpretEscapes = restArgs.includes("-e");
      if (interpretEscapes) restArgs = restArgs.filter((t) => t !== "-e");
      let text = restArgs.join(" ").replace(/^["']|["']$/g, "");
      if (interpretEscapes) {
        text = text
          .replace(/\\n/g, "\n")
          .replace(/\\t/g, "\t")
          .replace(/\\r/g, "\r")
          .replace(/\\\\/g, "\\");
      }
      return { ok: true, output: text };
    }

    case "printf": {
      // 解析：跳过未知 - 选项；-v var 消费并忽略（本模拟 bash 无变量系统）；
      // -- 后一个 token 无条件为格式；第一个非 - token 为格式串，其余为参数。
      let ri = 0;
      let fmt: string | undefined;
      while (ri < rest.length) {
        const t = rest[ri];
        if (t === "-v" && rest[ri + 1] !== undefined) { ri += 2; continue; }
        if (t === "--") {
          if (rest[ri + 1] !== undefined) { fmt = rest[ri + 1]; ri += 2; }
          break;
        }
        if (t.startsWith("-")) { ri++; continue; }
        fmt = t;
        ri++;
        break;
      }
      // 无格式 token 时：stdin 整段当格式（剥一个尾换行），否则报错
      if (fmt === undefined) {
        if (stdin !== undefined) fmt = stdin.replace(/\n$/, "");
        else return { ok: false, output: "printf: missing format" };
      }
      // 与真实 printf 一致：不自动追加尾换行，需显式 \n
      return { ok: true, output: bashPrintf(fmt, rest.slice(ri)) };
    }

    case "env":

    case "printenv":
      return { ok: true, output: "PWD=/\nHOME=/\nSHELL=/bin/opencode-web\nLANG=en_US.UTF-8" };

    case "hostname":
      return { ok: true, output: "opencode-web-sandbox" };

    case "whoami":

    case "id":
      return { ok: true, output: "developer" };

    case "uname":
      if (rest.includes("-a")) return { ok: true, output: "OpenCode-Web sandbox 1.0.0 browser-only x86_64 GNU/Web" };
      return { ok: true, output: "OpenCode-Web" };

    case "date":
      if (rest.includes("-u")) return { ok: true, output: new Date().toUTCString() };
      return { ok: true, output: new Date().toString() };

    case "uptime":
      return { ok: true, output: "up (browser sandbox), load average: 0.00, 0.00, 0.00" };

    case "yes":
      return { ok: true, output: (rest[0] ?? "y").repeat(5).split("").map(() => rest[0] ?? "y").join("\n") };

    case "basename": {
      const p = rest.find((t) => !t.startsWith("-"));
      if (!p) return { ok: false, output: "basename: missing operand" };
      return { ok: true, output: p.split("/").pop() ?? p };
    }

    case "dirname": {
      const p = rest.find((t) => !t.startsWith("-"));
      if (!p) return { ok: false, output: "dirname: missing operand" };
      const idx = p.lastIndexOf("/");
      return { ok: true, output: idx < 0 ? "." : p.slice(0, idx) };
    }

    case "realpath":

    case "readlink": {
      const p = rest.find((t) => !t.startsWith("-"));
      if (!p) return { ok: false, output: `${program}: missing operand` };
      return { ok: true, output: "/" + resolvePath(p) };
    }

    case "seq": {
      const nums = rest.filter((t) => /^-?\d+$/.test(t)).map((n) => parseInt(n, 10));
      let start = 1, step = 1, end = 1;
      if (nums.length === 1) { end = nums[0]; }
      else if (nums.length === 2) { start = nums[0]; end = nums[1]; }
      else if (nums.length === 3) { start = nums[0]; step = nums[1]; end = nums[2]; }
      const out: number[] = [];
      if (step > 0) for (let i = start; i <= end; i += step) out.push(i);
      else for (let i = start; i >= end; i += step) out.push(i);
      return { ok: true, output: out.join("\n") };
    }

    case "shuf":

    case "shuffle": {
      const file = resolvePath(rest.find((t) => !t.startsWith("-")) ?? "");
      if (!file) return { ok: false, output: `${program}: missing file` };
      const content = vfs.readFileSync(file);
      if (content === null) return { ok: false, output: `${program}: ${file}: not found` };
      const lines = content.split("\n");
      for (let i = lines.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [lines[i], lines[j]] = [lines[j], lines[i]];
      }
      return { ok: true, output: lines.join("\n") };
    }

    case "bc":

    case "expr": {
      if (program === "bc") {
        // --- Native bc via WebAssembly (with JS fallback) ---
        // Extract flags (-l for math lib) from tokens
        const flags = rest.filter(t => t.startsWith("-"));
        // Rest is the expression; if piped stdin, use that instead
        const args = rest.filter(t => !t.startsWith("-"));
        const calcExpr = (stdin ? args.join(" ") || stdin.trim() : args.join(" ")).trim();

        if (!calcExpr) return { ok: false, output: "bc: no expression provided" };

        // Try WebAssembly bc, fallback to legacy JS evaluator
        try {
          const result = await bcWasm.evaluate(calcExpr, {
            stdin: stdin ?? undefined,
            useMathLib: flags.includes("-l"),
          });
          return result;
        } catch (_e) {
          // Wasm evaluation threw — this shouldn't happen since bcWasm has
          // its own internal fallback, but just in case:
          return { ok: false, output: "bc: evaluation failed" };
        }
      }

      // --- expr command: simple integer expression evaluator ---
      const calcExpr = rest.join(" ").trim();
      if (!calcExpr) return { ok: false, output: "expr: missing expression" };

      try {
        // 安全解析器（无 eval）：只接受数字、+ - * / % ^、括号
        const result = evalArithmetic(calcExpr);
        return { ok: true, output: String(result) };
      } catch {
        return { ok: false, output: "expr: expression evaluation failed" };
      }
    }

    case "which":

    case "whereis": {
      const cmd = rest.find((t) => !t.startsWith("-"));
      if (!cmd) return { ok: false, output: `${program}: missing command` };
      const knownCmds = ["ls", "cat", "head", "tail", "wc", "mkdir", "rm", "rmdir", "touch", "echo", "printf", "cp", "mv", "find", "grep", "sed", "sort", "uniq", "cut", "tr", "awk", "xargs", "pwd", "cd", "tree", "nl", "paste", "bc", "expr", "file", "stat", "diff", "tee", "env", "hostname", "whoami", "id", "uname", "date", "uptime", "rev", "fold", "yes", "basename", "dirname", "realpath", "readlink", "seq", "shuf", "strings", "base64", "column", "comm", "join", "which", "whereis", "true", "false", "test"];
      return { ok: true, output: knownCmds.includes(cmd) ? `/bin/${cmd}` : "" };
    }

    case "noh":

    case "true":
      return { ok: true, output: "" };

    case "false":
      return { ok: false, output: "" };

    case "test": {
      const fFlag = rest.indexOf("-f");
      const dFlag = rest.indexOf("-d");
      const sFlag = rest.indexOf("-s");
      const eFlag = rest.indexOf("-e");
      const notFlag = rest.indexOf("!");
      const isNot = notFlag >= 0;
      if (fFlag >= 0) {
        const path = resolvePath(rest[fFlag + 1] ?? "");
        const stat = vfs.readFileSync(path) !== null;
        return { ok: isNot ? !stat : stat, output: "" };
      }
      if (dFlag >= 0) {
        const path = resolvePath(rest[dFlag + 1] ?? "");
        const stat = vfs.statSync(path);
        const ok = stat !== null && stat.type === "dir";
        return { ok: isNot ? !ok : ok, output: "" };
      }
      if (sFlag >= 0 || eFlag >= 0) {
        const path = resolvePath(rest[(sFlag >= 0 ? sFlag : eFlag) + 1] ?? "");
        const stat = vfs.readFileSync(path) !== null;
        return { ok: isNot ? !stat : stat, output: "" };
      }
      if (rest.length === 1 && rest[0] === "!") return { ok: false, output: "" };
      return { ok: true, output: "" };
    }

    case "[": {
      return { ok: true, output: "" };
    }
    default:
      return null;
  }
}

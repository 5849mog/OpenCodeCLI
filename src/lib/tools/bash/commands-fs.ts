/** 文件系统命令族（ls/cat/find/rm/cp/mv/stat/...） */
import { globToRegex } from "../glob";
import { vfs, resolvePath, splitLines } from "./context";
import type { BashCaseCtx, CaseResult } from "./context";

export async function runFsCommands(ctx: BashCaseCtx): Promise<CaseResult> {
  const { program, rest, stdin, readOnly, resolveInput, runOneShellCommandFromTokens } = ctx;
  switch (program) {
    case "ls": {
      const allFlags = rest.filter((t) => t.startsWith("-")).join("");
      const longFormat = /l/.test(allFlags);
      const sortBySize = /S/.test(allFlags);
      const reverse = /r/.test(allFlags);
      const recursive = /R/.test(allFlags);
      const humanReadable = /h/.test(allFlags);
      const dir = resolvePath(rest.find((t) => !t.startsWith("-")) ?? "");

      const fmtSize = (bytes: number): string => {
        if (!humanReadable) return String(bytes).padStart(8);
        if (bytes < 1024) return String(bytes).padStart(5) + "B";
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1).padStart(5) + "K";
        return (bytes / (1024 * 1024)).toFixed(1).padStart(5) + "M";
      };

      if (recursive) {
        let files = vfs.listAllFilesSync(dir);
        if (sortBySize) {
          files = [...files].sort((a, b) => {
            const sa = (a.content ?? "").length;
            const sb = (b.content ?? "").length;
            return reverse ? sa - sb : sb - sa;
          });
        }
        if (longFormat) {
          const lines = files.map((f) => {
            const size = (f.content ?? "").length;
            const perms = "-rw-r--r--";
            const date = new Date(f.updatedAt).toLocaleDateString("en-US", { month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" });
            return `${perms}  1 developer developer ${fmtSize(size)} ${date} ${f.path}`;
          });
          return { ok: true, output: `total ${files.length}\n${lines.join("\n")}` };
        }
        return { ok: true, output: files.map((f) => "./" + f.path).join("\n") || "" };
      }

      let children = vfs.listSync(dir);
      if (children.length === 0 && dir) {
        const stat = vfs.statSync(dir);
        if (!stat) {
          return { ok: false, output: `ls: ${dir}: No such file or directory` };
        }
        if (stat.type === "file") {
          const size = (stat.content ?? "").length;
          if (longFormat) {
            const date = new Date(stat.updatedAt).toLocaleDateString("en-US", { month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" });
            return { ok: true, output: `-rw-r--r--  1 developer developer ${fmtSize(size)} ${date} ${dir}` };
          }
          return { ok: true, output: dir };
        }
        return { ok: true, output: "" };
      }
      if (children.length === 0) return { ok: true, output: "" };
      if (sortBySize) {
        children = [...children].sort((a, b) => {
          const sa = a.type === "file" ? (a.content ?? "").length : 0;
          const sb = b.type === "file" ? (b.content ?? "").length : 0;
          return reverse ? sa - sb : sb - sa;
        });
      }
      if (longFormat) {
        const lines = children.map((c) => {
          const name = c.path.split("/").pop() ?? c.path;
          const isDir = c.type === "dir";
          const size = isDir ? 0 : (c.content ?? "").length;
          const perms = isDir ? "drwxr-xr-x" : "-rw-r--r--";
          const date = new Date(c.updatedAt).toLocaleDateString("en-US", { month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" });
          return `${perms}  1 developer developer ${fmtSize(size)} ${date} ${name}${isDir ? "/" : ""}`;
        });
        return { ok: true, output: `total ${children.length}\n${lines.join("\n")}` };
      }
      return {
        ok: true,
        output: children
          .map((c) => {
            const name = c.path.split("/").pop() ?? c.path;
            return c.type === "dir" ? name + "/" : name;
          })
          .join("\n"),
      };
    }

    case "tree": {
      const dir = resolvePath(rest.find((t) => !t.startsWith("-")) ?? "");
      return { ok: true, output: vfs.treeSync(dir) || "(empty)" };
    }

    case "cat": {
      const fileArgs = rest.filter((t) => !t.startsWith("-")).map(resolvePath);
      let content: string | null;
      if (fileArgs.length > 0) {
        // 与真实 cat 一致：按参数顺序拼接全部文件，且给出文件时忽略管道 stdin。
        // 旧实现只用 rest.find() 取第一个文件，`cat a b | awk ...` 只会喂 a 的内容。
        const parts: string[] = [];
        for (const f of fileArgs) {
          const c = vfs.readFileSync(f);
          if (c === null) return { ok: false, output: `cat: ${f}: not found` };
          parts.push(c);
        }
        content = parts.join("");
      } else {
        content = resolveInput(undefined).content;
      }
      if (content === null) return { ok: false, output: `cat: (no input)` };
      if (rest.includes("-n")) {
        // cat -n: number each line, 6-digit right-aligned (like nl)
        return { ok: true, output: splitLines(content).map((l, i) => `${String(i + 1).padStart(6)}  ${l}`).join("\n") };
      }
      return { ok: true, output: content };
    }

    case "head": {
      const nFlag = rest.indexOf("-n");
      let n = 10;
      let fileIdx = rest.findIndex((t) => !t.startsWith("-"));
      if (nFlag >= 0 && rest[nFlag + 1]) {
        n = parseInt(rest[nFlag + 1], 10);
        fileIdx = rest.findIndex((t, i) => i > nFlag + 1 && !t.startsWith("-"));
      } else if (n === 10) {
        const numIdx = rest.findIndex((t) => /^-(\d+)$/.test(t));
        if (numIdx >= 0) {
          n = parseInt(rest[numIdx].slice(1), 10);
          fileIdx = rest.findIndex((t, i) => i !== numIdx && !t.startsWith("-"));
        }
      }
      const file = resolvePath(rest[fileIdx] ?? "");
      const { content } = resolveInput(file);
      if (content === null) return { ok: false, output: "head: no input" };
      return { ok: true, output: splitLines(content).slice(0, n).join("\n") };
    }

    case "tail": {
      const nFlag = rest.indexOf("-n");
      let n = 10;
      let fileIdx = rest.findIndex((t) => !t.startsWith("-"));
      if (nFlag >= 0 && rest[nFlag + 1]) {
        n = parseInt(rest[nFlag + 1], 10);
        fileIdx = rest.findIndex((t, i) => i > nFlag + 1 && !t.startsWith("-"));
      } else if (n === 10) {
        const numIdx = rest.findIndex((t) => /^-(\d+)$/.test(t));
        if (numIdx >= 0) {
          n = parseInt(rest[numIdx].slice(1), 10);
          fileIdx = rest.findIndex((t, i) => i !== numIdx && !t.startsWith("-"));
        }
      }
      const file = resolvePath(rest[fileIdx] ?? "");
      const { content } = resolveInput(file);
      if (content === null) return { ok: false, output: "tail: no input" };
      const lines = splitLines(content);
      return { ok: true, output: lines.slice(-n).join("\n") };
    }

    case "wc": {
      const flags = rest.filter((t) => t.startsWith("-")).join("");
      const files = rest.filter((t) => !t.startsWith("-")).map(resolvePath);
      const onlyLines = /l/.test(flags);
      const onlyWords = /w/.test(flags);
      const onlyChars = /c/.test(flags) || /m/.test(flags);

      if (files.length > 1 || (files.length === 1 && stdin === undefined)) {
        const results: string[] = [];
        let totalLines = 0, totalWords = 0, totalBytes = 0;
        for (const f of files) {
          const content = vfs.readFileSync(f);
          if (content === null) {
            results.push(`wc: ${f}: not found`);
            continue;
          }
          const lines = content === "" ? 0 : splitLines(content).length;
          const words = content === "" ? 0 : content.split(/\s+/).filter(Boolean).length;
          const bytes = content.length;
          totalLines += lines;
          totalWords += words;
          totalBytes += bytes;
          if (onlyLines) results.push(`${String(lines).padStart(8)} ${f}`);
          else if (onlyWords) results.push(`${String(words).padStart(8)} ${f}`);
          else if (onlyChars) results.push(`${String(bytes).padStart(8)} ${f}`);
          else results.push(`${String(lines).padStart(8)} ${String(words).padStart(8)} ${String(bytes).padStart(8)} ${f}`);
        }
        if (files.length > 1) {
          if (onlyLines) results.push(`${String(totalLines).padStart(8)} total`);
          else if (onlyWords) results.push(`${String(totalWords).padStart(8)} total`);
          else if (onlyChars) results.push(`${String(totalBytes).padStart(8)} total`);
          else results.push(`${String(totalLines).padStart(8)} ${String(totalWords).padStart(8)} ${String(totalBytes).padStart(8)} total`);
        }
        return { ok: true, output: results.join("\n") };
      }

      const { content } = resolveInput(files[0]);
      if (content === null) return { ok: false, output: "wc: no input" };
      const lines = content === "" ? 0 : splitLines(content).length;
      const words = content === "" ? 0 : content.split(/\s+/).filter(Boolean).length;
      const bytes = content.length;
      const suffix = stdin !== undefined ? "" : ` ${files[0] ?? ""}`;
      if (onlyLines) return { ok: true, output: `${lines}${suffix}` };
      if (onlyWords) return { ok: true, output: `${words}${suffix}` };
      if (onlyChars) return { ok: true, output: `${bytes}${suffix}` };
      return { ok: true, output: `${lines} ${words} ${bytes}${suffix}` };
    }

    case "mkdir": {
      const targets = rest.filter((t) => !t.startsWith("-")).map(resolvePath);
      if (targets.length === 0) return { ok: false, output: "mkdir: missing operand" };
      for (const t of targets) {
        try {
          vfs.mkdirSync(t);
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          return { ok: false, output: msg };
        }
      }
      return { ok: true, output: "", mutated: true };
    }

    case "rm": {
      const targets = rest.filter((t) => !t.startsWith("-")).map(resolvePath);
      if (targets.length === 0) return { ok: false, output: "rm: missing operand" };
      let total = 0;
      const missing: string[] = [];
      for (const t of targets) {
        const stat = vfs.statSync(t);
        if (!stat) { missing.push(t); continue; }
        vfs.delete(t);
        total++;
      }
      const parts = [`removed ${total} node(s)`];
      if (missing.length > 0) parts.push(`not found: ${missing.join(", ")}`);
      return { ok: missing.length === 0, output: parts.join("; "), mutated: total > 0 };
    }

    case "rmdir": {
      const targets = rest.filter((t) => !t.startsWith("-")).map(resolvePath);
      if (targets.length === 0) return { ok: false, output: "rmdir: missing operand" };
      for (const t of targets) {
        const node = vfs.statSync(t);
        if (!node) return { ok: false, output: `rmdir: ${t}: No such file or directory` };
        if (node.type !== "dir") return { ok: false, output: `rmdir: ${t}: Not a directory` };
        if (vfs.listSync(t).length > 0) return { ok: false, output: `rmdir: ${t}: Directory not empty` };
        vfs.delete(t); // fire-and-forget (matches rm's convention; cache update is synchronous-ish)
      }
      return { ok: true, output: "", mutated: true };
    }

    case "touch": {
      const targets = rest.filter((t) => !t.startsWith("-")).map(resolvePath);
      if (targets.length === 0) return { ok: false, output: "touch: missing operand" };
      for (const t of targets) {
        if (vfs.readFileSync(t) === null) vfs.writeFileSync(t, "");
      }
      return { ok: true, output: "", mutated: true };
    }

    case "cp": {
      const targets = rest.filter((t) => !t.startsWith("-")).map(resolvePath);
      if (targets.length < 2) return { ok: false, output: "cp: missing operand" };
      const [from, to] = targets;
      const content = vfs.readFileSync(from);
      if (content === null) return { ok: false, output: `cp: ${from}: not found` };
      vfs.writeFileSync(to, content);
      return { ok: true, output: "", mutated: true };
    }

    case "mv": {
      const targets = rest.filter((t) => !t.startsWith("-")).map(resolvePath);
      if (targets.length < 2) return { ok: false, output: "mv: missing operand" };
      const [from, to] = targets;
      vfs.renameSync(from, to);
      return { ok: true, output: "", mutated: true };
    }

    case "find": {
      const positional = rest.filter((t) => !t.startsWith("-") && t !== "{}" && !/\\+;/.test(t) && t !== ";");
      let root = resolvePath(positional[0] ?? "");
      if (root === ".") root = "";
      else if (root === "./") root = "";
      const typeIdx = rest.indexOf("-type");
      const typeFilter = typeIdx >= 0 ? rest[typeIdx + 1] : null;
      const nameIdx = rest.indexOf("-name");
      const inameIdx = rest.indexOf("-iname");
      const useIname = inameIdx >= 0;
      const pattern = useIname ? rest[inameIdx + 1] : nameIdx >= 0 ? rest[nameIdx + 1] : null;
      const execIdx = rest.indexOf("-exec");
      const execTokens = execIdx >= 0 ? rest.slice(execIdx + 1) : [];
      const execCmd: string[] = [];
      if (execIdx >= 0) {
        for (const t of execTokens) {
          if (/\\+;/.test(t) || t === ";") break;
          execCmd.push(t);
        }
      }
      // Candidate nodes: -type d → dirs; otherwise files (default output keeps
      // listing files only). Include the root itself so `find src -type d` shows src.
      let nodes = vfs
        .allSync()
        .filter((n) => !root || n.path === root || n.path.startsWith(root + "/"))
        .sort((a, b) => a.path.localeCompare(b.path));
      if (typeFilter === "d") {
        nodes = nodes.filter((n) => n.type === "dir");
      } else {
        nodes = nodes.filter((n) => n.type === "file");
      }
      // -name / -iname: EXACT glob against the basename — anchored, so `*.ts`
      // never substring-matches `mytsconfig.json`. matchDot:true mirrors real
      // find (a bare `*` matches hidden basenames).
      if (pattern) {
        const re = globToRegex(pattern, { matchDot: true });
        const nameRe = useIname ? new RegExp(re.source, "i") : re;
        nodes = nodes.filter((n) => nameRe.test(n.path.split("/").pop() ?? n.path));
      }
      if (execCmd.length > 0) {
        const results: string[] = [];
        let allOk = true;
        for (const n of nodes) {
          const fullPath = "./" + n.path;
          const cmdTokens = execCmd.map((t) => (t === "{}" ? fullPath : t));
          const r = await runOneShellCommandFromTokens(cmdTokens, undefined, readOnly);
          if (r.output) results.push(r.output);
          if (!r.ok) allOk = false;
        }
        // Propagate inner failures (incl. Plan-mode blocks) instead of always ok:true
        return { ok: allOk, output: results.join("\n") || "(command completed with no output)" };
      }
      const dirSuffix = typeFilter === "d" ? "/" : "";
      return {
        ok: true,
        output: nodes.map((n) => "./" + n.path + dirSuffix).join("\n"),
      };
    }

    case "nl": {
      const file = resolvePath(rest.find((t) => !t.startsWith("-")) ?? "");
      const { content } = resolveInput(file);
      if (content === null) return { ok: false, output: "nl: no input" };
      const lines = content.split("\n");
      return { ok: true, output: lines.map((l, i) => `${String(i + 1).padStart(6)}  ${l}`).join("\n") };
    }

    case "file": {
      const file = resolvePath(rest.find((t) => !t.startsWith("-")) ?? "");
      if (!file) return { ok: false, output: "file: missing file" };
      const stat = vfs.statSync(file);
      if (!stat) return { ok: false, output: `file: ${file}: not found` };
      if (stat.type === "dir") return { ok: true, output: `${file}: directory` };
      const content = stat.content ?? "";
      const ext = file.split(".").pop()?.toLowerCase() ?? "";
      const typeMap: Record<string, string> = {
        ts: "TypeScript source", tsx: "TypeScript JSX source", js: "JavaScript source", jsx: "JavaScript JSX source",
        py: "Python source", go: "Go source", rs: "Rust source", json: "JSON data", md: "Markdown document",
        html: "HTML document", css: "CSS source", yaml: "YAML data", sql: "SQL source", sh: "shell script",
      };
      const type = typeMap[ext] ?? "ASCII text";
      return { ok: true, output: `${file}: ${type} (${content.length} bytes, ${content.split("\n").length} lines)` };
    }

    case "stat": {
      const file = resolvePath(rest.find((t) => !t.startsWith("-")) ?? "");
      if (!file) return { ok: false, output: "stat: missing file" };
      const node = vfs.statSync(file);
      if (!node) return { ok: false, output: `stat: ${file}: not found` };
      return {
        ok: true,
        output: `  File: ${file}\n  Type: ${node.type}\n  Size: ${node.type === "file" ? (node.content ?? "").length : 0} bytes\n  Modified: ${new Date(node.updatedAt).toISOString()}\n  Created: ${new Date(node.createdAt).toISOString()}`,
      };
    }

    case "tee": {
      const file = resolvePath(rest.find((t) => !t.startsWith("-")) ?? "");
      if (!file) return { ok: false, output: "tee: missing file" };
      // Real tee writes its stdin to the file AND echoes it to stdout. When
      // piped (e.g. `echo hi | tee out`), stdin carries the text; without a
      // pipe, fall back to the trailing args as the text.
      if (stdin !== undefined) {
        vfs.writeFileSync(file, stdin);
        return { ok: true, output: stdin, mutated: true };
      }
      const text = rest.slice(rest.indexOf(file) + 1).join(" ");
      vfs.writeFileSync(file, text + "\n");
      return { ok: true, output: text, mutated: true };
    }

    case "head_dash":

    case "strings": {
      const file = resolvePath(rest.find((t) => !t.startsWith("-")) ?? "");
      if (!file) return { ok: false, output: `${program}: missing file` };
      const content = vfs.readFileSync(file);
      if (content === null) return { ok: false, output: `${program}: ${file}: not found` };
      const matches = content.match(/[\x20-\x7E]{4,}/g);
      return { ok: true, output: matches ? matches.join("\n") : "" };
    }

    case "base64": {
      const decode = rest.includes("-d") || rest.includes("--decode");
      const file = resolvePath(rest.find((t) => !t.startsWith("-")) ?? "");
      const { content } = resolveInput(file);
      if (content === null) return { ok: false, output: "base64: no input" };
      try {
        if (decode) {
          const clean = content.replace(/\s/g, "");
          const binary = atob(clean);
          const bytes = new Uint8Array(binary.length);
          for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
          const decoded = new TextDecoder("utf-8").decode(bytes);
          return { ok: true, output: decoded };
        } else {
          const bytes = new TextEncoder().encode(content);
          let binary = "";
          for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
          return { ok: true, output: btoa(binary) };
        }
      } catch {
        return { ok: false, output: `base64: invalid input` };
      }
    }

    case "xxd":

    case "od":

    case "hexdump": {
      // 十六进制查看，兼容真实 xxd 主格式：`偏移: 每行16字节十六进制  ASCII`。
      // 支持 -n/-l <len> 限制查看长度；od/hexdump 作为别名统一十六进制输出。
      let limit = Infinity;
      const nIdx = Math.max(rest.indexOf("-n"), rest.indexOf("-l"));
      const nVal = nIdx >= 0 ? rest[nIdx + 1] : undefined;
      if (nVal && /^\d+$/.test(nVal)) limit = parseInt(nVal, 10);
      // file 提取：排除 -n/-l 及其取值，避免 `xxd -n 20 file` 把 20 当文件名。
      const file = resolvePath(
        rest.find((t) => !t.startsWith("-") && t !== nVal) ?? "",
      );
      if (!file) return { ok: false, output: `${program}: missing file` };
      const content = vfs.readFileSync(file);
      if (content === null) return { ok: false, output: `${program}: ${file}: not found` };
      const bytes = new TextEncoder().encode(content);
      const perLine = 16;
      const lines: string[] = [];
      for (let off = 0; off < bytes.length && off < limit; off += perLine) {
        const hex: string[] = [];
        const ascii: string[] = [];
        for (let j = 0; j < perLine && off + j < bytes.length && off + j < limit; j++) {
          const b = bytes[off + j];
          hex.push(b.toString(16).padStart(2, "0"));
          ascii.push(b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : ".");
        }
        while (hex.length < perLine) hex.push("  "); // 尾行对齐真实 xxd 的空白
        lines.push(`${off.toString(16).padStart(8, "0")}: ${hex.join(" ")}  ${ascii.join("")}`);
      }
      return { ok: true, output: lines.join("\n") };
    }

    case "paste": {
      const sIdx = rest.indexOf("-s");
      const dIdx = rest.indexOf("-d");
      const serial = sIdx >= 0;
      const delim = dIdx >= 0 ? rest[dIdx + 1] : "\t";
      const files = rest
        .filter((t) => !t.startsWith("-") && t !== (dIdx >= 0 ? rest[dIdx + 1] : ""))
        .map((f) => resolvePath(f));
      if (serial) {
        const file = files[0];
        const { content } = resolveInput(file);
        if (content === null) return { ok: false, output: `paste: ${file ?? "(no input)"}: not found` };
        return { ok: true, output: content.split("\n").join(delim) };
      }
      if (files.length >= 2) {
        const contents = files.map((f) => vfs.readFileSync(f));
        const missing = contents.findIndex((c) => c === null);
        if (missing >= 0) return { ok: false, output: `paste: ${files[missing]}: not found` };
        const allLines = contents.map((c) => c!.split("\n"));
        const maxLines = Math.max(...allLines.map((l) => l.length));
        const out: string[] = [];
        for (let i = 0; i < maxLines; i++) {
          out.push(allLines.map((lines) => lines[i] ?? "").join(delim));
        }
        return { ok: true, output: out.join("\n") };
      }
      return { ok: false, output: "paste: missing operands" };
    }
    default:
      return null;
  }
}

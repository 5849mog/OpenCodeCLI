/** 文本处理命令族（grep/sed/awk/sort/uniq/...） */
import * as awkWasm from "../../wasm/awk-wasm";
import * as sedWasm from "../../wasm/sed-wasm";
import { vfs, grepSync, resolvePath, splitLines, escapeRegExp } from "./context";
import type { BashCaseCtx, CaseResult } from "./context";

export async function runTextCommands(ctx: BashCaseCtx): Promise<CaseResult> {
  const { program, rest, stdin, readOnly, resolveInput, runOneShellCommandFromTokens } = ctx;
  switch (program) {
    case "grep": {
      // Parse args respecting flag values (-C 3 consumes the 3)
      const flags: string[] = [];
      const positional: string[] = [];
      for (let ri = 0; ri < rest.length; ri++) {
        const t = rest[ri];
        if (t.startsWith("-")) {
          flags.push(t);
          if ((t === "-C" || t === "-A" || t === "-B") && ri + 1 < rest.length && !rest[ri + 1].startsWith("-")) {
            ri++; // skip the flag's value argument
          }
        } else {
          positional.push(t);
        }
      }
      const allFlags = flags.join("");
      if (positional.length === 0) {
        return { ok: false, output: "grep: missing pattern" };
      }
      const pattern = positional[0];
      const fileArg = resolvePath(positional[1] ?? "");
      const caseSensitive = !/i/.test(allFlags);
      const onlyMatch = /o/.test(allFlags);
      const withLineNum = /n/.test(allFlags);
      const invert = /v/.test(allFlags);
      const countOnly = /c/.test(allFlags);
      const filesOnly = /l/.test(allFlags);
      const quiet = /q/.test(allFlags);
      const ctxC = /C/.test(allFlags);
      const ctxA = /A/.test(allFlags);
      const ctxB = /B/.test(allFlags);
      const hasCtx = ctxC || ctxA || ctxB;
      const isSingleFile = !!(fileArg && positional.length === 2); // only 1 file given
      // -F：固定字符串（字面匹配，`|` 等元字符不再特殊）。-E/-G 在本环境同为 ERE，仅用于提示。
      const fixedString = /F/.test(allFlags);
      // ERE 路径下若用户误用 BRE 写法 `a\|b`（`\|` 在 ERE 里是"字面 |"，常导致静默无匹配），给个提示。
      const breStyleEscapedPipe = !fixedString && pattern.includes("\\|");

      let re: RegExp;
      try {
        re = new RegExp(
          fixedString ? escapeRegExp(pattern) : pattern,
          caseSensitive ? "g" : "gi",
        );
      } catch {
        return { ok: false, output: `grep: invalid pattern: ${pattern}` };
      }
      // grepSync（目录递归 / 全工作区）也要用同一套字面/正则语义。
      const syncPattern = fixedString ? escapeRegExp(pattern) : pattern;
      // ERE 语义提示（仅当用户走了 `a\|b` BRE 误写且没开 -F 时报一次）。
      const ereHint =
        breStyleEscapedPipe
          ? `\n⚠️ grep 用 ERE：\`|\` 是"或"，\`\\|\` 是"字面 |"。写 \`a\\|b\` 会找字面 "a|b"。要"或"请用 \`a|b\`，要字面请用 -F。`
          : "";
      const withHint = (out: string): string => (out === "" ? out : out + ereHint);

      /** Return whether a line matches (respecting -v). */
      const matchLine = function (line: string): boolean {
        re.lastIndex = 0;
        return invert ? !re.test(line) : re.test(line);
      };

      /** Split content, strip trailing empty line from terminal trailing \n. */
      const splitLines = function (s: string): string[] {
        const l = s.split("\n");
        if (l.length > 1 && l[l.length - 1] === "") l.pop();
        return l;
      };

      /** Build prefix for a matched/context line. */
      const linePrefix = function (idx: number, sep: string, isStdin: boolean): string {
        if (isStdin) return withLineNum ? `${idx + 1}${sep} ` : "";
        return isSingleFile ? `${idx + 1}${sep} ` : `${fileArg}:${idx + 1}${sep} `;
      };

      /** Find all matching line indices. Cap at 100（与 workspace grep 的 max:100
       *  对齐——此前单文件/stdin 路径无上限，大文件会把数万行灌进 AI 上下文）。 */
      let hitsTruncated = false;
      const findHits = function (lines: string[]): number[] {
        const h: number[] = [];
        for (let i = 0; i < lines.length; i++) {
          if (matchLine(lines[i])) {
            if (h.length >= 100) { hitsTruncated = true; break; }
            h.push(i);
          }
        }
        return h;
      };
      const hitsTruncNote = () =>
        hitsTruncated ? "\n⚠️ grep: results TRUNCATED at 100 — there are MORE matches. Narrow the search." : "";

      /** Parse context value from rest (supports -C3 and -C 3). */
      const getCtxVal = function (flag: string): number {
        const idx = rest.indexOf(flag);
        if (idx >= 0 && idx + 1 < rest.length && !rest[idx + 1].startsWith("-")) return Math.max(0, parseInt(rest[idx + 1], 10) || 0);
        const combined = flags.find((t) => t.startsWith(flag) && t.length > flag.length);
        return combined ? Math.max(0, parseInt(combined.slice(flag.length), 10) || 0) : 0;
      };

      /** Format grep output with optional context lines. */
      const formatMatches = function (lines: string[], isStdin: boolean): string[] {
        const hits = findHits(lines);
        if (hits.length === 0) return [];

        if (countOnly) return [isSingleFile ? String(hits.length) : `${fileArg}:${hits.length}`];
        if (filesOnly) return [fileArg ?? "-"];
        if (quiet) return [];

        if (onlyMatch) {
          const out: string[] = [];
          for (const idx of hits) {
            re.lastIndex = 0;
            const matches = lines[idx].match(re);
            if (matches) {
              for (const m of matches) out.push(linePrefix(idx, ":", isStdin) + m);
            }
          }
          return out;
        }

        if (!hasCtx) {
          const out: string[] = [];
          for (const idx of hits) out.push(linePrefix(idx, ":", isStdin) + lines[idx]);
          return out;
        }

        // With context (-C, -A, -B)
        let afterCtx = 0, beforeCtx = 0;
        if (ctxC) { const v = getCtxVal("-C"); afterCtx = v; beforeCtx = v; }
        else { if (ctxA) afterCtx = getCtxVal("-A"); if (ctxB) beforeCtx = getCtxVal("-B"); }
        const out: string[] = [];
        let lastPrinted = -1;

        for (const idx of hits) {
          const start = Math.max(0, idx - beforeCtx);
          const end = Math.min(lines.length - 1, idx + afterCtx);
          if (lastPrinted >= 0 && start > lastPrinted + 1) out.push("--");
          for (let j = start; j <= end; j++) {
            if (j > lastPrinted) {
              const isHit = hits.includes(j);
              out.push(linePrefix(j, isHit ? ":" : "-", isStdin) + lines[j]);
              lastPrinted = j;
            }
          }
        }
        return out;
      };

      if (quiet) {
        if (stdin !== undefined || fileArg) {
          const s = stdin ?? vfs.readFileSync(fileArg!);
          if (s === null) return { ok: false, output: `grep: ${fileArg}: not found` };
          const lines = splitLines(s);
          for (let i = 0; i < lines.length; i++) { if (matchLine(lines[i])) return { ok: true, output: "" }; }
          return { ok: true, output: "(no matches)" };
        }
        const matches = grepSync(syncPattern, { regex: true, caseSensitive, max: 1 });
        return { ok: true, output: matches.length > 0 ? "" : "(no matches)" };
      }

      if (stdin !== undefined) {
        const lines = splitLines(stdin);
        const out = formatMatches(lines, true) as string[]; const outAll = hitsTruncated ? [...out, hitsTruncNote()] : out;
        return { ok: true, output: withHint(outAll.join("\n") || "") };
      }
      if (fileArg) {
        const content = vfs.readFileSync(fileArg);
        if (content === null) {
          // Check if it's a directory — do recursive search if so
          const stat = vfs.statSync(fileArg);
          if (stat && stat.type === "dir") {
            const matches = grepSync(syncPattern, { path: fileArg, regex: true, caseSensitive, max: 100 });
            if (matches.length === 0) return { ok: true, output: "" };
            const truncated = Boolean((matches as (typeof matches & { truncated?: boolean })).truncated);
            const truncNote = truncated ? `\n⚠️ grep: results TRUNCATED at 100 — there are MORE matches. Narrow the search.` : "";
            if (countOnly) return { ok: true, output: String(matches.length) };
            if (filesOnly) return { ok: true, output: matches.map((m) => m.path).filter((p, i, a) => a.indexOf(p) === i).join("\n") };
            return { ok: true, output: withHint(matches.map((m) => `${m.path}:${m.line}: ${m.text}`).join("\n") + truncNote) };
          }
          return { ok: false, output: `grep: ${fileArg}: not found` };
        }
        const lines = splitLines(content);
        const out = formatMatches(lines, false) as string[]; const outAll = hitsTruncated ? [...out, hitsTruncNote()] : out;
        return { ok: true, output: withHint(outAll.join("\n") || "") };
      }
      // Workspace-wide search (no file arg)
      const matches = grepSync(syncPattern, { regex: true, caseSensitive, max: 100 });
      if (matches.length === 0) return { ok: true, output: "" };
      const truncated = Boolean((matches as (typeof matches & { truncated?: boolean })).truncated);
      const truncNote = truncated ? `\n⚠️ grep: results TRUNCATED at 100 — there are MORE matches. Narrow the search.` : "";
      if (countOnly) return { ok: true, output: String(matches.length) };
      if (filesOnly) return { ok: true, output: matches.map((m) => m.path).filter((p, i, a) => a.indexOf(p) === i).join("\n") };
      return {
        ok: true,
        output: withHint(matches.map((m) => `${m.path}:${m.line}: ${m.text}`).join("\n") + truncNote),
      };
    }

    case "sed": {
      // 原生 GNU sed 引擎（WebAssembly）。-i 原地写回 VFS 保留在 wrapper 层：
      // 不把 -i 传给引擎（MEMFS 里的改名写回碰不到 VFS），而是引擎输出后
      // 由这里 vfs.writeFileSync 写回（与旧 JS 实现一致）。
      const sedArgs: string[] = [];
      const positional: string[] = [];
      let inplace = false;
      let i = 0;
      while (i < rest.length) {
        const t = rest[i];
        // -i / -iSUFFIX / --in-place：wrapper 处理，不传引擎（-i.bak 备份在沙箱内不建）
        if (t === "-i" || (t.startsWith("-i") && t.length > 2) || t === "--in-place" || t.startsWith("--in-place")) {
          inplace = true; i += 1; continue;
        }
        if (t === "-e" && rest[i + 1] !== undefined) { sedArgs.push(t, rest[i + 1]); i += 2; continue; }
        if (t.startsWith("-e") && t.length > 2)      { sedArgs.push(t); i += 1; continue; }
        if (t === "-f" && rest[i + 1] !== undefined) { sedArgs.push(t, rest[i + 1]); i += 2; continue; }
        if (t.startsWith("-f") && t.length > 2)      { sedArgs.push(t); i += 1; continue; }
        if (t.startsWith("-")) { sedArgs.push(t); i += 1; continue; } // -E/-n/-r/-s/-z 等原样传引擎
        positional.push(t); i += 1;
      }

      // 脚本来源：-e/-f 已含脚本 → positional 全是数据文件；否则 positional[0] 是脚本、
      // 其余全是数据文件（多文件！GNU sed 无 -s 时按一条流依次处理，行号跨文件连续）。
      // 空字符串脚本（sed ''）合法 = no-op 原样输出，与旧 JS 及真实 sed 一致。
      const scriptFromFlag = sedArgs.some((a) => a === "-e" || a.startsWith("-e") || a === "-f" || a.startsWith("-f"));
      const script = scriptFromFlag ? "" : (positional[0] ?? "");
      if (positional.length === 0 && !scriptFromFlag) return { ok: false, output: "sed: missing script" };
      const dataFiles = (scriptFromFlag ? positional : positional.slice(1)).map(resolvePath);
      const file = dataFiles[0] ?? undefined;
      const { content, source } = resolveInput(file);
      if (content === null && dataFiles.length === 0) return { ok: false, output: "sed: no input" };
      const fromStdin = source === "stdin";

      // files：全部数据文件 + -f 脚本文件 → MEMFS 内容表（argv 里的每个文件都要有内容；
      // 缺失文件报错，与 GNU sed 的 "can't read" 语义一致）
      const files: Record<string, string> = {};
      if (!fromStdin) {
        for (const df of dataFiles) {
          const c = df === file ? content : vfs.readFileSync(df);
          if (c === null) return { ok: false, output: `sed: can't read ${df}: No such file or directory` };
          files[df] = c;
        }
      }

      // JS 降级入参：-e/-f 的脚本拼成一段（-f 读 VFS 脚本文件内容并注入 MEMFS）
      let fbScript = script;
      if (scriptFromFlag) {
        const parts: string[] = [];
        for (let k = 0; k < sedArgs.length; k++) {
          const a = sedArgs[k];
          if (a === "-e" && sedArgs[k + 1] !== undefined) { parts.push(sedArgs[k + 1]); k += 1; }
          else if (a.startsWith("-e") && a.length > 2) { parts.push(a.slice(2)); }
          else if (a === "-f" && sedArgs[k + 1] !== undefined) {
            const sc = vfs.readFileSync(sedArgs[k + 1]);
            if (sc === null) return { ok: false, output: `sed: can't read ${sedArgs[k + 1]}: No such file or directory` };
            files[sedArgs[k + 1]] = sc;
            parts.push(sc);
            k += 1;
          } else if (a.startsWith("-f") && a.length > 2) {
            const sf = a.slice(2);
            const sc = vfs.readFileSync(sf);
            if (sc === null) return { ok: false, output: `sed: can't read ${sf}: No such file or directory` };
            files[sf] = sc;
            parts.push(sc);
          }
        }
        fbScript = parts.join(";");
      }

      // -i 多文件：GNU -i 隐含 -s（每文件独立行号/独立处理）→ 逐文件求值写回
      if (inplace && dataFiles.length > 1) {
        for (const df of dataFiles) {
          const r = await sedWasm.evaluate({
            argv: [
              ...sedArgs,
              ...(!scriptFromFlag && positional.length > 0 ? [script] : []),
              df,
            ],
            files, // 全量注入（含 -f 脚本文件；多余文件不进 argv 无副作用）
            fallback: { script: fbScript, content: files[df] },
          });
          if (!r.ok) return { ok: false, output: r.output };
          vfs.writeFileSync(df, r.output === "(no output)" ? "" : r.output);
        }
        return { ok: true, output: "", mutated: true };
      }

      const result = await sedWasm.evaluate({
        argv: [
          ...sedArgs,
          ...(!scriptFromFlag && positional.length > 0 ? [script] : []),
          ...(!fromStdin ? dataFiles : []),
        ],
        files: Object.keys(files).length > 0 ? files : undefined,
        stdin: fromStdin && content !== null ? content : undefined,
        // 降级（单内容）：stdin 原样；多文件拼成一条流（近似 GNU 流式语义——
        // 每文件去尾换行再 join \n，避免文件间多出空行）
        fallback: {
          script: fbScript,
          content: fromStdin && content !== null
            ? content
            : dataFiles.map((df) => (files[df].endsWith("\n") ? files[df].slice(0, -1) : files[df])).join("\n"),
        },
      });
      if (!result.ok) return { ok: false, output: result.output };
      if (inplace && file) {
        vfs.writeFileSync(file, result.output === "(no output)" ? "" : result.output);
        return { ok: true, output: "", mutated: true };
      }
      return { ok: true, output: result.output };
    }

    case "sort": {
      // The file is the LAST non-flag token — flags like -t DELIM or -k KEY
      // precede it, so a delimiter value (' ' after -t) must not be mistaken
      // for the file.
      let file: string | undefined;
      for (let i = rest.length - 1; i >= 0; i--) {
        if (!rest[i].startsWith("-")) { file = resolvePath(rest[i]); break; }
      }
      const { content } = resolveInput(file);
      if (content === null) return { ok: false, output: "sort: no input" };
      // splitLines drops the phantom record from a trailing \n, so a file
      // ending in newline doesn't sort a stray empty line to the top.
      const lines = content === "" ? [] : splitLines(content);
      const allFlags = rest.filter((t) => t.startsWith("-")).join("");
      const reverse = /r/.test(allFlags);
      const caseInsensitive = /f/.test(allFlags);
      const numeric = /n/.test(allFlags);
      const kMatch = rest.find((t) => t.startsWith("-k"));
      const keyField = kMatch ? parseInt(kMatch.slice(2), 10) - 1 : -1;
      const tIdx = rest.indexOf("-t");
      const delim = tIdx >= 0 ? rest[tIdx + 1] : /\s+/;
      const sorted = [...lines].sort((a, b) => {
        let ca = a, cb = b;
        if (keyField >= 0) {
          const af = a.split(delim).filter(Boolean);
          const bf = b.split(delim).filter(Boolean);
          ca = af[keyField] ?? "";
          cb = bf[keyField] ?? "";
        }
        if (caseInsensitive) { ca = ca.toLowerCase(); cb = cb.toLowerCase(); }
        if (numeric) {
          const na = parseFloat(ca), nb = parseFloat(cb);
          if (isNaN(na) && isNaN(nb)) return 0;
          if (isNaN(na)) return 1;
          if (isNaN(nb)) return -1;
          return na - nb;
        }
        return ca < cb ? -1 : ca > cb ? 1 : 0;
      });
      if (reverse) sorted.reverse();
      return { ok: true, output: sorted.join("\n") };
    }

    case "uniq": {
      const file = resolvePath(rest.find((t) => !t.startsWith("-")) ?? "");
      const { content } = resolveInput(file);
      if (content === null) return { ok: false, output: "uniq: no input" };
      const count = rest.includes("-c");
      const lines = content.split("\n");
      const result: string[] = [];
      let prev: string | null = null;
      let cnt = 0;
      for (const line of lines) {
        if (line === prev) { cnt++; }
        else {
          if (prev !== null) result.push(count ? `${String(cnt).padStart(7)} ${prev}` : prev);
          prev = line;
          cnt = 1;
        }
      }
      if (prev !== null) result.push(count ? `${String(cnt).padStart(7)} ${prev}` : prev);
      return { ok: true, output: result.join("\n") };
    }

    case "cut": {
      // The file is the LAST non-flag token, so option VALUES (-d DELIM, -f N,
      // -c RANGE) are never mistaken for the file (e.g. `cut -d' ' -f1 file`).
      let file: string | undefined;
      for (let i = rest.length - 1; i >= 0; i--) {
        if (!rest[i].startsWith("-")) { file = resolvePath(rest[i]); break; }
      }
      const { content } = resolveInput(file);
      if (content === null) return { ok: false, output: "cut: no input" };

      // --- Fallback for combined forms like -d,, -f2, -c1-3 (no space) ---
      let dIdx = rest.indexOf("-d");
      let fIdx = rest.indexOf("-f");
      let cIdx = rest.indexOf("-c");

      // Combined -d, (with comma as delimiter, e.g. `-d,`)
      if (dIdx === -1) {
        const dToken = rest.find((t) => /^-d['"](.)['"]$/.test(t));
        if (dToken) {
          dIdx = rest.indexOf(dToken);
          rest[dIdx] = "-d";
          rest.splice(dIdx + 1, 0, (dToken.match(/^-d['"](.)['"]$/) as RegExpMatchArray)[1]);
        }
      }
      // Combined -f2 (no space)
      if (fIdx === -1) {
        const fToken = rest.find((t) => /^-f[\d,\-]/.test(t));
        if (fToken) {
          fIdx = rest.indexOf(fToken);
          rest[fIdx] = "-f";
          rest.splice(fIdx + 1, 0, fToken.slice(2));
        }
      }
      // Combined -d, (single char, no quotes, e.g. `-d,`)
      if (dIdx === -1) {
        const dToken = rest.find((t) => /^-d[^'"\s-]/.test(t) && t.length === 3);
        if (dToken) {
          dIdx = rest.indexOf(dToken);
          rest[dIdx] = "-d";
          rest.splice(dIdx + 1, 0, dToken[2]);
        }
      }
      // Combined -c1-3 (no space)
      if (cIdx === -1) {
        const cToken = rest.find((t) => /^-c[\d,\-]/.test(t));
        if (cToken) {
          cIdx = rest.indexOf(cToken);
          rest[cIdx] = "-c";
          rest.splice(cIdx + 1, 0, cToken.slice(2));
        }
      }

      dIdx = rest.indexOf("-d");
      fIdx = rest.indexOf("-f");
      cIdx = rest.indexOf("-c");

      // --- -d -f mode ---
      if (fIdx >= 0) {
        const delim = dIdx >= 0 ? rest[dIdx + 1] : "\t";
        const rawFields = rest[fIdx + 1];
        // Expand range syntax: "1-3,5" → [1, 2, 3, 5]
        const fieldNums: number[] = [];
        for (const part of rawFields.split(",")) {
          const rangeMatch = part.match(/^(\d+)-(\d+)$/);
          if (rangeMatch) {
            const start = parseInt(rangeMatch[1], 10);
            const end = parseInt(rangeMatch[2], 10);
            for (let n = start; n <= end; n++) fieldNums.push(n);
          } else {
            fieldNums.push(parseInt(part, 10));
          }
        }
        const fields = fieldNums.map((n) => n - 1);
        const lines = content.split("\n").map((line) =>
          line.split(delim).filter((_, i) => fields.includes(i)).join(delim),
        );
        return { ok: true, output: lines.join("\n") };
      }

      // --- -c mode ---
      if (cIdx >= 0) {
        const range = rest[cIdx + 1];
        let start = 0, end: number | undefined;
        const m = range.match(/^(\d+)?-(\d+)?$/);
        if (m) {
          start = m[1] ? parseInt(m[1], 10) - 1 : 0;
          end = m[2] ? parseInt(m[2], 10) : undefined;
        } else if (/^\d+$/.test(range)) {
          // Single number: -c 1 → column 1 only
          const n = parseInt(range, 10);
          start = n - 1;
          end = n;
        } else {
          return { ok: false, output: `cut: invalid range: ${range}` };
        }
        const lines = content.split("\n").map((line) => line.slice(start, end));
        return { ok: true, output: lines.join("\n") };
      }

      return { ok: false, output: "cut: use -d DELIM -f FIELDS or -c RANGE" };
    }

    case "tr": {
      const deleteMode = rest.includes("-d");
      const sets = rest.filter((t) => !t.startsWith("-"));
      const minSets = deleteMode ? 1 : 2;
      if (sets.length < minSets) return { ok: false, output: deleteMode ? "tr: -d needs SET1" : "tr: needs SET1 and SET2" };
      const set1 = sets[0];
      const set2 = deleteMode ? "" : sets[1];
      const file = resolvePath(sets[deleteMode ? 1 : 2] ?? "");
      const { content } = resolveInput(file);
      if (content === null) return { ok: false, output: "tr: no input" };
      const unescape = (s: string) => s.replace(/\\t/g, "\t").replace(/\\n/g, "\n").replace(/\\\\/g, "\\");
      const expand = (s: string) => {
        s = unescape(s);
        const m = s.match(/^(.)-(.)$/);
        if (m) {
          const result: string[] = [];
          for (let c = m[1].charCodeAt(0); c <= m[2].charCodeAt(0); c++) result.push(String.fromCharCode(c));
          return result.join("");
        }
        return s;
      };
      const from = expand(set1);
      const to = expand(set2);
      const map: Record<string, string> = {};
      if (deleteMode) {
        // tr -d 'set': delete every char in set1
        for (const ch of from) map[ch] = "";
      } else {
        for (let i = 0; i < from.length; i++) map[from[i]] = to[i] ?? to[to.length - 1] ?? "";
      }
      const result = content.replace(/[\s\S]/g, (ch) => map[ch] ?? ch);
      return { ok: true, output: result };
    }

    case "diff": {
      const unified = rest.includes("-u");
      const files = rest.filter((t) => !t.startsWith("-")).map(resolvePath);
      if (files.length < 2) return { ok: false, output: "diff: needs two files" };
      const a = vfs.readFileSync(files[0]);
      const b = vfs.readFileSync(files[1]);
      if (a === null) return { ok: false, output: `diff: ${files[0]}: not found` };
      if (b === null) return { ok: false, output: `diff: ${files[1]}: not found` };

      const aLines = a.split("\n");
      const bLines = b.split("\n");

      if (!unified) {
        // Original simple line-by-line comparison
        const out: string[] = [];
        const max = Math.max(aLines.length, bLines.length);
        for (let i = 0; i < max; i++) {
          if (aLines[i] !== bLines[i]) {
            if (i < aLines.length) out.push(`< ${aLines[i]}`);
            if (i < bLines.length) out.push(`> ${bLines[i]}`);
          }
        }
        return { ok: true, output: out.length === 0 ? "Files are identical" : out.join("\n") };
      }

      // --- Unified diff ---
      const CTX = 3; // context lines per hunk
      const out: string[] = [`--- ${files[0]}`, `+++ ${files[1]}`];
      const maxLen = Math.max(aLines.length, bLines.length);
      let i = 0;

      while (i < maxLen) {
        // Skip equal lines
        while (i < maxLen && aLines[i] === bLines[i]) i++;
        if (i >= maxLen) break;

        // Start of a change region
        const oldStart = Math.max(0, i - CTX);
        const newStart = Math.max(0, i - CTX);
        const hunk: string[] = [];

        // Context lines before
        for (let k = oldStart; k < i; k++) hunk.push(" " + aLines[k]);

        let eqRun = 0;
        while (i < maxLen && eqRun <= CTX) {
          if (aLines[i] !== bLines[i]) {
            eqRun = 0;
            if (i < aLines.length) hunk.push("-" + aLines[i]);
            if (i < bLines.length) hunk.push("+" + bLines[i]);
            i++;
          } else {
            eqRun++;
            if (eqRun <= CTX) {
              hunk.push(" " + aLines[i]);
              i++;
            }
          }
        }

        // If we stopped because of enough context (not end), back up
        if (eqRun > CTX) i -= eqRun - CTX;

        // Pop trailing context from hunk and compute counts
        while (hunk.length > 0 && hunk[hunk.length - 1][0] === " ") {
          // Keep the CTX context lines, trim the rest
          const ctxLines: string[] = [];
          for (let k = hunk.length - 1; k >= 0 && hunk[k][0] === " "; k--) {
            ctxLines.unshift(hunk[k]);
          }
          if (ctxLines.length > CTX) {
            hunk.splice(hunk.length - (ctxLines.length - CTX));
          }
          break;
        }

        const oldCount = hunk.filter((l) => l[0] !== "+").length;
        const newCount = hunk.filter((l) => l[0] !== "-").length;
        out.push(`@@ -${oldStart + 1},${oldCount} +${newStart + 1},${newCount} @@`);
        out.push(...hunk);
      }

      return { ok: true, output: out.length === 2 ? "Files are identical" : out.join("\n") };
    }

    case "rev": {
      const file = resolvePath(rest.find((t) => !t.startsWith("-")) ?? "");
      if (!file) return { ok: false, output: "rev: missing file" };
      const content = vfs.readFileSync(file);
      if (content === null) return { ok: false, output: `rev: ${file}: not found` };
      return { ok: true, output: content.split("\n").map((l) => l.split("").reverse().join("")).join("\n") };
    }

    case "fold": {
      const wIdx = rest.indexOf("-w");
      const width = wIdx >= 0 ? parseInt(rest[wIdx + 1], 10) : 80;
      const file = resolvePath(rest.find((t) => !t.startsWith("-") && !t.match(/^\d+$/)) ?? "");
      if (!file) return { ok: false, output: "fold: missing file" };
      const content = vfs.readFileSync(file);
      if (content === null) return { ok: false, output: `fold: ${file}: not found` };
      const lines = content.split("\n").flatMap((l) => {
        if (l.length <= width) return [l];
        const out: string[] = [];
        for (let i = 0; i < l.length; i += width) out.push(l.slice(i, i + width));
        return out;
      });
      return { ok: true, output: lines.join("\n") };
    }

    case "awk": {
      // 重建原生 awk 的 argv：旗标置于 script 之前；降级完全收敛在 awkWasm.evaluate 内部。
      const awkArgs: string[] = [];
      const scriptArgs: string[] = [];
      let i = 0;
      while (i < rest.length) {
        const t = rest[i];
        if (t === "-F" && rest[i + 1] !== undefined) { awkArgs.push(`-F${rest[i + 1]}`); i += 2; continue; } // "-F" "," → "-F,"
        if (t.startsWith("-F") && t.length > 2)        { awkArgs.push(t); i += 1; continue; }                 // "-F," 附着（旧实现丢掉的写法）
        if (t === "-v" && rest[i + 1] !== undefined)   { awkArgs.push(t, rest[i + 1]); i += 2; continue; }     // "-v var=val"
        if (t.startsWith("-"))                         { awkArgs.push(t); i += 1; continue; }
        scriptArgs.push(t); i += 1;
      }

      if (scriptArgs.length === 0) return { ok: false, output: "awk: missing script" };
      const script = scriptArgs[0];
      const file = resolvePath(scriptArgs[1] ?? "");
      const { content, source } = resolveInput(file);
      // 无输入：只有 BEGIN 块时传空 stdin（BEGIN 不需要输入），否则报错
      if (content === null) {
        if (script.includes("BEGIN")) return await awkWasm.evaluate({ script, args: awkArgs, stdin: "" });
        return { ok: false, output: "awk: no input" };
      }
      // 管道输入走 stdin 回调；文件参数写 MEMFS 同名文件（保 FILENAME/FNR）
      if (source === "stdin") return await awkWasm.evaluate({ script, args: awkArgs, stdin: content });
      return await awkWasm.evaluate({ script, args: awkArgs, files: { [file]: content } });
    }

    case "xargs": {
      if (stdin === undefined) return { ok: false, output: "xargs: needs stdin (pipe)" };
      let maxArgs = Infinity;
      let replaceStr = "";
      const xargsCmdTokens: string[] = [];
      let ri = 0;
      while (ri < rest.length) {
        const t = rest[ri];
        if (t === "-n" || t === "--max-args") {
          maxArgs = parseInt(rest[ri + 1], 10) || 1;
          ri += 2;
        } else if (t === "-I" || t === "--replace") {
          replaceStr = rest[ri + 1] || "{}";
          ri += 2;
        } else if (t === "-0" || t === "--null") {
          ri++;
        } else {
          xargsCmdTokens.push(t);
          ri++;
        }
      }
      if (xargsCmdTokens.length === 0) return { ok: false, output: "xargs: missing command" };
      const items = stdin.split(/\s+/).filter(Boolean);
      const results: string[] = [];
      if (replaceStr) {
        for (const item of items) {
          const args = xargsCmdTokens.map((t) => t.replace(replaceStr, item));
          const r = await runOneShellCommandFromTokens(args, undefined, readOnly);
          if (r.output) results.push(r.output);
        }
      } else {
        for (let bi = 0; bi < items.length; bi += maxArgs) {
          const batch = items.slice(bi, bi + maxArgs);
          const r = await runOneShellCommandFromTokens([...xargsCmdTokens, ...batch], undefined, readOnly);
          if (r.output) results.push(r.output);
        }
      }
      return { ok: true, output: results.join("\n") };
    }

    case "column": {
      const tIdx = rest.indexOf("-t");
      const sIdx = rest.indexOf("-s");
      const sep = sIdx >= 0 ? rest[sIdx + 1] : /\s+/;
      const file = resolvePath(rest.find((t) => !t.startsWith("-") && t !== (sIdx >= 0 ? rest[sIdx + 1] : "")) ?? "");
      const { content } = resolveInput(file);
      if (content === null) return { ok: false, output: "column: no input" };
      if (tIdx < 0) return { ok: true, output: content };
      const lines = content.split("\n").map((l) => l.split(sep));
      const colCount = Math.max(...lines.map((l) => l.length));
      const widths: number[] = [];
      for (let c = 0; c < colCount; c++) {
        widths[c] = Math.max(...lines.map((l) => (l[c] ?? "").length));
      }
      const out = lines.map((l) =>
        l.map((cell, i) => (cell ?? "").padEnd(widths[i])).join("  "),
      );
      return { ok: true, output: out.join("\n") };
    }

    case "comm": {
      const files = rest.filter((t) => !t.startsWith("-")).map(resolvePath);
      if (files.length < 2) return { ok: false, output: "comm: needs 2 files" };
      const a = vfs.readFileSync(files[0]);
      const b = vfs.readFileSync(files[1]);
      if (a === null) return { ok: false, output: `comm: ${files[0]}: not found` };
      if (b === null) return { ok: false, output: `comm: ${files[1]}: not found` };
      const aSet = new Set(a.split("\n"));
      const bSet = new Set(b.split("\n"));
      const onlyA = a.split("\n").filter((l) => !bSet.has(l));
      const onlyB = b.split("\n").filter((l) => !aSet.has(l));
      const both = a.split("\n").filter((l) => bSet.has(l));
      const out: string[] = [];
      for (const l of onlyA) out.push(`${l}`);
      for (const l of onlyB) out.push(`\t${l}`);
      for (const l of both) out.push(`\t\t${l}`);
      return { ok: true, output: out.join("\n") };
    }

    case "join": {
      const files = rest.filter((t) => !t.startsWith("-")).map(resolvePath);
      if (files.length < 2) return { ok: false, output: "join: needs 2 files" };
      const a = vfs.readFileSync(files[0]);
      const b = vfs.readFileSync(files[1]);
      if (a === null) return { ok: false, output: `join: ${files[0]}: not found` };
      if (b === null) return { ok: false, output: `join: ${files[1]}: not found` };
      const aLines = a.split("\n").filter(Boolean);
      const bLines = b.split("\n").filter(Boolean);
      const joinField = rest.indexOf("-j") >= 0 ? parseInt(rest[rest.indexOf("-j") + 1], 10) - 1 : 0;
      const aMap = new Map<string, string[]>();
      for (const line of aLines) {
        const fields = line.split(/\s+/);
        const key = fields[joinField] ?? fields[0];
        if (!aMap.has(key)) aMap.set(key, []);
        aMap.get(key)!.push(line);
      }
      const out: string[] = [];
      for (const line of bLines) {
        const bFields = line.split(/\s+/);
        const key = bFields[joinField] ?? bFields[0];
        const aLines = aMap.get(key);
        if (aLines) {
          for (const al of aLines) out.push(`${al} ${line}`);
        }
      }
      return { ok: true, output: out.join("\n") };
    }
    default:
      return null;
  }
}

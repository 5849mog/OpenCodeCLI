/**
 * sed.ts — sed 命令的 JS 降级实现（wasm 原生引擎不可用时使用）
 *
 * 手写实现，支持 s///（含单行/区间/末行/模式地址）、d、p、q、a、i、c 子集。
 * wasm 引擎（src/lib/wasm/sed-wasm.ts，GNU sed）不可用时回退到这里，
 * 行为与旧版 bash.ts 内联实现完全一致（功能不退步）。
 *
 * 注意：-E/-n/-f/多 -e 等原生引擎能力在此降级实现中不支持
 * （-E 在 JS 正则下本就默认生效；-n 被忽略，与旧行为一致）。
 */

import { splitAwkActions } from "./awk";

export interface SedResult {
  ok: boolean;
  output: string;
}

/** 对指定行应用替换（保留旧实现语义：JS 正则 + replace）。 */
function sedSubstOnLines(
  text: string, pattern: string, replacement: string, flags: string,
  lineFilter: (line: string, idx: number) => boolean,
): string {
  const re = new RegExp(pattern, flags.includes("g") ? flags : flags + "g");
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (lineFilter(lines[i], i)) lines[i] = lines[i].replace(re, replacement);
  }
  return lines.join("\n");
}

/** 执行 sed 脚本（JS 降级实现）。script 为 sed 程序文本，content 为输入文本。 */
export function runSed(script: string, content: string): SedResult {
  const commands = splitAwkActions(script);
  let result = content;

  for (const cmd of commands) {
    // --- Addressed s/// ---
    // Line range: N,Ms/old/new/g
    let m = cmd.match(/^(\d+)\s*,\s*(\d+)s(.)([\s\S]+?)\3([\s\S]*?)\3([gim]*)$/);
    if (m) {
      const s = parseInt(m[1], 10), e = parseInt(m[2], 10);
      try {
        result = sedSubstOnLines(result, m[4], m[5], m[6], (_, i) => i + 1 >= s && i + 1 <= e);
      } catch {
        return { ok: false, output: `sed: invalid regex: ${m[4]}` };
      }
      continue;
    }
    // Single line: Ns/old/new/g
    m = cmd.match(/^(\d+)s(.)([\s\S]+?)\2([\s\S]*?)\2([gim]*)$/);
    if (m) {
      const n = parseInt(m[1], 10);
      try {
        result = sedSubstOnLines(result, m[3], m[4], m[5], (_, i) => i + 1 === n);
      } catch {
        return { ok: false, output: `sed: invalid regex: ${m[3]}` };
      }
      continue;
    }
    // Last line: $s/old/new/g
    m = cmd.match(/^\$s(.)([\s\S]+?)\1([\s\S]*?)\1([gim]*)$/);
    if (m) {
      try {
        const re = new RegExp(m[2], m[4].includes("g") ? m[4] : m[4] + "g");
        const lines = result.split("\n");
        if (lines.length > 0) lines[lines.length - 1] = lines[lines.length - 1].replace(re, m[3]);
        result = lines.join("\n");
      } catch {
        return { ok: false, output: `sed: invalid regex: ${m[2]}` };
      }
      continue;
    }
    // Pattern match: /pat/s/old/new/g
    m = cmd.match(/^\/(.+?)\/s(.)([\s\S]+?)\2([\s\S]*?)\2([gim]*)$/);
    if (m) {
      try {
        const lineRe = new RegExp(m[1]);
        result = sedSubstOnLines(result, m[3], m[4], m[5], (l) => lineRe.test(l));
      } catch {
        return { ok: false, output: `sed: invalid regex: ${m[3]}` };
      }
      continue;
    }

    // --- No-address s/// ---
    const subMatch = cmd.match(/^s(.)([\s\S]+?)\1([\s\S]*?)\1([gim]*)$/);
    if (subMatch) {
      const [, , pattern, replacement, flags] = subMatch;
      try {
        const re = new RegExp(pattern, flags.includes("g") ? flags : flags + "g");
        result = result.replace(re, replacement);
      } catch {
        return { ok: false, output: `sed: invalid regex: ${pattern}` };
      }
      continue;
    }

    // --- d (delete) — supports N, N,M, /pattern/ ---
    const delMatch = cmd.match(/^(.+?)d$/);
    if (delMatch) {
      const addr = delMatch[1];
      const lines = result.split("\n");
      if (addr.match(/^\d+$/)) {
        const n = parseInt(addr, 10);
        if (n >= 1 && n <= lines.length) lines.splice(n - 1, 1);
        result = lines.join("\n");
      } else if (addr.match(/^\d+,\d+$/)) {
        const [start, end] = addr.split(",").map((n) => parseInt(n, 10));
        lines.splice(start - 1, end - start + 1);
        result = lines.join("\n");
      } else if (addr.startsWith("/") && addr.endsWith("/")) {
        const patternStr = addr.slice(1, -1);
        try {
          const re = new RegExp(patternStr);
          result = lines.filter((l) => !re.test(l)).join("\n");
        } catch {
          return { ok: false, output: `sed: invalid pattern: ${patternStr}` };
        }
      } else {
        return { ok: false, output: `sed: unsupported delete address: ${addr}` };
      }
      continue;
    }

    // --- p (print) — supports N, N,M, /pattern/ ---
    const printMatch = cmd.match(/^(.+?)p$/);
    if (printMatch && !cmd.startsWith("s")) {
      const addr = printMatch[1];
      const lines = result.split("\n");
      if (addr.match(/^\d+$/)) {
        const n = parseInt(addr, 10);
        if (n >= 1 && n <= lines.length) result = lines[n - 1];
        else result = "";
      } else if (addr.match(/^\d+,\d+$/)) {
        const [start, end] = addr.split(",").map((n) => parseInt(n, 10));
        result = lines.slice(start - 1, end).join("\n");
      } else if (addr.startsWith("/") && addr.endsWith("/")) {
        try {
          const re = new RegExp(addr.slice(1, -1));
          result = lines.filter((l) => re.test(l)).join("\n");
        } catch {
          return { ok: false, output: `sed: invalid pattern` };
        }
      }
      continue;
    }

    // --- q (quit) ---
    if (cmd === "q") {
      const lines = result.split("\n");
      result = lines.length > 0 ? lines[0] : "";
      break;
    }
    m = cmd.match(/^(\d+)q$/);
    if (m) {
      const n = parseInt(m[1], 10);
      const lines = result.split("\n");
      result = lines.slice(0, n).join("\n");
      break;
    }
    m = cmd.match(/^\/(.+?)\/q$/);
    if (m) {
      try {
        const re = new RegExp(m[1]);
        const lines = result.split("\n");
        const idx = lines.findIndex((l) => re.test(l));
        result = idx >= 0 ? lines.slice(0, idx + 1).join("\n") : result;
      } catch {
        return { ok: false, output: `sed: invalid pattern: ${m[1]}` };
      }
      break;
    }

    // --- a (append) ---
    m = cmd.match(/^(?:(\d+)|(?:\/(.+?)\/))?a\s+(.+)$/);
    if (m) {
      const text = m[3].replace(/^["']|["']$/g, "");
      const lines = result.split("\n");
      if (m[1]) {
        const n = parseInt(m[1], 10);
        if (n >= 1 && n <= lines.length) lines.splice(n, 0, text);
      } else if (m[2] !== undefined) {
        try {
          const re = new RegExp(m[2]);
          for (let i = lines.length - 1; i >= 0; i--) {
            if (re.test(lines[i])) lines.splice(i + 1, 0, text);
          }
        } catch {
          return { ok: false, output: `sed: invalid pattern: ${m[2]}` };
        }
      } else {
        lines.splice(lines.length, 0, text);
      }
      result = lines.join("\n");
      continue;
    }

    // --- i (insert) ---
    m = cmd.match(/^(?:(\d+)|(?:\/(.+?)\/))?i\s+(.+)$/);
    if (m) {
      const text = m[3].replace(/^["']|["']$/g, "");
      const lines = result.split("\n");
      if (m[1]) {
        const n = parseInt(m[1], 10);
        if (n >= 1 && n <= lines.length) lines.splice(n - 1, 0, text);
      } else if (m[2] !== undefined) {
        try {
          const re = new RegExp(m[2]);
          for (let i = lines.length - 1; i >= 0; i--) {
            if (re.test(lines[i])) lines.splice(i, 0, text);
          }
        } catch {
          return { ok: false, output: `sed: invalid pattern: ${m[2]}` };
        }
      } else {
        lines.splice(0, 0, text);
      }
      result = lines.join("\n");
      continue;
    }

    // --- c (change) ---
    m = cmd.match(/^(?:(\d+)|(?:\/(.+?)\/))?c\s+(.+)$/);
    if (m) {
      const text = m[3].replace(/^["']|["']$/g, "");
      const lines = result.split("\n");
      if (m[1]) {
        const n = parseInt(m[1], 10);
        if (n >= 1 && n <= lines.length) { lines[n - 1] = text; }
      } else if (m[2] !== undefined) {
        try {
          const re = new RegExp(m[2]);
          for (let i = 0; i < lines.length; i++) {
            if (re.test(lines[i])) lines[i] = text;
          }
        } catch {
          return { ok: false, output: `sed: invalid pattern: ${m[2]}` };
        }
      } else {
        result = text;
      }
      result = lines.join("\n");
      continue;
    }

    return { ok: false, output: `sed: unsupported command: ${cmd}. Supported: s/old/new/g, [addr]s/old/new/g, [addr]q, [addr]a text, [addr]i text, [addr]c text, Nd, N,Md, /pattern/d, /pattern/p` };
  }

  return { ok: true, output: result };
}

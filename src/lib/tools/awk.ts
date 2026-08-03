/**
 * AWK interpreter extracted from the bash tool.
 * Used by the bash tool's awk command.
 */

/** Split semicolon-separated actions while respecting string literals. */
export function splitAwkActions(s: string): string[] {
  const actions: string[] = [];
  let current = "";
  let inStr = false;
  let strChar = "";
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      current += c;
      if (c === strChar && s[i - 1] !== "\\") inStr = false;
    } else if (c === '"' || c === "'") {
      inStr = true;
      strChar = c;
      current += c;
    } else if (c === ";") {
      actions.push(current.trim());
      current = "";
    } else {
      current += c;
    }
  }
  const remaining = current.trim();
  if (remaining) actions.push(remaining);
  return actions;
}

/** Split comma-separated printf/print args, respecting parentheses nesting. */
export function splitArgs(s: string): string[] {
  const parts: string[] = [];
  let current = "";
  let depth = 0;
  for (const c of s) {
    if (c === "(") depth++;
    else if (c === ")") depth--;
    if (c === "," && depth === 0) {
      parts.push(current.trim());
      current = "";
    } else {
      current += c;
    }
  }
  const remaining = current.trim();
  if (remaining) parts.push(remaining);
  return parts;
}

/** Simplified sprintf implementation for awk's printf. */
export function sprintfAwk(fmt: string, args: string[]): string {
  let result = "";
  let ai = 0;
  for (let i = 0; i < fmt.length; i++) {
    if (fmt[i] === "%" && i + 1 < fmt.length) {
      i++;
      // Skip width/precision digits (e.g. %.4 → just the .4 part)
      let j = i;
      while (j < fmt.length && /[0-9.]/.test(fmt[j])) j++;
      const spec = j < fmt.length ? fmt[j] : ""; // the format specifier after width/precision
      if (spec) i = j; // skip past width/precision to the specifier
      switch (spec) {
        case "s": result += String(args[ai++] ?? ""); break;
        case "d": case "i": result += String(parseInt(args[ai++] ?? "0", 10) || 0); break;
        case "f": case "e": case "g": result += (parseFloat(args[ai++] ?? "0") || 0).toFixed(6); break;
        case "x": result += (parseInt(args[ai++] ?? "0", 10) || 0).toString(16); break;
        case "X": result += (parseInt(args[ai++] ?? "0", 10) || 0).toString(16).toUpperCase(); break;
        case "c": result += String.fromCharCode(parseInt(args[ai++] ?? "0", 10) || 0); break;
        default: result += spec;
      }
    } else {
      result += fmt[i];
    }
  }
  return result;
}

/** Run an awk script against content with the given field separator. */
export function runAwk(script: string, content: string, fieldSep: RegExp | string): string {
  interface AwkBlock {
    type: "BEGIN" | "END" | "pattern" | "body";
    pattern?: string;
    actions: string[];
    isRegex?: boolean;  // pattern was parsed from /.../ syntax
  }
  const blocks: AwkBlock[] = [];

  // Parse script into blocks
  let pos = 0;
  while (pos < script.length) {
    while (pos < script.length && /\s/.test(script[pos])) pos++;
    if (pos >= script.length) break;

    let blockType: "BEGIN" | "END" | "pattern" | "body" = "body";
    let pattern: string | undefined;
    let isRegex = false;

    // Match a keyword ONLY at a boundary (whitespace / '{' / end of script),
    // so 'BEGINfoo' or a pattern like 'END' is not misdetected as a block.
    // NOTE: substring length must equal the keyword length — an off-by-one
    // here ("END " vs "END") silently turns END blocks into per-line patterns.
    const atKeyword = (kw: string): boolean => {
      if (script.substring(pos, pos + kw.length) !== kw) return false;
      const after = script[pos + kw.length];
      return after === undefined || /\s/.test(after) || after === "{";
    };

    if (atKeyword("BEGIN")) {
      blockType = "BEGIN";
      pos += 5;
    } else if (atKeyword("END")) {
      blockType = "END";
      pos += 3;
    } else if (script[pos] === "/") {
      const endSlash = script.indexOf("/", pos + 1);
      if (endSlash > 0) {
        pattern = script.substring(pos + 1, endSlash);
        blockType = "pattern";
        isRegex = true;
        pos = endSlash + 1;
      }
    } else if (script[pos] === "{") {
      blockType = "body";
    } else {
      let condEnd = pos;
      while (condEnd < script.length && script[condEnd] !== "{") condEnd++;
      pattern = script.substring(pos, condEnd).trim();
      blockType = "pattern";
      pos = condEnd;
    }

    while (pos < script.length && /\s/.test(script[pos])) pos++;

    if (script[pos] === "{") {
      pos++;
      let depth = 1;
      let actionStart = pos;
      while (pos < script.length && depth > 0) {
        if (script[pos] === "{") depth++;
        else if (script[pos] === "}") depth--;
        if (depth > 0) pos++;
      }
      const actionStr = script.substring(actionStart, pos).trim();
      pos++;
      const actions = splitAwkActions(actionStr);
      blocks.push({ type: blockType, pattern, actions, isRegex });
    } else {
      if (pattern) {
        blocks.push({ type: blockType, pattern, actions: ["print"], isRegex });
      }
    }
  }

  // Runtime
  const userVars: Record<string, string | number> = {};
  const out: string[] = [];
  const raw = content === "" ? [] : content.split("\n");
  // Drop the phantom record created by a trailing \n (real awk does not
  // process an empty last record for "1\n2\n"), so `{m=$1} END {print m}`
  // is not corrupted by a final empty line overwriting m with 0.
  if (raw.length > 1 && raw[raw.length - 1] === "") raw.pop();
  const lines = raw;
  let _next = false;   // next statement — skip to next record
  let _exit = false;   // exit statement — stop processing, jump to END

  /** Resolve $1/$2 etc. in a string for function args (avoids regex conflicts). */
  function resolveFields(s: string, lineVars: Record<string, string | number>): string {
    return s.replace(/\$(\d+)/g, (_, n) => {
      const idx = parseInt(n, 10);
      if (idx === 0) return String(lineVars.$0 ?? "");
      return String(lineVars[`$${idx}`] ?? "");
    }).replace(/\b(NF|NR)\b/g, (_, v) => String(lineVars[v] ?? userVars[v] ?? 0));
  }

  function evalExpr(expr: string, lineVars: Record<string, string | number>): string {
    let result = expr;

    // Handle built-in functions with parenthesized args BEFORE variable substitution
    result = result.replace(/\b(length|tolower|toupper)\(([^)]*)\)/g, (_, fn, rawArg) => {
      const resolved = resolveFields(rawArg, lineVars);
      // awk: length() with no arg → length of $0
      const arg = rawArg.trim() === "" ? String(lineVars.$0 ?? "") : resolved;
      switch (fn) {
        case "length": return String(arg.length);
        case "tolower": return arg.toLowerCase();
        case "toupper": return arg.toUpperCase();
        default: return arg;
      }
    });

    result = result.replace(/\$(\d+)/g, (_, n) => {
      const idx = parseInt(n, 10);
      if (idx === 0) return String(lineVars.$0 ?? "");
      return String(lineVars[`$${idx}`] ?? "");
    });
    result = result.replace(/\b(NF|NR)\b/g, (_, v) => String(lineVars[v] ?? userVars[v] ?? 0));
    // Standalone length (no parentheses) → length of $0, e.g. `length > 80` as a pattern
    result = result.replace(/\blength\b(?!\s*\()/g, () => String(String(lineVars.$0 ?? "").length));
    result = result.replace(/\b([a-zA-Z_]\w*)\b/g, (match, v) => {
      if (["print", "printf", "sprintf", "length", "int", "tolower", "toupper", "split", "substr", "gsub", "sub", "if", "else", "for", "while", "BEGIN", "END", "NR", "NF"].includes(match)) return match;
      if (v in userVars) return String(userVars[v]);
      return match;
    });
    return result;
  }

  function execAction(action: string, lineVars: Record<string, string | number>): void {
    const trimmed = action.trim();
    if (!trimmed) return;

    if (trimmed === "next") { _next = true; return; }
    if (trimmed === "exit") { _exit = true; return; }

    if (trimmed.startsWith("print ") || trimmed === "print") {
      let args = trimmed.substring(5).trim() || "$0";
      args = evalExpr(args, lineVars);
      const parts = splitArgs(args);
      const evaluated = parts.map(p => p.trim().replace(/^["']|["']$/g, ""));
      out.push(evaluated.join("\t"));
      return;
    }

    if (trimmed.startsWith("printf ")) {
      let args = trimmed.substring(6).trim();
      args = evalExpr(args, lineVars);
      const parts = splitArgs(args);
      const fmt = parts[0]?.trim().replace(/^["']|["']$/g, "") ?? "";
      const fmtArgs = parts.slice(1).map(p => p.trim().replace(/^["']|["']$/g, ""));
      out.push(sprintfAwk(fmt, fmtArgs));
      return;
    }

    const assignMatch = trimmed.match(/^(\w+)\s*(\+=|-=|\*=|\/=|%=|=)\s*(.+)$/);
    if (assignMatch) {
      const [, varName, op, expr] = assignMatch;
      const evaluated = evalExpr(expr, lineVars);
      const current = typeof userVars[varName] === "number" ? userVars[varName] : (userVars[varName] !== undefined ? userVars[varName] : 0);
      const numVal = parseFloat(evaluated) || 0;
      const curNum = typeof current === "number" ? current : (parseFloat(String(current)) || 0);
      switch (op) {
        case "=": userVars[varName] = isNaN(numVal) ? evaluated : numVal; break;
        case "+=": userVars[varName] = curNum + numVal; break;
        case "-=": userVars[varName] = curNum - numVal; break;
        case "*=": userVars[varName] = curNum * numVal; break;
        case "/=": userVars[varName] = curNum / (numVal || 1); break;
        case "%=": userVars[varName] = curNum % (numVal || 1); break;
      }
      return;
    }

    const incMatch = trimmed.match(/^(\w+)\+\+$/);
    if (incMatch) {
      const v = incMatch[1];
      userVars[v] = (typeof userVars[v] === "number" ? userVars[v] : 0) + 1;
      return;
    }

    const ifMatch = trimmed.match(/^if\s*\((.+?)\)\s*(.+)$/);
    if (ifMatch) {
      const [, cond, body] = ifMatch;
      if (evalCondition(cond, lineVars)) {
        execAction(body, lineVars);
      }
      return;
    }

    const gsubMatch = trimmed.match(/^gsub\s*\((.+?),\s*(.+?)\)$/);
    if (gsubMatch) {
      const [, patStr, replStr] = gsubMatch;
      const re = new RegExp(evalExpr(patStr, lineVars).replace(/^["']|["']$/g, ""), "g");
      const repl = evalExpr(replStr, lineVars).replace(/^["']|["']$/g, "");
      lineVars.$0 = String(lineVars.$0).replace(re, repl);
      return;
    }
  }

  function evalCondition(cond: string, lineVars: Record<string, string | number>): boolean {
    let expr = evalExpr(cond, lineVars);
    const compMatch = expr.match(/^(.+?)\s*(<=|>=|==|!=|<|>|~|!~)\s*(.+)$/);
    if (compMatch) {
      let [, left, op, right] = compMatch;
      left = left.trim().replace(/^["']|["']$/g, "");
      right = right.trim().replace(/^["']|["']$/g, "");
      if (op === "~" || op === "!~") {
        return op === "~" ? new RegExp(right).test(left) : !new RegExp(right).test(left);
      }
      // awk treats an uninitialized variable as "" (numeric 0 in numeric
      // contexts), so `$1 > m` must compare against 0 the first time m is
      // seen — enabling cross-line max/aggregation patterns. Applied only to
      // comparison operands (not regex), so string literals stay untouched.
      const resolveUndef = (s: string) => /^[a-zA-Z_]\w*$/.test(s) && !(s in userVars) ? "" : s;
      left = resolveUndef(left);
      right = resolveUndef(right);
      const leftNum = parseFloat(left);
      const rightNum = parseFloat(right);
      const leftIsNum = !isNaN(leftNum);
      const rightIsNum = !isNaN(rightNum);
      const leftEmpty = left.trim() === "";
      const rightEmpty = right.trim() === "";
      const useNumeric = (leftIsNum && rightIsNum) || (leftIsNum && rightEmpty) || (rightIsNum && leftEmpty);
      const lv = leftEmpty ? 0 : leftNum;
      const rv = rightEmpty ? 0 : rightNum;
      switch (op) {
        case "==": return useNumeric ? lv === rv : left === right;
        case "!=": return useNumeric ? lv !== rv : left !== right;
        case "<=": return useNumeric ? lv <= rv : left <= right;
        case ">=": return useNumeric ? lv >= rv : left >= right;
        case "<": return useNumeric ? lv < rv : left < right;
        case ">": return useNumeric ? lv > rv : left > right;
      }
    }
    const n = parseFloat(expr);
    if (!isNaN(n)) return n !== 0;
    return expr !== "" && expr !== "0";
  }

  // Run BEGIN blocks
  for (const block of blocks) {
    if (block.type === "BEGIN") {
      _next = false; // next in BEGIN is an error in real awk; just ignore
      const emptyVars: Record<string, string | number> = { $0: "", NF: 0, NR: 0 };
      for (const action of block.actions) {
        execAction(action, emptyVars);
        if (_exit) break;
      }
      if (_exit) break;
    }
  }

  // Run body blocks for each line
  for (let i = 0; i < lines.length; i++) {
    if (_exit) break;
    _next = false;
    const fields = typeof fieldSep === "string"
      ? lines[i].split(fieldSep).filter(Boolean)
      : lines[i].split(fieldSep).filter(Boolean);
    const lineVars: Record<string, string | number> = {
      $0: lines[i],
      NF: fields.length,
      NR: i + 1,
    };
    for (let f = 0; f < fields.length; f++) lineVars[`$${f + 1}`] = fields[f];

    for (const block of blocks) {
      if (block.type === "BEGIN" || block.type === "END") continue;
      if (_exit) break;
      if (block.type === "pattern" && block.pattern) {
        // /pattern/ regex matching against $0
        if (block.isRegex) {
          if (!new RegExp(block.pattern).test(String(lineVars.$0 ?? ""))) continue;
        // !/pattern/ negated regex matching against $0
        } else {
          const negMatch = block.pattern.match(/^\s*!\s*\/(.+)\/\s*$/);
          if (negMatch) {
            if (new RegExp(negMatch[1]).test(String(lineVars.$0 ?? ""))) continue;
          } else if (!evalCondition(block.pattern, lineVars)) {
            continue;
          }
        }
      }
      for (const action of block.actions) {
        execAction(action, lineVars);
        if (_next || _exit) break;
      }
      if (_next || _exit) break;
    }
  }

  // Run END blocks
  for (const block of blocks) {
    if (block.type === "END") {
      const endVars: Record<string, string | number> = { $0: "", NF: 0, NR: lines.length };
      Object.assign(endVars, userVars);
      for (const action of block.actions) execAction(action, endVars);
    }
  }

  return out.join("\n");
}

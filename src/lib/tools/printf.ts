/**
 * printf.ts — bash `printf` 命令的纯 JS 实现
 *
 * 语义对齐 bash 内建 printf（POSIX 子集）：
 *   - sprintf(fmt, args): 只做 % 转换，不解释格式串内的反斜杠转义（%b 参数恒解释）
 *   - bashPrintf(fmt, args): 完整语义，格式串内 \ 转义 + % 转换 + \c 截断
 *
 * 刻意与 awk.ts 的 sprintfAwk 独立：那是 awk-wasm 在无 emsdk 时的降级路径，
 * 参数来自 awk 表达式层、无 %b/转义，改动有回归风险。
 *
 * 已知分歧（文档注明，见 docs/printf-capability-report.md）：
 *   - 多余参数忽略（真实 bash 复用格式串消费完所有参数）
 *   - toFixed 为 round-half-to-even，真实 printf 为 half-away-from-zero
 *   - `'` 千分位标志解析时跳过、不应用分组
 *   - 未知转换符（%z）原样输出该字符而非报错
 */

interface Spec {
  conv: string;
  flags: Set<string>;
  /** 数字宽度 / "ARG"（动态 %*d）/ null（无） */
  width: number | "ARG" | null;
  /** 数字精度 / "ARG"（动态 %.*s）/ null（无） */
  prec: number | "ARG" | null;
  /** % 之后的下标 */
  next: number;
}

/** 纯转换（格式串内转义不解释；%b 参数仍解释）。 */
export function sprintf(fmt: string, args: string[]): string {
  return formatPass(fmt, args, false);
}

/** 完整 bash printf 语义：格式串内 \ 转义 + % 转换 + \c 截断。命令入口。 */
export function bashPrintf(fmt: string, args: string[]): string {
  return formatPass(fmt, args, true);
}

function formatPass(fmt: string, args: string[], interpretEscapes: boolean): string {
  let out = "";
  let ai = 0; // 当前参数下标（动态宽度/精度也消费参数）
  let i = 0;
  const n = fmt.length;
  while (i < n) {
    const c = fmt[i];
    if (interpretEscapes && c === "\\") {
      const r = unescapeAt(fmt, i);
      out += r.text;
      if (r.truncated) return out; // \c 截断：丢弃其后全部输出
      i = r.next;
      continue;
    }
    if (c === "%") {
      if (i + 1 >= n) { out += "%"; i++; continue; } // 格式串尾孤立 %
      const sp = parseSpec(fmt, i);
      i = sp.next;
      // C 规则：动态宽度先于动态精度消费参数（如 %*.*f 宽→精→值）
      const width = sp.width === "ARG" ? (parseInt(args[ai++] ?? "", 10) || 0) : sp.width;
      const prec = sp.prec === "ARG" ? (parseInt(args[ai++] ?? "", 10) || 0) : sp.prec;
      if (sp.conv === "%") { out += pad("%", sp.flags, width); continue; }
      if (sp.conv === "") { out += "%"; continue; }
      const arg = args[ai++];
      const res = render(sp.conv, arg, sp.flags, width, prec);
      out += res.text;
      if (res.truncated) return out; // %b 参数内 \c 截断整条输出
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

/** 解析 `%[flags][width][.precision]conv`（fmt[i] === "%"）。 */
function parseSpec(fmt: string, i: number): Spec {
  const flags = new Set<string>();
  let j = i + 1;
  while (j < fmt.length && /[-+ 0#'"]/.test(fmt[j])) {
    if (fmt[j] !== "'") flags.add(fmt[j]); // 千分位：忽略不应用
    j++;
  }
  let width: number | "ARG" | null = null;
  if (fmt[j] === "*") { width = "ARG"; j++; }
  else {
    const m = /^\d+/.exec(fmt.slice(j));
    if (m) { width = parseInt(m[0], 10); j += m[0].length; }
  }
  let prec: number | "ARG" | null = null;
  if (fmt[j] === ".") {
    j++;
    if (fmt[j] === "*") { prec = "ARG"; j++; }
    else {
      const m = /^\d*/.exec(fmt.slice(j));
      prec = m && m[0].length > 0 ? parseInt(m[0], 10) : 0; // 孤 . 视为精度 0
      if (m) j += m[0].length;
    }
  }
  const conv = j < fmt.length ? fmt[j] : "";
  if (conv !== "") j++;
  return { conv, flags, width, prec, next: j };
}

function render(
  conv: string,
  arg: string | undefined,
  flags: Set<string>,
  width: number | null,
  prec: number | null,
): { text: string; truncated: boolean } {
  switch (conv) {
    case "s": {
      let s = arg ?? "";
      if (prec !== null) s = s.slice(0, prec); // precision = 最大字符数
      return { text: pad(s, flags, width), truncated: false };
    }
    case "b": {
      const r = unescapePrintfEscapes(arg ?? "");
      return { text: pad(r.text, flags, width), truncated: r.truncated };
    }
    case "c":
      return { text: pad(arg?.[0] ?? "", flags, width), truncated: false }; // 首字符
    case "d":
    case "i":
    case "u":
    case "x":
    case "X":
    case "o":
      return { text: formatInt(conv, arg, flags, width, prec), truncated: false };
    case "f":
    case "e":
    case "E":
    case "g":
    case "G":
      return { text: formatFloat(conv, arg, flags, width, prec), truncated: false };
    default:
      return { text: conv, truncated: false }; // 未知转换符：原样输出
  }
}

// ─── 整数 %d %i %u %x %X %o ────────────────────────────────────────

function formatInt(
  conv: string,
  arg: string | undefined,
  flags: Set<string>,
  width: number | null,
  prec: number | null,
): string {
  let n = parseInt(arg ?? "", 10);
  if (isNaN(n)) n = 0;
  n = Math.trunc(n);

  let sign = "";
  let v: bigint | number;
  let unsigned = false;
  if (conv === "u" || conv === "x" || conv === "X" || conv === "o") {
    unsigned = true;
    // 负数做 64 位补码回绕（模拟 x86_64：-1 → 18446744073709551615）
    v = n < 0 ? BigInt.asUintN(64, BigInt(n)) : BigInt(n);
  } else {
    if (n < 0) sign = "-";
    else if (flags.has("+")) sign = "+";
    else if (flags.has(" ")) sign = " ";
    v = Math.abs(n);
  }

  let digits: string;
  if (conv === "x" || conv === "X") digits = v.toString(16);
  else if (conv === "o") digits = v.toString(8);
  else digits = v.toString(10);
  if (conv === "X") digits = digits.toUpperCase();

  if (prec !== null) {
    if (prec === 0 && digits === "0") digits = ""; // %.0d 且值为 0 → 空串
    else digits = digits.padStart(prec, "0");      // precision = 最小位数
  }

  // # 前缀（0 值不加）
  const isZero = typeof v === "bigint" ? v === BigInt(0) : v === 0;
  let prefix = "";
  if (conv === "x" && flags.has("#") && !isZero) prefix = "0x";
  if (conv === "X" && flags.has("#") && !isZero) prefix = "0X";
  if (conv === "o" && flags.has("#") && digits !== "" && !digits.startsWith("0")) prefix = "0";

  const body = sign + prefix + digits;
  if (width !== null && body.length < width) {
    if (flags.has("-")) return body.padEnd(width);
    // 0 标志在整数配 precision 时忽略（C 规则）；零补在符号/前缀之后
    if (flags.has("0") && prec === null) {
      return sign + prefix + digits.padStart(width - sign.length - prefix.length, "0");
    }
    return body.padStart(width);
  }
  return body;
}

// ─── 浮点 %f %e %E %g %G ──────────────────────────────────────────

function formatFloat(
  conv: string,
  arg: string | undefined,
  flags: Set<string>,
  width: number | null,
  prec: number | null,
): string {
  let n = parseFloat(arg ?? "");
  if (isNaN(n)) n = 0;

  let sign = "";
  if (n < 0 || Object.is(n, -0)) sign = "-";
  else if (flags.has("+")) sign = "+";
  else if (flags.has(" ")) sign = " ";
  const abs = Math.abs(n);
  const p = prec ?? 6;

  let digits: string;
  if (conv === "f") {
    digits = abs.toFixed(p);
    if (flags.has("#") && p === 0) digits += "."; // # 且精度 0 → 强制小数点
  } else if (conv === "e" || conv === "E") {
    digits = abs.toExponential(p).replace(/e([+-])(\d+)$/, (_, s, d) => `e${s}${d.padStart(2, "0")}`);
    if (conv === "E") digits = digits.toUpperCase();
  } else {
    digits = gConv(abs, p, flags.has("#"));
    if (conv === "G") digits = digits.toUpperCase();
  }

  const body = sign + digits;
  if (width !== null && body.length < width) {
    if (flags.has("-")) return body.padEnd(width);
    if (flags.has("0")) return sign + digits.padStart(width - sign.length, "0");
    return body.padStart(width);
  }
  return body;
}

/** %g：指数 < -4 或 >= 精度用 e 形，否则 f 形；去尾零/尾点（# 保留）。 */
function gConv(n: number, prec: number, hash: boolean): string {
  if (n === 0) return "0";
  const exp = Math.floor(Math.log10(Math.abs(n)));
  const useExp = exp < -4 || exp >= prec;
  let s: string;
  if (useExp) {
    s = n.toExponential(prec - 1).replace(/e([+-])(\d+)$/, (_, ss, dd) => `e${ss}${dd.padStart(2, "0")}`);
  } else {
    s = n.toFixed(Math.max(0, prec - 1 - exp));
  }
  if (!hash) {
    if (useExp) s = s.replace(/\.?0+(?=e)/, "");
    else {
      // 只去小数点后的尾零与尾点，整数零必须保留（%g 100000 → "100000"）
      s = s.replace(/\.0+$/, "");
      s = s.replace(/(\.\d*?)0+$/, "$1");
      if (s.endsWith(".")) s = s.slice(0, -1);
    }
  }
  return s;
}

// ─── 宽度填充（%s/%c/%b 用；0 标志对字符串忽略） ──────────────────

function pad(s: string, flags: Set<string>, width: number | null): string {
  if (width === null || s.length >= width) return s;
  if (flags.has("-")) return s.padEnd(width);
  return s.padStart(width);
}

// ─── 反斜杠转义 ───────────────────────────────────────────────────

/**
 * 解释整段字符串内的反斜杠转义（用于 %b 参数）。
 * 参数内 \c 会截断：返回 truncated=true，调用方须丢弃其后输出。
 */
function unescapePrintfEscapes(s: string): { text: string; truncated: boolean } {
  let out = "";
  let i = 0;
  while (i < s.length) {
    if (s[i] === "\\") {
      const r = unescapeAt(s, i);
      out += r.text;
      if (r.truncated) return { text: out, truncated: true };
      i = r.next;
    } else {
      out += s[i];
      i++;
    }
  }
  return { text: out, truncated: false };
}

/** 解释 s[i]（必须为 \）处的一个转义序列，返回输出文本、是否截断、下一位置。 */
function unescapeAt(s: string, i: number): { text: string; truncated: boolean; next: number } {
  const c = s[i + 1];
  if (c === undefined) return { text: "\\", truncated: false, next: i + 1 };
  switch (c) {
    case "n": return { text: "\n", truncated: false, next: i + 2 };
    case "t": return { text: "\t", truncated: false, next: i + 2 };
    case "r": return { text: "\r", truncated: false, next: i + 2 };
    case "a": return { text: "\x07", truncated: false, next: i + 2 };
    case "b": return { text: "\b", truncated: false, next: i + 2 };
    case "f": return { text: "\f", truncated: false, next: i + 2 };
    case "v": return { text: "\v", truncated: false, next: i + 2 };
    case "e":
    case "E": return { text: "\x1b", truncated: false, next: i + 2 }; // ESC
    case "\\": return { text: "\\", truncated: false, next: i + 2 };
    case "c": return { text: "", truncated: true, next: i + 2 }; // 截断
    case "0":
    case "1":
    case "2":
    case "3":
    case "4":
    case "5":
    case "6":
    case "7": { // \nnn 八进制 1-3 位（含 \0nnn 前导 0），结果 & 0xFF
      let j = i + 1;
      let val = 0;
      let digits = 0;
      while (j < s.length && digits < 3 && /[0-7]/.test(s[j])) {
        val = val * 8 + (s.charCodeAt(j) - 48);
        j++;
        digits++;
      }
      return { text: String.fromCharCode(val & 0xff), truncated: false, next: j };
    }
    case "x": { // \xhh 十六进制 1-2 位，结果 & 0xFF；无十六进制位 → 原样 \x
      let j = i + 2;
      let val = 0;
      let digits = 0;
      while (j < s.length && digits < 2 && /[0-9a-fA-F]/.test(s[j])) {
        val = val * 16 + parseInt(s[j], 16);
        j++;
        digits++;
      }
      if (digits === 0) return { text: "\\x", truncated: false, next: i + 2 };
      return { text: String.fromCharCode(val & 0xff), truncated: false, next: j };
    }
    case "u": { // \uXXXX 1-4 位码点
      let j = i + 2;
      let val = 0;
      let digits = 0;
      while (j < s.length && digits < 4 && /[0-9a-fA-F]/.test(s[j])) {
        val = val * 16 + parseInt(s[j], 16);
        j++;
        digits++;
      }
      if (digits === 0) return { text: "\\u", truncated: false, next: i + 2 };
      return { text: String.fromCodePoint(val), truncated: false, next: j };
    }
    case "U": { // \UNNNNNNNN 1-8 位码点
      let j = i + 2;
      let val = 0;
      let digits = 0;
      while (j < s.length && digits < 8 && /[0-9a-fA-F]/.test(s[j])) {
        val = val * 16 + parseInt(s[j], 16);
        j++;
        digits++;
      }
      if (digits === 0) return { text: "\\U", truncated: false, next: i + 2 };
      return { text: String.fromCodePoint(val), truncated: false, next: j };
    }
    default:
      // 未识别转义：原样保留反斜杠（\% 不会被误解析）
      return { text: "\\" + c, truncated: false, next: i + 2 };
  }
}

/**
 * math-eval.ts — 安全算术表达式求值器
 *
 * 递归下降解析器：只接受数字、+ - * / % ^、括号、一元负号，
 * 以及显式注册的函数（sqrt/sin/...）与常量（pi）。
 * 任何未知字符 / token 直接抛错——不存在 eval/Function 那样的代码注入面。
 *
 * 用途：替代 bc / expr 的 JS 降级实现里 Function(...) 求值
 * （被安全扫描标记为代码注入的写法）。
 */

export interface MathEvalContext {
  /** 函数名 → 实现。如 { sqrt: Math.sqrt, s: Math.sin } */
  functions?: Record<string, (...args: number[]) => number>;
  /** 常量名 → 值。如 { pi: Math.PI }（匹配时不区分大小写） */
  constants?: Record<string, number>;
}

export class MathEvalError extends Error {}

/**
 * 求值算术表达式。语法：
 *   expr   := term (('+' | '-') term)*
 *   term   := unary (('*' | '/' | '%') unary)*
 *   unary  := '-' unary | power
 *   power  := atom ('^' unary)?          // 右结合；-2^2 = -(2^2) = -4
 *   atom   := number | func '(' args ')' | constant | '(' expr ')'
 *
 * 输入非法（未知 token、残缺表达式、除零不在此列——与旧 JS 行为一致返回 Infinity）时抛 MathEvalError。
 */
export function evalArithmetic(input: string, ctx: MathEvalContext = {}): number {
  const s = input.trim();
  if (!s) throw new MathEvalError("empty expression");

  const fns = ctx.functions ?? {};
  const consts = new Map<string, number>();
  for (const [k, v] of Object.entries(ctx.constants ?? {})) consts.set(k.toLowerCase(), v);

  let pos = 0;
  const atEnd = (): boolean => pos >= s.length;

  function skipWs(): void {
    while (!atEnd() && /\s/.test(s[pos])) pos++;
  }

  function expect(ch: string): void {
    skipWs();
    if (atEnd() || s[pos] !== ch) throw new MathEvalError(`expected '${ch}' at position ${pos}`);
    pos++;
  }

  /** 数字字面量：整数 / 小数 / 前导点（.5）/ 尾随点（1.） */
  function parseNumber(): number {
    skipWs();
    const start = pos;
    let dots = 0;
    while (!atEnd() && /[0-9.]/.test(s[pos])) {
      if (s[pos] === '.') dots++;
      pos++;
    }
    if (pos === start) throw new MathEvalError(`expected number at position ${pos}`);
    if (dots > 1) throw new MathEvalError(`invalid number '${s.slice(start, pos)}'`);
    return parseFloat(s.slice(start, pos));
  }

  /** 标识符：函数调用（后跟 '('）或常量 */
  function parseIdent(): number {
    skipWs();
    const start = pos;
    while (!atEnd() && /[a-zA-Z]/.test(s[pos])) pos++;
    const name = s.slice(start, pos);
    if (!name) throw new MathEvalError(`unexpected character '${s[pos]}' at position ${pos}`);

    skipWs();
    if (!atEnd() && s[pos] === '(') {
      // 函数调用：name(arg, arg, ...)
      const fn = fns[name];
      if (typeof fn !== 'function') throw new MathEvalError(`unknown function '${name}'`);
      pos++; // '('
      const args: number[] = [];
      skipWs();
      if (!atEnd() && s[pos] === ')') {
        pos++; // 空参调用（理论上函数不需要，宽容处理）
      } else {
        for (;;) {
          args.push(parseExpr());
          skipWs();
          if (atEnd()) throw new MathEvalError(`unterminated call to '${name}'`);
          if (s[pos] === ',') { pos++; continue; }
          if (s[pos] === ')') { pos++; break; }
          throw new MathEvalError(`expected ',' or ')' at position ${pos}`);
        }
      }
      return fn(...args);
    }

    // 常量（不区分大小写）
    const v = consts.get(name.toLowerCase());
    if (v === undefined) throw new MathEvalError(`unknown symbol '${name}'`);
    return v;
  }

  function parseAtom(): number {
    skipWs();
    if (atEnd()) throw new MathEvalError("unexpected end of expression");
    const ch = s[pos];
    if (ch === '(') {
      pos++;
      const v = parseExpr();
      expect(')');
      return v;
    }
    if (/[0-9.]/.test(ch)) return parseNumber();
    if (/[a-zA-Z]/.test(ch)) return parseIdent();
    throw new MathEvalError(`unexpected character '${ch}' at position ${pos}`);
  }

  function parseUnary(): number {
    skipWs();
    if (!atEnd() && s[pos] === '-') {
      pos++;
      return -parseUnary();
    }
    return parsePower();
  }

  /** ^ 右结合；右侧允许一元负号（2^-2 = 0.25） */
  function parsePower(): number {
    const base = parseAtom();
    skipWs();
    if (!atEnd() && s[pos] === '^') {
      pos++;
      const exp = parseUnary();
      return Math.pow(base, exp);
    }
    return base;
  }

  function parseTerm(): number {
    let v = parseUnary();
    for (;;) {
      skipWs();
      if (atEnd()) break;
      const ch = s[pos];
      if (ch === '*') { pos++; v *= parseUnary(); }
      else if (ch === '/') { pos++; v /= parseUnary(); }
      else if (ch === '%') { pos++; v %= parseUnary(); }
      else break;
    }
    return v;
  }

  function parseExpr(): number {
    let v = parseTerm();
    for (;;) {
      skipWs();
      if (atEnd()) break;
      const ch = s[pos];
      if (ch === '+') { pos++; v += parseTerm(); }
      else if (ch === '-') { pos++; v -= parseTerm(); }
      else break;
    }
    return v;
  }

  const result = parseExpr();
  skipWs();
  if (!atEnd()) throw new MathEvalError(`unexpected trailing input at position ${pos}`);
  return result;
}

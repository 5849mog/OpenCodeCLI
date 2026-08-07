/**
 * Glob → RegExp conversion, shared by the search tools (glob, search_files
 * include/exclude) and the bash sandbox's `find -name/-iname`. Always anchors
 * with ^...$ so the whole string must match — EXACT, never substring.
 *
 * Supports * ** ? {a,b} and [a-z]/[!a] character classes. Follows POSIX-ish
 * dotfile rules: * ? and [...] at the start of a segment do not match a
 * leading dot, and ** does not descend into dotfile segments, unless the
 * segment pattern itself starts with '.'.
 *
 * opts.matchDot disables the leading-dot guard at segment starts. Real
 * `find -name` matches hidden basenames with a bare `*` (fnmatch without
 * FNM_PERIOD), so find passes { matchDot: true }; the search tools keep the
 * default dotfile-excluding behavior.
 */

/** Parse a glob character class starting at pattern[start] === '['.
 *  Supports ranges like [a-z], negation [!a] / [^a], and escaped '\]'.
 *  Returns the regex fragment and the index just past the closing ']',
 *  or null if the class is not closed.
 */
function parseCharClass(
  pattern: string,
  start: number,
): { regex: string; end: number } | null {
  let i = start + 1;
  let negate = false;
  if (pattern[i] === "!" || pattern[i] === "^") {
    negate = true;
    i++;
  }
  let body = "";
  while (i < pattern.length) {
    const c = pattern[i];
    if (c === "]" && body !== "") {
      return { regex: "[" + (negate ? "^" : "") + body + "]", end: i + 1 };
    }
    if (c === "\\" && i + 1 < pattern.length) {
      body += "\\" + pattern[i + 1];
      i += 2;
      continue;
    }
    body += c;
    i++;
  }
  return null; // unterminated class
}

export function globToRegex(
  pattern: string,
  opts?: { matchDot?: boolean },
): RegExp {
  const matchDot = opts?.matchDot === true;
  let re = "";
  let i = 0;
  const n = pattern.length;
  let segStart = true; // pattern start is a segment boundary
  // At segment start, * ? and [...] don't match a leading dot (unless matchDot).
  const segGuard = () => {
    if (segStart && !matchDot) re += "(?!\\.)";
  };
  while (i < n) {
    const c = pattern[i];
    if (c === "*") {
      if (pattern[i + 1] === "*") {
        // ** : zero or more path segments, excluding dotfile segments
        i += 2;
        const hasSlash = pattern[i] === "/";
        if (hasSlash) i++;
        re += "(?:[^/.][^/]*/)*";
        if (!hasSlash) re += matchDot ? "[^/]*" : "(?!\\.)[^/]*";
        segStart = hasSlash; // after **/ we are at a segment start
      } else {
        // * : within a single segment; at segment start, exclude dotfiles
        segGuard();
        re += "[^/]*";
        i++;
        segStart = false;
      }
    } else if (c === "?") {
      segGuard();
      re += "[^/]";
      i++;
      segStart = false;
    } else if (c === "[") {
      const cls = parseCharClass(pattern, i);
      if (cls) {
        segGuard();
        re += cls.regex;
        i = cls.end;
        segStart = false;
      } else {
        re += "\\[";
        i++;
        segStart = false;
      }
    } else if (c === "{") {
      const end = pattern.indexOf("}", i);
      if (end < 0) {
        re += "\\{";
        i++;
        segStart = false;
      } else {
        const inner = pattern.slice(i + 1, end);
        re += "(" + inner.split(",").join("|") + ")";
        i = end + 1;
        segStart = false;
      }
    } else if (c === "/") {
      re += "/";
      i++;
      segStart = true;
    } else if ("\\^$.|+()[]".includes(c)) {
      re += "\\" + c;
      i++;
      segStart = false;
    } else {
      re += c;
      i++;
      segStart = false;
    }
  }
  return new RegExp("^" + re + "$");
}

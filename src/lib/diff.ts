export type DiffRow =
  | { type: "ctx"; text: string; leftNum: number; rightNum: number }
  | { type: "add"; text: string; leftNum: null; rightNum: number }
  | { type: "del"; text: string; leftNum: number; rightNum: null };

/** LCS DP 是 O(n·m) 内存/时间——3000 行 diff 就是 900 万格。超过阈值直接
 *  退化为"全删+全增"（无对齐上下文），避免大文件写入时卡死渲染路径。 */
const DIFF_MAX_CELLS = 2_000_000;

export function lineDiff(a: string[], b: string[]): DiffRow[] {
  const n = a.length;
  const m = b.length;
  if (n * m > DIFF_MAX_CELLS) {
    const rows: DiffRow[] = [];
    for (let i = 0; i < n; i++) rows.push({ type: "del", text: a[i], leftNum: i + 1, rightNum: null });
    for (let j = 0; j < m; j++) rows.push({ type: "add", text: b[j], leftNum: null, rightNum: j + 1 });
    return rows;
  }
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      if (a[i] === b[j]) dp[i][j] = dp[i + 1][j + 1] + 1;
      else dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const rows: DiffRow[] = [];
  let i = 0, j = 0;
  let leftNum = 1, rightNum = 1;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      rows.push({ type: "ctx", text: a[i], leftNum: leftNum++, rightNum: rightNum++ });
      i++; j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      rows.push({ type: "del", text: a[i], leftNum: leftNum++, rightNum: null });
      i++;
    } else {
      rows.push({ type: "add", text: b[j], leftNum: null, rightNum: rightNum++ });
      j++;
    }
  }
  while (i < n) {
    rows.push({ type: "del", text: a[i], leftNum: leftNum++, rightNum: null });
    i++;
  }
  while (j < m) {
    rows.push({ type: "add", text: b[j], leftNum: null, rightNum: rightNum++ });
    j++;
  }
  return rows;
}

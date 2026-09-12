// pptxgenjs 起手模板 —— 已内置多个静默翻车的绕过写法。
// 用法：复制本文件到工作目录；改标题、调色板、单元格布局后运行。
// 依赖：npm install pptxgenjs；渲染见 scripts/render.py；检查见 scripts/qa.py。
const pptxgen = require("pptxgenjs");

const p = new pptxgen();
p.layout = "LAYOUT_WIDE";          // 必须显式设置。默认是 10×5.625 的 LAYOUT_16x9，
                                  // 所有字号建议都是按 13.33×7.5 调的，不设必溢出。
p.title = "演示文稿标题";

// ---- 画布常量：所有坐标从这里推导，禁止硬编码 10 / 13.33 / 0.5 ----
const W = 13.33, H = 7.5, M = 0.5;
const RIGHT = W - M;               // 需要右对齐的模块统一用 x = RIGHT - w
const CW = W - 2 * M;              // 内容区总宽，表格/通栏图用

// ---- 调色板：BG 承担约 65% 视觉重量，ACCENT 只给一个焦点 ----
// 风格预设见 references/styles.md，这里替换成你选定的那套值。
const BG = "FFFFFF", PRIMARY = "1F3A5F", TEXT = "1A1A1A",
      MUTED = "6B7280", ACCENT = "9B2226";

// ---- 字体：只写本机/目标机一定有的（微软雅黑/宋体/黑体/Arial/Georgia…）----
const SANS = "微软雅黑", SERIF = "宋体";

// ---- 形状工厂：每次返回新对象。pptxgenjs 会就地改写传入的选项对象，
//      跨调用复用会把 pt 换成 EMU 的值传给下一个形状，导致错乱。 ----
const edge = () => ({ color: "111111", width: 3 });

// ---- 硬阴影工厂：blur 用 0.0001 而不是 0 ----
//      pptxgenjs 源码是 `shadow.blur || 8`，JS 里 0 是 falsy，
//      blur:0 会被当成没填、静默换成 8pt 模糊（见 pitfalls.md #2）。
const hard = (color = "111111", offset = 7) => ({
  type: "outer", color, blur: 0.0001, offset, angle: 45, opacity: 1.0,
});

// ---- 多行文本：每一项 breakLine，否则同一段里多个 run ≥2 会输出多个 <a:pPr>，
//      违反 schema，PowerPoint 打开后该行会错乱（pitfalls.md #4）。----
// slide 必须是参数，不能闭包绑定第一个页 —— 闭包版在写第 2 页时会把
// 文字静默加回第 1 页，且预览时很难发现少了一页内容。
const lines = (slide, arr, opts) =>
  slide.addText(
    arr.map((t, i) => ({ text: t, options: i < arr.length - 1 ? { breakLine: true } : {} })),
    opts
  );

// ---- 表格：pptxgenjs 的 addTable 只回填行高、不回填外框（pitfalls.md #30）。
//      缺 h 时外框高度退化成硬编码 1 英寸，缺 w 时宽度退化成 75% 页宽；
//      真 PowerPoint 按外框裁剪，WPS/LibreOffice 会自动撑开 → 渲染预览看不见。
//      这里强制 h = rowH × 行数、w ≥ colW 之和；参数不自洽直接抛错，不静默生成坏文件。
const addTableSafe = (slide, rows, opts = {}) => {
  const { rowH, h, w, colW, ...rest } = opts;
  const need_h = rowH ? rowH * rows.length : undefined;
  if (rowH && h != null && Math.abs(h - need_h) > 0.01)
    throw new Error(`addTableSafe: h=${h} 与 rowH×行数=${need_h} 不一致（会被 PowerPoint 裁剪）`);
  const need_w = Array.isArray(colW) ? colW.reduce((a, b) => a + b, 0) : (colW ? colW * (rows[0]?.length || 1) : undefined);
  if (w != null && need_w != null && w < need_w - 0.01)
    throw new Error(`addTableSafe: w=${w} < colW 之和=${need_w}（会被横向裁切）`);
  return slide.addTable(rows, { ...rest, rowH, h: h ?? need_h, w: w ?? need_w, colW });
};

// ==================== 示例：页眉 ====================
const s1 = p.addSlide();
s1.background = { color: BG };
// margin 单位是 pt（数字=四边同值，或 [左,右,上,下]）；不写 fontFace 的文字没有真实字体
lines(s1, ["标题", "副标题"], { x: M, y: 0.5, w: 5, h: 1.6, margin: 0,
  fontFace: SANS, fontSize: 40, bold: true, color: TEXT, paraSpaceAfter: 4 });

// ==================== 示例：主格 ====================
s1.addShape(p.shapes.ROUNDED_RECTANGLE, {
  x: M, y: 2.2, w: 6, h: 3.5, fill: { color: PRIMARY }, rectRadius: 0.14,
});
lines(s1, ["主格标题", "单行安全容量估算：框宽乘七十二除字号。"], {
  x: M + 0.3, y: 2.5, w: 5.6, h: 0.9, margin: 0,
  fontFace: SANS, fontSize: 14, color: "FFFFFF", paraSpaceAfter: 2,
});

// ==================== 示例：数据卡（右边缘锁 RIGHT）====================
const cardW = 4.0, cardH = 0.6;
s1.addShape(p.shapes.RECTANGLE, {
  x: RIGHT - cardW, y: 2.2, w: cardW, h: cardH,
  fill: { color: "FFFFFF" }, line: edge(), shadow: hard(),
});
s1.addText("KPI", { x: RIGHT - cardW + 0.2, y: 2.25, w: cardW - 0.4, h: 0.5,
  margin: 0, fontFace: SANS, fontSize: 16, bold: true, color: TEXT });

// ==================== 示例：表格（用 addTableSafe，见 pitfalls #30）====================
// 绝对不要直接 slide.addTable(...) 而漏掉 h —— 外框会退化成 1 英寸被 PowerPoint 裁掉。
const ROWS = [
  [{ text: "项目", options: { fill: { color: PRIMARY }, color: "FFFFFF" } },
   { text: "口径" }],
  ["指标 A", "说明文字"],
  ["指标 B", "说明文字"],
];
const ROW_H = 0.6;
addTableSafe(s1, ROWS, {
  x: M, y: 3.4, w: CW, colW: [3.0, CW - 3.0], rowH: ROW_H, h: ROW_H * ROWS.length,
  border: { pt: 1, color: "CCCCCC" }, margin: 0.10, valign: "middle",
  fontFace: SANS, fontSize: 12, color: TEXT,
});

// ==================== 示例：柱状图（突出某一根柱子）====================
// 堆叠分组不许配 outEnd 数据标签——PowerPoint 会报「需要修复」并丢掉图表
// （pitfalls.md #11）。要突出某根柱子：clustered 分组 + varyColors 逐点着色。
// 图题写结论不写类型；图表内文字 ≥12pt（styles.md「图表与数据页纪律」）。
s1.addChart(p.charts.BAR, [{
  name: "迁移成本", labels: ["2024", "2025", "2026"], values: [100, 62, 31],
}], {
  x: M, y: 5.0, w: 6, h: 2.2,
  barDir: "col", barGrouping: "clustered",
  varyColors: true, chartColors: [PRIMARY, PRIMARY, ACCENT],
  showValue: true, dataLabelPosition: "outEnd",
  dataLabelFontSize: 12, dataLabelFontFace: SANS, dataLabelColor: TEXT,
  catAxisLabelFontSize: 12, catAxisLabelFontFace: SANS, catAxisLabelColor: MUTED,
});

p.writeFile({ fileName: "输出文件名.pptx" }).then(() => console.log("ok"));

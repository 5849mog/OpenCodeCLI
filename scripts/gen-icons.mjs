/**
 * 从 public/logo.svg（双色 N 折纸主版）离线渲染全套图标。
 * 由 sharp 静态导出，零联网、零外部服务。
 * 用法：node scripts/gen-icons.mjs
 */
import sharp from "sharp";

const src = "public/logo.svg";
const targets = [
  ["public/favicon-32x32.png", 32],
  ["public/apple-touch-icon.png", 180],
  ["public/icon-192.png", 192],
  ["public/icon-512.png", 512],
];

for (const [out, size] of targets) {
  await sharp(src).resize(size, size).png().toFile(out);
  console.log(`wrote ${out} (${size}x${size})`);
}

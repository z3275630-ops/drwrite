/**
 * 生成 Drwrite 图标源图（1024×1024 PNG，无第三方依赖）：
 * 米色圆角底 + 一道墨色笔势 + 一点墨点。
 */
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';

const W = 1024, H = 1024;

// ---------- 像素计算 ----------
const px = new Uint8Array(W * H * 4);

const inside = (x, y) => x >= 0 && y >= 0 && x < W && y < H;

function setPx(x, y, r, g, b, a) {
  if (!inside(x, y)) return;
  const i = (y * W + x) * 4;
  // 简单 alpha 合成（覆盖）
  const sa = a / 255;
  const da = px[i + 3] / 255;
  const oa = sa + da * (1 - sa);
  if (oa === 0) return;
  px[i] = Math.round((r * sa + px[i] * da * (1 - sa)) / oa);
  px[i + 1] = Math.round((g * sa + px[i + 1] * da * (1 - sa)) / oa);
  px[i + 2] = Math.round((b * sa + px[i + 2] * da * (1 - sa)) / oa);
  px[i + 3] = Math.round(oa * 255);
}

// 圆角矩形（含 3px 抗锯齿过渡）
const R = 190;
function roundedAlpha(x, y) {
  const cx = Math.min(Math.max(x, R), W - R);
  const cy = Math.min(Math.max(y, R), H - R);
  const dx = x - cx, dy = y - cy;
  const d = Math.hypot(dx, dy);
  return Math.max(0, Math.min(1, (R - d) / 3 + 0.5));
}

// 底色：米白 → 米黄 轻渐变
function bg(x, y) {
  const t = y / H;
  return [247 - t * 10, 243 - t * 9, 232 - t * 13]; // f7f3e8 → ede5db
}

// 点到线段距离
function segDist(x, y, x1, y1, x2, y2) {
  const vx = x2 - x1, vy = y2 - y1;
  const wx = x - x1, wy = y - y1;
  const t = Math.max(0, Math.min(1, (wx * vx + wy * vy) / (vx * vx + vy * vy)));
  return { d: Math.hypot(x - (x1 + t * vx), y - (y1 + t * vy)), t };
}

// 笔势：从左下到右上、渐细、起笔带一点弧
const S1 = [250, 800], S2 = [790, 236];
const W1 = 105, W2 = 30; // 半宽：起粗收细
const ink = [44, 38, 32];

for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const ra = roundedAlpha(x, y);
    if (ra <= 0) continue;
    const [r, g, b] = bg(x, y);
    setPx(x, y, r, g, b, Math.round(ra * 255));
  }
}

for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const { d, t } = segDist(x, y, S1[0], S1[1], S2[0], S2[1]);
    const half = W1 + (W2 - W1) * t;
    // 笔锋软边 8px
    const m = Math.max(0, Math.min(1, (half - d) / 8 + 0.5));
    if (m <= 0) continue;
    // 起笔端圆润收口
    const cap = Math.min(1, t / 0.08);
    const alpha = m * cap;
    if (alpha <= 0) continue;
    // 墨色微透
    setPx(x, y, ink[0], ink[1], ink[2], Math.round(alpha * 235 * roundedAlpha(x, y)));
  }
}

// 墨点：笔势下方偏右
const D = [700, 660], DR = 42;
for (let y = D[1] - DR - 4; y <= D[1] + DR + 4; y++) {
  for (let x = D[0] - DR - 4; x <= D[0] + DR + 4; x++) {
    const dd = Math.hypot(x - D[0], y - D[1]);
    const m = Math.max(0, Math.min(1, (DR - dd) / 4 + 0.5));
    if (m > 0) setPx(Math.round(x), Math.round(y), ink[0], ink[1], ink[2], Math.round(m * 240 * roundedAlpha(x, y)));
  }
}

// ---------- PNG 编码 ----------
const crcTable = [];
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  crcTable[n] = c >>> 0;
}
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0);
ihdr.writeUInt32BE(H, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 6; // RGBA
// 每行前加 filter 0
const raw = Buffer.alloc(H * (1 + W * 4));
for (let y = 0; y < H; y++) {
  raw[y * (1 + W * 4)] = 0;
  Buffer.from(px.buffer, y * W * 4, W * 4).copy(raw, y * (1 + W * 4) + 1);
}
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);
writeFileSync(new URL('../app-icon.png', import.meta.url), png);
console.log('icon written:', png.length, 'bytes');

// preview_portraits.mjs — offline composite: all 10 NPC speech portraits,
// 3 mouth "blab" frames each, 3× upscaled, for vision QA. No browser, no text.
import * as SSx from '../client/systems/SpriteSystem.js';
import zlib from 'node:zlib';
import fs from 'node:fs';
const { px, TEXTURES, NPC_COLORS } = SSx;

const U = 3;
const W0 = 40, H0 = 48, GAP = 10, PAD = 14;
const npcs = Object.keys(NPC_COLORS); // nova..cora

const COLS = npcs.length, ROWS = 3; // 3 mouth frames
const cellW = W0 * U, cellH = H0 * U;
const Wpx = PAD * 2 + COLS * (cellW + GAP);
const Hpx = PAD * 2 + ROWS * (cellH + GAP) + 40;

const buf = new Uint8ClampedArray(Wpx * Hpx * 4).fill(0);
buf.fill(14); // very dark bg
const put = (px_, py_, c) => {
  if (px_ < 0 || py_ < 0 || px_ >= Wpx || py_ >= Hpx) return;
  const i = (py_ * Wpx + px_) * 4;
  buf[i] = c[0]; buf[i+1] = c[1]; buf[i+2] = c[2]; buf[i+3] = 255;
};
const blit = (spr, ox, oy) => {
  for (let y = 0; y < spr.height; y++) for (let x = 0; x < spr.width; x++) {
    const p = px(spr, x, y);
    if (p[3] > 0) for (let uy = 0; uy < U; uy++) for (let ux = 0; ux < U; ux++)
      put(ox + x * U + ux, oy + y * U + uy, [p[0], p[1], p[2]]);
  }
};
const cellX = (ci) => PAD + ci * (cellW + GAP);
const rowY = (ri) => PAD + ri * (cellH + GAP);

// column separator strips tinted by each NPC's suit color
for (let i = 0; i < npcs.length; i++) {
  const col = NPC_COLORS[npcs[i]];
  const colrgb = [(col >> 16) & 255, (col >> 8) & 255, col & 255];
  for (let y = 0; y < Hpx - PAD; y++) put(cellX(i) - GAP / 2 + 6, y + 2, colrgb);
  // frame-label dots on the left of each row
  for (let x = 0; x < 6; x++) for (let y = 0; y < cellH; y++) put(x + 3, rowY(i >= ROWS ? 0 : i) + y, colrgb);
}
// frame index markers in a footer band
const bandY = PAD + ROWS * (cellH + GAP) + 8;
for (let y = 0; y < 2; y++) for (let x = 0; x < Wpx - PAD * 2; x++) put(x + PAD, bandY + y, [90, 90, 120]);
for (let f = 0; f < 3; f++) {
  const cx = PAD + Math.floor((COLS / 2) - 1) * (cellW + GAP);
  for (let w = 0; w < 4; w++) for (let h = 0; h < 16; h++) put(cx + f * 56, bandY - 22 + h, [230, 230, 240]);
}

for (let f = 0; f < ROWS; f++) {
  for (let i = 0; i < npcs.length; i++) {
    blit(TEXTURES[`port.${npcs[i]}_${f}`], cellX(i), rowY(f));
  }
}

// ── PNG encode (same self-contained encoder as preview_villagers.mjs) ──
const raw = Buffer.alloc((Wpx * 4 + 1) * Hpx);
for (let y = 0; y < Hpx; y++) {
  raw[y * (Wpx * 4 + 1)] = 0;
  Buffer.from(buf.buffer, y * Wpx * 4, Wpx * 4).copy(raw, y * (Wpx * 4 + 1) + 1);
}
const idat = zlib.deflateSync(raw);
const crcTable = [];
for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; crcTable[n] = c >>> 0; }
const crc32 = (b) => { let c = 0xFFFFFFFF; for (const x of b) c = crcTable[(c ^ x) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const cr = Buffer.alloc(4); cr.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, cr]);
};
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(Wpx, 0); ihdr.writeUInt32BE(Hpx, 4);
ihdr[8] = 8; ihdr[9] = 6;
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
  chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0)),
]);
fs.writeFileSync('/tmp/portraits.png', png);
console.log(`wrote /tmp/portraits.png (${Wpx}x${Hpx})`);

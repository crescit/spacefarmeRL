// preview_villagers.mjs — offline composite: player walk cycle (4 dirs × 3 frames)
// + NPC idle-bob frames, 3× upscaled, for vision QA. No browser, no text.
import * as SSx from '../client/systems/SpriteSystem.js';
import zlib from 'node:zlib';
import fs from 'node:fs';
const { px, TEXTURES } = SSx;

const U = 3; // upscale
const W0 = 32, H0 = 32, GAP = 6, PAD = 12;
const dirs = ['front', 'back', 'left', 'right'];
const npcs = ['nova', 'luna', 'zephyr', 'vega', 'quasar', 'rhea', 'astra', 'orion', 'comet', 'cora'];

const COLS = 12, ROWS = dirs.length + 2;
const cellW = W0 * U, cellH = H0 * U;
const Wpx = PAD * 2 + COLS * (cellW + GAP);
const Hpx = PAD * 2 + ROWS * (cellH + GAP);

const buf = new Uint8ClampedArray(Wpx * Hpx * 4).fill(0);
buf.fill(16); // very dark blue bg
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
const cell = (ci) => PAD + ci * (cellW + GAP);
const rowY = (ri) => PAD + ri * (cellH + GAP);

// separator strips (row labels via color)
const rowCols = [[245,146,58], [120,120,150], [120,120,150], [120,120,150], [80,200,200], [80,200,200]];
for (let r = 0; r < ROWS; r++) {
  put(PAD - 6, rowY(r), rowCols[r] || [80,80,100]);
  put(PAD - 6, rowY(r) + cellH - 1, rowCols[r] || [80,80,100]);
  for (let y = 0; y < cellH; y++) put(PAD - 6, rowY(r) + y, rowCols[r] || [80,80,100]);
}

// player rows: 4 rows × 3 frames
for (let d = 0; d < dirs.length; d++) {
  for (let f = 0; f < 3; f++) {
    blit(TEXTURES[`player.${dirs[d]}_${f}`], cell(f), rowY(d));
  }
}
// npc row 1: frame 0 for all 10
// npc row 2: frame 2 for all 10 (shows bob offset)
for (let i = 0; i < npcs.length; i++) {
  blit(TEXTURES[`npc.${npcs[i]}_0`], cell(i), rowY(4));
  blit(TEXTURES[`npc.${npcs[i]}_2`], cell(i), rowY(5));
}

// ── PNG encode ──
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
fs.writeFileSync('/tmp/villagers.png', png);
console.log(`wrote /tmp/villagers.png (${Wpx}x${Hpx})`);

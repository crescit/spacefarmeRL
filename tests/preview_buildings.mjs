// preview_buildings.mjs — close-up of the future architecture
import * as SS from '../client/systems/SpriteSystem.js';
import { px } from '../client/systems/SpriteSystem.js';
import zlib from 'node:zlib';
import fs from 'node:fs';
const SC = 5;
const items = [
  ['house', SS.houseSprite],
  ['shop', SS.shopSprite],
  ['exchange', SS.exchangeA],
  ['tavern', SS.tavernA],
];
const CW = 380, CH = 380, W = CW * items.length, H = CH;
const fb = Buffer.alloc(W * H * 4);
const put = (x, y, c) => { if (x < 0 || y < 0 || x >= W || y >= H) return; const i = (y * W + x) * 4; fb[i] = c[0]; fb[i + 1] = c[1]; fb[i + 2] = c[2]; fb[i + 3] = 255; };
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const i = (y * W + x) * 4; fb[i] = 30; fb[i + 1] = 34; fb[i + 2] = 50; fb[i + 3] = 255; }
items.forEach(([name, cv], idx) => {
  const w = cv.width, h = cv.height;
  const ox = idx * CW + (CW - w * SC) / 2, oy = (CH - h * SC) / 2;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const p = px(cv, x, y); if (p[3] === 0) continue;
    for (let sy = 0; sy < SC; sy++) for (let sx = 0; sx < SC; sx++) put(ox + x * SC + sx, oy + y * SC + sy, p);
  }
});
function crc32(buf) { if (!crc32.t) { crc32.t = new Int32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1); crc32.t[n] = c; } } let c = 0xFFFFFFFF; for (let i = 0; i < buf.length; i++) c = crc32.t[(c ^ buf[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
const sig = Buffer.from([0x89,0x50,0x4E,0x47,0x0D,0x0A,0x1A,0x0A]);
const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(W,0); ihdr.writeUInt32BE(H,4); ihdr[8]=8; ihdr[9]=6;
const chunk = (t, d) => { const len = Buffer.alloc(4); len.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const cr = Buffer.alloc(4); cr.writeUInt32BE(crc32(td)); return Buffer.concat([len, td, cr]); };
const raw = Buffer.alloc(H * (1 + W * 4));
for (let y = 0; y < H; y++) { raw[y * (1 + W * 4)] = 0; fb.copy(raw, y * (1 + W * 4) + 1, y * W * 4, (y + 1) * W * 4); }
fs.writeFileSync('/tmp/buildings.png', Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
console.log(`wrote /tmp/buildings.png (${W}x${H})`);

// contact_sheet.mjs — render key sprites into a single PNG for visual QA
// Uses Node zlib (built-in) — no external deps.
import { px } from '../client/systems/SpriteSystem.js';
import * as SS from '../client/systems/SpriteSystem.js';
import zlib from 'node:zlib';
import fs from 'node:fs';

function getRGBA(c) {
  const out = new Uint8Array(c.width * c.height * 4);
  for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) {
    const p = px(c, x, y);
    const i = (y * c.width + x) * 4;
    out[i] = p[0]; out[i + 1] = p[1]; out[i + 2] = p[2]; out[i + 3] = p[3];
  }
  return out;
}

// Compose sprites onto a dark canvas with labels
const sprites = [
  ['house', SS.houseSprite],
  ['shop', SS.shopSprite],
  ['exchA', SS.exchangeA],
  ['exchB', SS.exchangeB],
  ['tavA', SS.tavernA],
  ['tavC', SS.tavernC],
  ['planet', SS.planetSprite],
  ['grassA', SS.GROUND.grassA], ['grassB', SS.GROUND.grassB], ['path', SS.GROUND.path],
  ['water', SS.GROUND.water], ['soil', SS.GROUND.soil], ['seeded', SS.GROUND.seeded],
  ['growing', SS.GROUND.growing], ['mature', SS.GROUND.mature],
  ['fence', SS.fencePost], ['beam', SS.fenceBeamA], ['lamp', SS.lampPost], ['glow', SS.lampGlow],
  ['planter', SS.planterBox], ['bwl', SS.barrelWater], ['bcr', SS.barrelCargo], ['bush', SS.bush],
  ['player', SS.TEXTURES['player.front']], ['nova', SS.NPC_SPRITES.nova], ['luna', SS.NPC_SPRITES.luna],
  ['shopGlow', SS.exchangeGlow], ['tavGlow', SS.tavernGlow], ['houseGlow', SS.houseGlowSprite],
];

// tiny 4x5 bitmap font for A-Z 0-9
const FONT = {
  'A': ['0110','1001','1110','1001','1001'], 'B': ['1110','1001','1110','1001','1110'],
  'C': ['0111','1000','1000','1000','0111'], 'D': ['1110','1001','1001','1001','1110'],
  'E': ['1111','1000','1110','1000','1111'], 'F': ['1111','1000','1110','1000','1000'],
  'G': ['0111','1000','1011','1001','0111'], 'H': ['1001','1001','1111','1001','1001'],
  'I': ['111','010','010','010','111'], 'J': ['0011','0001','0001','1001','0110'],
  'K': ['1001','1010','1100','1010','1001'], 'L': ['1000','1000','1000','1000','1111'],
  'M': ['10001','11011','10101','10001','10001'], 'N': ['1001','1101','1011','1001','1001'],
  'O': ['0110','1001','1001','1001','0110'], 'P': ['1110','1001','1110','1000','1000'],
  'Q': ['0110','1001','1011','1001','0111'], 'R': ['1110','1001','1110','1010','1001'],
  'S': ['0111','1000','0110','0001','1110'], 'T': ['11111','00100','00100','00100','00100'],
  'U': ['1001','1001','1001','1001','0110'], 'V': ['1001','1001','1001','0110','0110'],
  'W': ['10001','10001','10101','11011','10001'], 'X': ['1001','1001','0110','1001','1001'],
  'Y': ['1001','1001','0110','0010','0010'], 'Z': ['1111','0001','0010','0100','1111'],
  '0': ['0110','1001','1011','1101','0110'], '1': ['010','110','010','010','111'],
  '2': ['1110','0001','0110','1000','1111'], '3': ['1110','0001','0110','0001','1110'],
  '4': ['1001','1001','1111','0001','0001'], '5': ['1111','1000','1110','0001','1110'],
  '6': ['0110','1000','1110','1001','0110'], '7': ['1111','0001','0010','0100','0100'],
  '8': ['0110','1001','0110','1001','0110'], '9': ['0110','1001','0111','0001','0110'],
};
function drawText(buf, W, text, x0, y0, color) {
  let x = x0;
  for (const ch of text) {
    const glyph = FONT[ch] || FONT['?'] || ['101','010','101'];
    const gw = Math.max(...glyph.map(r => r.length));
    for (let gy = 0; gy < 5; gy++) {
      const row = glyph[gy] || '';
      for (let gx = 0; gx < gw; gx++) {
        if (row[gx] !== '1') continue;
        const px_ = x + gx, py = y0 + gy;
        if (px_ < 0 || py < 0 || px_ >= W) continue;
        const t = (py * W + px_) * 4;
        buf[t] = color[0]; buf[t + 1] = color[1]; buf[t + 2] = color[2]; buf[t + 3] = 255;
      }
    }
    x += gw + 2;
  }
}

// Layout: grid of 240x120 cells (2 cols)
const cellW = 240, cellH = 130, cols = 2;
const rows = Math.ceil(sprites.length / cols);
const W = cellW * cols, H = cellH * rows;
const buf = Buffer.alloc(W * H * 4);
// background
for (let i = 0; i < W * H; i++) { buf[i * 4] = 20; buf[i * 4 + 1] = 20; buf[i * 4 + 2] = 34; buf[i * 4 + 3] = 255; }
// cell borders
for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
  const x0 = c * cellW, y0 = r * cellH;
  for (let x = 0; x < cellW; x++) {
    const t = (y0 + x) * 4; buf[t] = 60; buf[t + 1] = 60; buf[t + 2] = 90;
    const b = (y0 + cellH - 1 + x) * 4; buf[b] = 60; buf[b + 1] = 60; buf[b + 2] = 90;
  }
  for (let y = 0; y < cellH; y++) {
    const l = (y0 + y) * cellW * 4; buf[l] = 60; buf[l + 1] = 60; buf[l + 2] = 90;
    const rr = l + cellW * 4 - 4; buf[rr] = 60; buf[rr + 1] = 60; buf[rr + 2] = 90;
  }
}
sprites.forEach(([name, c], i) => {
  const col = i % cols, row = Math.floor(i / cols);
  const x0 = col * cellW, y0 = row * cellH;
  // blit sprite centered, scaled up 2x
  const sc = 2;
  const sw = c.width * sc, sh = c.height * sc;
  const ox = x0 + Math.floor((cellW - sw) / 2), oy = y0 + Math.floor((cellH - sh) / 2);
  for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) {
    const p = px(c, x, y);
    if (p[3] === 0) continue;
    for (let sy = 0; sy < sc; sy++) for (let sx = 0; sx < sc; sx++) {
      const dx = ox + x * sc + sx, dy = oy + y * sc + sy;
      if (dx < 0 || dy < 0 || dx >= W || dy >= H) continue;
      const t = (dy * W + dx) * 4;
      buf[t] = p[0]; buf[t + 1] = p[1]; buf[t + 2] = p[2]; buf[t + 3] = p[3];
    }
  }
  // label (5x7 bitmap font, single-char fallback: draw name as pixel text)
  drawText(buf, W, name.toUpperCase(), x0 + 4, y0 + 4, [255, 255, 120]);
});

// Encode PNG
function crc32(buf) {
  let table = crc32.table;
  if (!table) {
    table = crc32.table = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      table[n] = c;
    }
  }
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = table[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
const sig = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4);
ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
const raw = Buffer.alloc(H * (1 + W * 4));
for (let y = 0; y < H; y++) {
  raw[y * (1 + W * 4)] = 0; // no filter
  buf.copy(raw, y * (1 + W * 4) + 1, y * W * 4, (y + 1) * W * 4);
}
const idat = zlib.deflateSync(raw);
const png = Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
fs.writeFileSync('/tmp/sprite_sheet.png', png);
console.log(`wrote /tmp/sprite_sheet.png (${W}x${H})`);

// png.mjs — minimal correct PNG encoder shared by headless preview scripts.
// Writes an RGBA (color type 6) PNG from a flat RGBA buffer. Deterministic,
// dependency-free, works in Node only (previews never run in the browser).
import zlib from 'node:zlib';
import fs from 'node:fs';

let crcTable = null;
function crc32(buf) {
  if (!crcTable) {
    crcTable = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      crcTable[n] = c;
    }
  }
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const cr = Buffer.alloc(4);
  cr.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, cr]);
};

// Write `fb` (flat RGBA, width*height*4) to `out` as a PNG.
export function writePNG(out, fb, W, H) {
  const sig = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0);
  ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  const raw = Buffer.alloc(H * (1 + W * 4));
  for (let y = 0; y < H; y++) {
    raw[y * (1 + W * 4)] = 0;
    fb.copy(raw, y * (1 + W * 4) + 1, y * W * 4, (y + 1) * W * 4);
  }
  fs.writeFileSync(out, Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
}

// Convenience: write a canvas-like {width,height,px} object (a SpriteSystem
// canvas or TestCtx-backed surface) as an upscaled PNG.
export function writeSurfacePNG(out, cv, SC = 5, backdrop = [30, 34, 50]) {
  const W = cv.width * SC, H = cv.height * SC;
  const fb = Buffer.alloc(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4;
    fb[i] = backdrop[0]; fb[i + 1] = backdrop[1]; fb[i + 2] = backdrop[2]; fb[i + 3] = 255;
  }
  for (let y = 0; y < cv.height; y++) for (let x = 0; x < cv.width; x++) {
    const p = pxOf(cv, x, y);
    if (p[3] === 0) continue;
    for (let sy = 0; sy < SC; sy++) for (let sx = 0; sx < SC; sx++) {
      const i = ((y * SC + sy) * W + (x * SC + sx)) * 4;
      fb[i] = p[0]; fb[i + 1] = p[1]; fb[i + 2] = p[2]; fb[i + 3] = 255;
    }
  }
  writePNG(out, fb, W, H);
}

import { px as pxOf } from '../client/systems/SpriteSystem.js';

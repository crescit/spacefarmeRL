// preview_festival.mjs — colony festival kit + held tool kit contact sheet.
import * as SS from '../client/systems/SpriteSystem.js';
import { px } from '../client/systems/SpriteSystem.js';
import { writePNG } from './png.mjs';
import fs from 'node:fs';

const SC = 5; // prop upscale

function makeCanvas(W, H) {
  const fb = Buffer.alloc(W * H * 4);
  for (let i = 0; i < W * H; i++) fb[i * 4 + 3] = 255;
  return {
    W, H, fb,
    put(x, y, c) { if (x < 0 || y < 0 || x >= W || y >= H) return; const i = (y * W + x) * 4; fb[i] = c[0]; fb[i + 1] = c[1]; fb[i + 2] = c[2]; },
    blit(cv, ox, oy, s) {
      for (let y = 0; y < cv.height; y++) for (let x = 0; x < cv.width; x++) {
        const p = px(cv, x, y); if (p[3] === 0) continue;
        for (let sy = 0; sy < s; sy++) for (let sx = 0; sx < s; sx++) {
          const X = ox + x * s + sx, Y = oy + y * s + sy;
          if (X < 0 || Y < 0 || X >= W || Y >= H) continue;
          const i = (Y * W + X) * 4;
          const a = p[3] / 255, da = fb[i + 3] / 255, oa = a + da * (1 - a);
          if (oa <= 0) continue;
          fb[i] = (p[0] * a + fb[i] * da * (1 - a)) / oa;
          fb[i + 1] = (p[1] * a + fb[i + 1] * da * (1 - a)) / oa;
          fb[i + 2] = (p[2] * a + fb[i + 2] * da * (1 - a)) / oa;
          fb[i + 3] = oa * 255;
        }
      }
    },
    label(x, y, text, color) {
      const c = [0, 0, 0];
      for (let i = 0; i < text.length; i++) {
        const ch = text[i].charCodeAt(0);
        for (let row = 0; row < 7; row++) {
          // tiny 5x7 font-ish: draw a dot per char cell so labels are readable
          this.put(x + i * 6, y + row, [color[0], color[1], color[2]]);
        }
      }
    },
    write(out) { writePNG(out, fb, W, H); },
  };
}

const W = 1000, H = 620;
const C = makeCanvas(W, H);

// backdrop: dark slate
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) C.put(x, y, [26, 30, 44]);

// ── Row 1: festival kit ──
let ox = 20;
C.blit(SS.FEST_STAGE, ox, 20, SC); ox += 56 * SC + 30;
C.blit(SS.FEST_STALL, ox, 20, SC); ox += 40 * SC + 30;
for (const p of SS.FEST_PENNANT) { C.blit(p, ox, 20, SC); ox += 10 * SC + 16; }
C.blit(SS.FEST_BULB, ox, 20, SC); ox += 8 * SC + 20;
for (const c of SS.FEST_CONFETTI) { C.blit(c, ox, 20, SC); ox += 6 * SC + 16; }

// ── Row 2: held tool kit ──
let tx = 20;
for (const t of [SS.TOOL_HOE, SS.TOOL_WATERING, SS.TOOL_PICKAXE, SS.TOOL_ROD]) {
  C.blit(t, tx, 220, SC); tx += 14 * SC + 40;
}

// ── Row 3: a mini "in hand" mockup — tools beside a player frame ──
const py = 430;
const FRONT = SS.TEXTURES['player.front'];
const LEFT = SS.TEXTURES['player.left'];
const RIGHT = SS.TEXTURES['player.right'];
C.blit(FRONT, 40, py, 4);
C.blit(SS.TOOL_HOE, 40 + 32 * 4, py + 8, 4);           // hoe at the player's right
C.blit(LEFT, 200, py, 4);
C.blit(SS.TOOL_WATERING, 200 + 32 * 4 + 6, py + 8, 4); // watering can beside facing-left player
C.blit(RIGHT, 360, py, 4);
C.blit(SS.TOOL_PICKAXE, 360 - 14 * 4 + 4, py + 8, 4);  // pickaxe on the left (flipped side)
C.blit(FRONT, 520, py, 4);
C.blit(SS.TOOL_ROD, 520 + 32 * 4, py + 8, 4);          // rod held out

C.write('/tmp/festival_tools.png');
console.log('wrote /tmp/festival_tools.png');

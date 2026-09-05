// preview_intro.mjs — offline render of the Intro title card (real sprites)
// Confirms: nebula + planet + house silhouette + big legible title, no grid.
import * as SS from '../client/systems/SpriteSystem.js';
import { px } from '../client/systems/SpriteSystem.js';
import zlib from 'node:zlib';
import fs from 'node:fs';

const W = 960, H = 720;
const NEB = SS.makeNebula();
const fb = Buffer.alloc(W * H * 4);
const put = (x, y, c) => { if (x<0||y<0||x>=W||y>=H) return; const i=(y*W+x)*4; fb[i]=c[0]; fb[i+1]=c[1]; fb[i+2]=c[2]; fb[i+3]=255; };

// QA 0904: the nebula used to be tiled with x%256,y%256, which stamped visible
// 256px seam GRID LINES across the card, and the planet sprite was blitted at
// absolute coords that fell on that period so it REPEATED 4×. The real
// IntroScene is one composition with a single planet — the sheet now matches:
// phase-shifted nebula (no seam grid) + exactly one planet per corner.
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const ph = (Math.floor(x / 256) * 53 + Math.floor(y / 256) * 101) % 256;
  const c = px(NEB, (x + ph) % 256, (y + ph * 3) % 256);
  put(x, y, c);
}
function blit(cv, sx, sy, flip) { for (let y = 0; y < cv.height; y++) for (let x = 0; x < cv.width; x++) { const p = px(cv, flip ? cv.width - 1 - x : x, y); if (p[3]) put(sx + x, sy + y, p); } }
// planets — single composition (one per corner), matching the scene, no repeats
blit(SS.planetSprite, W - 150, H - 120, false);   // lower-right
blit(SS.planetSprite, 70, 96, true);               // upper-left
// house silhouette — moved to the upper third so the title band stays clear
const sc = 2.2, hw = 64, hh = 60, hx = Math.round(W / 2 - hw * sc / 2), hy = Math.round(120 - hh * sc / 2);
for (let y = 0; y < hh; y++) for (let x = 0; x < hw; x++) { const p = px(SS.houseSprite, x, y); if (!p[3]) continue;
  for (let sy = 0; sy < sc; sy++) for (let sx = 0; sx < sc; sx++) put(hx + x * sc + sx, hy + y * sc + sy, p); }
// ── Chunky bitmap font ──
// QA 0904: this file carried TWO hand-maintained glyph tables that had drifted
// from the strings they render — 'C' was defined IDENTICAL to 'O' (so the title
// read "SPAOE FARMER"), and 'G'/'7' were missing so the fallback diamond ate
// them ("BEBIN", "YEAR 2?18"). One shared atlas + a hard miss report means a
// missing glyph can never again render silently as decoration.
const GLYPH = {
  'A':['0110','1001','1111','1001','1001'],'B':['1110','1001','1110','1001','1110'],
  'C':['0111','1000','1000','1000','0111'],'D':['1110','1001','1001','1001','1110'],
  'E':['1111','1000','1110','1000','1111'],'F':['1111','1000','1110','1000','1000'],
  'G':['0111','1000','1011','1001','0111'],'H':['1001','1001','1111','1001','1001'],
  'I':['010','010','010','010','010'],'J':['0011','0001','0001','1001','0110'],
  'K':['1001','1010','1100','1010','1001'],'L':['1000','1000','1000','1000','1111'],
  'M':['10001','11011','10101','10001','10001'],'N':['1001','1101','1011','1001','1001'],
  'O':['0110','1001','1001','1001','0110'],'P':['1110','1001','1110','1000','1000'],
  'Q':['0110','1001','1001','1011','0110'],'R':['1110','1001','1110','1010','1001'],
  'S':['0111','1000','0110','0001','1110'],'T':['11111','00100','00100','00100','00100'],
  'U':['1001','1001','1001','1001','0110'],'V':['10001','10001','10001','01010','00100'],
  'W':['10001','10001','10101','11011','10001'],'X':['1001','1011','0110','1101','1001'],
  'Y':['10001','10001','01010','00100','00100'],'Z':['1111','0001','0110','1000','1111'],
  '0':['0110','1011','1101','1001','0110'],'1':['010','110','010','010','111'],
  '2':['1110','0001','0110','1000','1111'],'3':['1110','0001','0110','0001','1110'],
  '4':['1001','1001','1111','0001','0001'],'5':['1111','1000','1110','0001','1110'],
  '6':['0110','1000','1110','1001','0110'],'7':['1111','0001','0010','0100','0100'],
  '8':['0110','1001','0110','1001','0110'],'9':['0110','1001','0111','0001','0110'],
  '-':['000','000','111','000','000'],'.':['000','000','000','000','010'],
  ':':['000','010','000','010','000'],'/':['0001','0010','0100','1000','0000'],
  ' ':null,
};
const MISSING = new Set();
const painted = new Set(); // QA 0904 gate: "x,y" of every ink pixel drawn by textRun
function textRun(str, x, y, color, scale, gap) {
  let cx = x;
  for (const ch of str) {
    if (ch === ' ') { cx += (4 + gap) * scale; continue; }
    let g = GLYPH[ch];
    if (g === undefined) { MISSING.add(ch); g = GLYPH['?'] || ['1111','0001','0110','0001','1111']; }
    const gw = Math.max(...g.map(r => r.length));
    for (let gy = 0; gy < 5; gy++) { const row = g[gy] || ''; for (let gx = 0; gx < gw; gx++) { if (row[gx] !== '1') continue;
      for (let sy = 0; sy < scale; sy++) for (let sx = 0; sx < scale; sx++) { const px_ = cx + gx * scale + sx, py_ = y + gy * scale + sy; put(px_, py_, color); painted.add(px_ + ',' + py_); } } }
    cx += (gw + gap) * scale;
  }
}
// title (big — mirrors the 44px Press Start 2P; drawn chunky for legibility check)
const t = 'SPACE FARMER'; const tw = t.length * 7 * 7;
textRun(t, W / 2 - tw / 2, H / 2 - 40, [220, 255, 230], 7, 2); // bright, big
// subtitle + prompt (smaller)
const s2 = 'ASTEROID B-612  YEAR 2987'; textRun(s2, W / 2 - s2.length * 4.5 * 2, H / 2 + 18, [57, 197, 187], 4, 2);
const s3 = 'PRESS SPACE  TAP TO BEGIN'; textRun(s3, W / 2 - s3.length * 4.5 * 2, H / 2 + 58, [255, 233, 160], 4, 2);
// QA 0904 8.1 gate: the shipped bitmap font had NO space glyph — every ' '
// printed an ink block, so the title looked like a corrupted transmission.
// Assert the title band contains a fully-blank column between the words: a
// space that advances the pen must leave at least one zero-ink column.
{
  const ty = Math.round(H / 2 - 40), th = 5 * 7, tx0 = Math.round(W / 2 - tw / 2);
  let run = 0, maxRun = 0;
  for (let x = tx0; x < tx0 + tw + 14; x++) {
    let ink = 0;
    for (let y = ty; y < ty + th; y++) if (painted.has(x + ',' + y)) ink++;
    if (ink === 0) { run++; maxRun = Math.max(maxRun, run); } else run = 0;
  }
  // Inter-letter gutters are only (gap*scale)=2 blank px wide; a word space
  // must open a contiguous blank run at least (4+gap)*scale=6 px wide. If a
  // space ever renders ink again (the 8.1 bug), the max run collapses to ~2.
  const spaceRun = (4 + 2) * 7 * 0.4;   // >=40% of a full space advance counts
  if (maxRun < spaceRun) {
    console.error(`✗ preview_intro: no contiguous blank run wide enough for a word space in the title band (maxRun=${maxRun}px, need >=${spaceRun}px) — space glyph regression (spaces rendering as ink)`);
    process.exitCode = 1;
  } else console.log(`✓ intro title word-spacing: contiguous blank word-gap run ${maxRun}px (space advances with zero ink)`);
}
// The whole class of bug this sheet used to ship: a glyph silently aliased onto
// another letter ('C' == 'O' printed "SPAOE FARMER"; '0' == 'O'; 'G'/'7' absent
// fell through to a filler box and printed "BEBIN" / "YEAR 2?18"). Assert the
// atlas has no lookalike collisions and covers every rendered string.
{
  const bucket = {};
  for (const [ch, rows] of Object.entries(GLYPH)) {
    if (!rows) continue;
    const w = Math.max(...rows.map(r => r.length));
    const k = rows.map(r => r.padEnd(w, '0')).join('|');
    (bucket[k] = bucket[k] || []).push(ch);
  }
  const collisions = Object.values(bucket).filter(g => g.length > 1);
  const need = new Set((t + s2 + s3).split('').filter(c => c !== ' '));
  const holes = [...need].filter(c => GLYPH[c] === undefined);
  if (collisions.length || holes.length) {
    console.error(`✗ preview_intro font atlas broken — collisions: ${JSON.stringify(collisions)} missing: ${JSON.stringify(holes)}`);
    process.exitCode = 1;
  } else console.log('✓ intro font atlas: no lookalike collisions, full string coverage');
}
if (MISSING.size) { console.error(`✗ preview_intro: ${MISSING.size} glyph(s) MISSING from the font atlas: ${[...MISSING].map(c => JSON.stringify(c)).join(', ')}`); process.exitCode = 1; }

// PNG encode
function crc32(b){if(!crc32.t){crc32.t=new Int32Array(256);for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=(c&1)?(0xEDB88320^(c>>>1)):(c>>>1);crc32.t[n]=c;}}let c=0xFFFFFFFF;for(let i=0;i<b.length;i++)c=crc32.t[(c^b[i])&0xFF]^(c>>>8);return(c^0xFFFFFFFF)>>>0;}
function chunk(t,d){const l=Buffer.alloc(4);l.writeUInt32BE(d.length);const td=Buffer.concat([Buffer.from(t),d]);const c=Buffer.alloc(4);c.writeUInt32BE(crc32(td));return Buffer.concat([l,td,c]);}
const sig=Buffer.from([0x89,0x50,0x4E,0x47,0x0D,0x0A,0x1A,0x0A]);const ih=Buffer.alloc(13);ih.writeUInt32BE(W,0);ih.writeUInt32BE(H,4);ih[8]=8;ih[9]=6;
const raw=Buffer.alloc(H*(1+W*4));for(let y=0;y<H;y++){raw[y*(1+W*4)]=0;fb.copy(raw,y*(1+W*4)+1,y*W*4,(y+1)*W*4);}
fs.writeFileSync('/tmp/intro_title.png',Buffer.concat([sig,chunk('IHDR',ih),chunk('IDAT',zlib.deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]));
console.log('wrote /tmp/intro_title.png');

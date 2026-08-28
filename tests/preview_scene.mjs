// preview_scene.mjs — offline composite of the PlanetScene frame (day + night)
// Mirrors the Phaser render pass: nebula → planet → stars → ground grid → fence →
// decor → buildings → NPCs → player. Uses headless sprites + real MapData layout.
// Writes PNGs for vision QA with zero browser timing dependence.
import * as SS from '../client/systems/SpriteSystem.js';
import { MAP_W, MAP_H, ground, BUILDINGS, DECOR, NPC_POS, PLAYER_START, fenceSpans } from '../client/systems/MapData.js';
import { px } from '../client/systems/SpriteSystem.js';
import zlib from 'node:zlib';
import fs from 'node:fs';

const T = 32, W = 960, H = 720, ZOOM = 1;
const VW = MAP_W * T, VH = MAP_H * T;
// Simulate the zoom-2 camera centered on the player start (world-local)
const pwx = PLAYER_START.x * T + T / 2, pwy = PLAYER_START.y * T + T / 2;
const worldX = (W - VW) / 2, worldY = (H - VH) / 2;
// camera view (screen): screenX = (worldX + wx - scrollX)*ZOOM
const scrollX = pwx + worldX - W / (2 * ZOOM) * ZOOM / ZOOM; // center player
// Simpler: screen = (worldX + wx - (pwx + worldX - W/(2*ZOOM)))*ZOOM
const camLeft = pwx + worldX - W / (2 * ZOOM);
const camTop = pwy + worldY - H / (2 * ZOOM);
const toScreenX = wx => (worldX + wx - camLeft) * ZOOM;
const toScreenY = wy => (worldY + wy - camTop) * ZOOM;
// scale factors: draw sprites at ZOOM
const GROUND_TEX = {
  grass_a: 'tile.grass_a', grass_b: 'tile.grass_b', grass_c: 'tile.grass_c',
  grass_d: 'tile.grass_d', grass_e: 'tile.grass_e', grass_f: 'tile.grass_f',
  path: 'tile.path', water: 'tile.water', soil: 'tile.soil',
  soil_b: 'tile.soil_b',
};
const DECOR_TEX = {
  'decor.lamp': SS.TEXTURES['decor.lamp'], 'decor.planter': SS.TEXTURES['decor.planter'],
  'decor.barrel_water': SS.TEXTURES['decor.barrel_water'], 'decor.barrel_cargo': SS.TEXTURES['decor.barrel_cargo'],
  'decor.bush': SS.TEXTURES['decor.bush'],
  'decor.tree_leaf': SS.TEXTURES['decor.tree_leaf'],
  'decor.tree_bloom': SS.TEXTURES['decor.tree_bloom'],
  'decor.pond': SS.TEXTURES['decor.pond'],
};
const NEB = SS.makeNebula();
const SKY = SS.makeSky();
const FOG = SS.makeFog();

// ── warm filmic grade (approximates PlanetScene's SOFT_LIGHT warm wash) ──
function applyGrade(fb) {
  for (let i = 0; i < fb.length; i += 4) {
    const r = fb[i], g = fb[i + 1], b = fb[i + 2];
    fb[i] = Math.min(255, r * 0.94 + 22 + (255 - r) * 0.06);      // lifted, warm
    fb[i + 1] = Math.min(255, g * 0.94 + 20 + (255 - g) * 0.06);
    fb[i + 2] = Math.min(255, b * 0.86 + 12 + (255 - b) * 0.05);  // slight cool cast
  }
  return fb;
}
function makeFrame(night) {
  const fb = Buffer.alloc(W * H * 4);
  const put = (x, y, [r, g, b]) => { if (x < 0 || y < 0 || x >= W || y >= H) return; const i = (y * W + x) * 4; fb[i] = r; fb[i + 1] = g; fb[i + 2] = b; fb[i + 3] = 255; };
  const blend = (x, y, [r, g, b], a) => { if (x < 0 || y < 0 || x >= W || y >= H) return; const i = (y * W + x) * 4; fb[i] = Math.min(255, Math.round(fb[i] + r * a)); fb[i + 1] = Math.min(255, Math.round(fb[i + 1] + g * a)); fb[i + 2] = Math.min(255, Math.round(fb[i + 2] + b * a)); fb[i + 3] = 255; };
  // blit a world-local sprite at its top-left (wx,wy) under the zoom-2 camera
  const blitW = (cv, wx, wy, o = {}) => {
    const sx = toScreenX(wx), sy = toScreenY(wy);
    for (let y = 0; y < cv.height; y++) for (let x = 0; x < cv.width; x++) {
      const cx = o.flipX ? cv.width - 1 - x : x;
      const p = px(cv, cx, y);
      if (p[3] === 0) continue;
      const dx = sx + x * ZOOM, dy = sy + y * ZOOM;
      if (o.add) { for (let sy2 = 0; sy2 < ZOOM; sy2++) for (let sx2 = 0; sx2 < ZOOM; sx2++) blend(dx + sx2, dy + sy2, p, o.alpha ?? 0.8); }
      else { for (let sy2 = 0; sy2 < ZOOM; sy2++) for (let sx2 = 0; sx2 < ZOOM; sx2++) put(dx + sx2, dy + sy2, p); }
    }
  };
  // blit a screen-space sprite (backdrop)
  const blitS = (cv, sx, sy, o = {}) => {
    for (let y = 0; y < cv.height; y++) for (let x = 0; x < cv.width; x++) {
      const p = px(cv, x, y);
      if (p[3] === 0) continue;
      if (o.add) blend(sx + x, sy + y, p, o.alpha ?? 0.85);
      else put(sx + x, sy + y, p);
    }
  };

  // 1. backdrop (screen-space): painterly dusk sky, then nebula glow, planets
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) put(x, y, px(SKY, x % 320, y % 512));
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const nb = px(NEB, x % 256, y % 256);
    const i = (y * W + x) * 4;
    if (nb[0] > 30 || nb[1] > 30 || nb[2] > 40) { fb[i] = Math.min(255, Math.round(fb[i] * 0.72 + nb[0] * 0.28)); fb[i+1] = Math.min(255, Math.round(fb[i+1] * 0.72 + nb[1] * 0.28)); fb[i+2] = Math.min(255, Math.round(fb[i+2] * 0.72 + nb[2] * 0.28)); }
  }
  blitS(SS.planetSprite, W - 174, 90);
  blitS(SS.planetSprite, 60, H - 210, { flipX: true });
  let seed = 1337; const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  for (let i = 0; i < 150; i++) { const x = Math.floor(rnd() * W), y = Math.floor(rnd() * H); put(x, y, [220, 225, 255]); }

  // 2. ground (world-space, zoomed)
  for (let y = 0; y < MAP_H; y++) for (let x = 0; x < MAP_W; x++) blitW(SS.TEXTURES[GROUND_TEX[ground[y][x]] || 'tile.grass_a'], x * T, y * T);

  // 2b. cast shadows — Phase 1 lighting: soft directional ellipses under buildings & natural decor
  const softEll = (wx, wy, wpx, hpx, strength) => {
    const cxs = toScreenX(wx), cys = toScreenY(wy);
    const scw = wpx * ZOOM * 0.5, sch = hpx * ZOOM * 0.5;
    for (let yy = -sch; yy <= sch; yy++) for (let xx = -scw; xx <= scw; xx++) {
      const d = Math.hypot(xx / scw, yy / sch);
      if (d > 1) continue;
      const a = Math.pow(1 - d, 1.5) * strength;
      blend(cxs + xx, cys + yy, [8, 12, 22], a);
    }
  };
  for (const b of BUILDINGS) softEll(b.x * T, (b.y + b.h) * T + 4, (b.w || 3) * T, 26, 0.5);
  for (const d of DECOR) if (d.tex !== 'decor.lamp' && d.tex !== 'decor.pond') softEll(d.x * T, d.y * T, 30, 14, 0.42);;
  
  // 3. fence
  const spans = fenceSpans();
  for (const sp of spans) {
    blitW(SS.fenceBeamA, sp.x0 * T + 4, sp.y * T + 6);
    blitW(SS.fencePost, sp.x0 * T + 2, sp.y * T + 2);
    blitW(SS.fencePost, sp.x1 * T + 2, sp.y * T + 2);
  }

  // 4. decor (y-sorted)
  for (const d of [...DECOR].sort((a, b) => a.y - b.y)) { const tx = DECOR_TEX[d.tex]; if (tx) blitW(tx, d.x * T, d.y * T); }

  // 5. buildings (y-sorted)
  for (const b of [...BUILDINGS].sort((a, b2) => (a.y + a.h) - (b2.y + b2.h))) {
    const tex = b.key === 'house' ? SS.TEXTURES['bld.house'] : b.key === 'shop' ? SS.TEXTURES['bld.shop'] : b.key === 'tavern' ? SS.TEXTURES['bld.tavern_a'] : SS.TEXTURES['bld.exchange_a'];
    blitW(tex, b.x * T, b.y * T);
  }


  // 6. NPCs
  for (const [id, pos] of Object.entries(NPC_POS)) blitW(SS.TEXTURES['npc.' + id], pos.x * T + 12, pos.y * T + 20);

  // 7. player
  blitW(SS.TEXTURES['player.front'], PLAYER_START.x * T + 12, PLAYER_START.y * T + 20);

  // 8. night pass: stronger multiply (match real Phaser 0.42 overlay) + additive glows
  if (night) {
    for (let i = 0; i < W * H; i++) { fb[i * 4] = Math.round(fb[i * 4] * 0.42); fb[i * 4 + 1] = Math.round(fb[i * 4 + 1] * 0.46); fb[i * 4 + 2] = Math.round(fb[i * 4 + 2] * 0.66); }
    for (const b of BUILDINGS) {
      if (!b.glow) continue;
      const g = { 'bld.house_glow': SS.houseGlowSprite, 'bld.shop_glow': SS.shopGlow, 'bld.exchange_glow': SS.exchangeGlow, 'bld.tavern_glow': SS.tavernGlow }[b.glow];
      if (g) blitW(g, b.x * T, b.y * T, { add: true, alpha: 0.95 });
    }
    for (const d of DECOR) if (d.tex === 'decor.lamp') blitW(SS.lampGlow, d.x * T - 6, d.y * T - 8, { add: true, alpha: 1.0 });
  }
  return fb;
}

function crc32(buf) {
  if (!crc32.t) { crc32.t = new Int32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1); crc32.t[n] = c; } }
  let c = 0xFFFFFFFF; for (let i = 0; i < buf.length; i++) c = crc32.t[(c ^ buf[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0;
}
function chunk(type, data) { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td)); return Buffer.concat([len, td, crc]); }
function toPNG(fb, out) {
  const sig = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 6;
  const raw = Buffer.alloc(H * (1 + W * 4));
  for (let y = 0; y < H; y++) { raw[y * (1 + W * 4)] = 0; fb.copy(raw, y * (1 + W * 4) + 1, y * W * 4, (y + 1) * W * 4); }
  fs.writeFileSync(out, Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
}

toPNG(applyGrade(makeFrame(false)), '/tmp/planet_day.png');
toPNG(applyGrade(makeFrame(true)), '/tmp/planet_night.png');
console.log(`wrote /tmp/planet_day.png + /tmp/planet_night.png (zoom ${ZOOM}, ${W}x${H})`);

// preview_interiors.mjs — home-interior + ship-cabin mockups that match the
// REAL scene rendering (room with wall/floor/lighting, not assets-in-a-void).
import * as SS from '../client/systems/SpriteSystem.js';
import { px } from '../client/systems/SpriteSystem.js';
import zlib from 'node:zlib';
import fs from 'node:fs';

const SC = 5; // prop upscale

function makeCanvas(W, H) {
  const fb = Buffer.alloc(W * H * 4);
  for (let i = 0; i < W * H; i++) fb[i * 4 + 3] = 255;
  return {
    W, H, fb,
    put(x, y, c) { if (x < 0 || y < 0 || x >= W || y >= H) return; const i = (y * W + x) * 4; fb[i] = c[0]; fb[i + 1] = c[1]; fb[i + 2] = c[2]; },
    // src-over blit of a headless surface at integer scale `s`
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
    // tile a headless surface across the whole canvas (seamless repeat)
    tile(cv, s) {
      for (let oy = 0; oy < H; oy += cv.height * s)
        for (let ox = 0; ox < W; ox += cv.width * s)
          this.blit(cv, ox, oy, s);
    },
    // soft additive glow (r,g,b) — used for lamps / window light pools
    glow(cx, cy, rx, ry, r, g, b, k) {
      for (let y = cy - ry; y <= cy + ry; y++) for (let x = cx - rx; x <= cx + rx; x++) {
        if (x < 0 || y < 0 || x >= W || y >= H) continue;
        const dx = (x - cx) / rx, dy = (y - cy) / ry;
        const d2 = dx * dx + dy * dy; if (d2 > 1) continue;
        const a = Math.max(0, 0.5 - (d2 - 1) * 0.5) * k; // soft falloff
        const i = (y * W + x) * 4;
        fb[i] = Math.min(255, fb[i] + r * a);
        fb[i + 1] = Math.min(255, fb[i + 1] + g * a);
        fb[i + 2] = Math.min(255, fb[i + 2] + b * a);
      }
    },
    // vignette (multiply dark toward the corners)
    vignette(strength) {
      const cx = W / 2, cy = H / 2;
      const R = Math.hypot(cx, cy);
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const d = Math.hypot(x - cx, y - cy) / R;
        const f = 1 - Math.max(0, d - 0.45) * strength;
        const i = (y * W + x) * 4;
        fb[i] *= f; fb[i + 1] *= f; fb[i + 2] *= f;
      }
    },
    // soft drop shadow under a prop (grounds it)
    shadow(cx, cy, rx, ry, k) {
      for (let y = cy - ry; y <= cy + ry; y++) for (let x = cx - rx; x <= cx + rx; x++) {
        if (x < 0 || y < 0 || x >= W || y >= H) continue;
        const dx = (x - cx) / rx, dy = (y - cy) / ry;
        const d2 = dx * dx + dy * dy; if (d2 > 1) continue;
        const a = (1 - d2) * k;
        const i = (y * W + x) * 4;
        fb[i] *= (1 - a); fb[i + 1] *= (1 - a); fb[i + 2] *= (1 - a);
      }
    },
    // filled rounded-rect region (for chest/stove/door props)
    rect(x0, y0, x1, y1, c, stroke) {
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) this.put(x, y, c);
      if (stroke) {
        for (let x = x0; x <= x1; x++) { this.put(x, y0, stroke); this.put(x, y1, stroke); }
        for (let y = y0; y <= y1; y++) { this.put(x0, y, stroke); this.put(x1, y, stroke); }
      }
    },
    write(out) {
      function crc32(b) { if (!crc32.t) { crc32.t = new Int32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1); crc32.t[n] = c; } } let c = 0xFFFFFFFF; for (let i = 0; i < b.length; i++) c = crc32.t[(c ^ b[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
      const sig = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
      const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 6;
      const chunk = (t, d) => { const len = Buffer.alloc(4); len.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const cr = Buffer.alloc(4); cr.writeUInt32BE(crc32(td)); return Buffer.concat([len, td, cr]); };
      const raw = Buffer.alloc(H * (1 + W * 4));
      for (let y = 0; y < H; y++) { raw[y * (1 + W * 4)] = 0; this.fb.copy(raw, y * (1 + W * 4) + 1, y * W * 4, (y + 1) * W * 4); }
      fs.writeFileSync(out, Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
      console.log(`wrote ${out} (${W}x${H})`);
    },
  };
}

// ══ HOME INTERIOR — matches PlanetScene.buildInterior: panelled back wall,
//    skirting, gradient wood floor, window light pool, grounded furniture ══
{
  const W = 480, H = 340, wallH = 104;
  const C = makeCanvas(W, H);
  // back wall (warm panels)
  for (let y = 0; y < wallH; y++) for (let x = 0; x < W; x++) C.put(x, y, [110, 85, 60]);
  for (let i = 1; i < 6; i++) { const wx = Math.round(i * (W / 6)); for (let y = 3; y < wallH - 3; y++) C.put(wx, y, [90, 68, 46]); }
  // skirting
  for (let x = 0; x < W; x++) for (let y = wallH; y < wallH + 5; y++) C.put(x, y, [138, 108, 74]);
  // floor: warm wood, gradient lighter at wall -> darker near you
  for (let y = wallH + 5; y < H; y++) {
    const t = (y - wallH - 5) / (H - wallH - 5);
    const r = 110 + (64 - 110) * t, g = 85 + (48 - 85) * t, b = 56 + (30 - 56) * t;
    for (let x = 0; x < W; x++) C.put(x, y, [r | 0, g | 0, b | 0]);
  }
  // floorboard seams
  for (let i = 1; i < 5; i++) { const ly = wallH + i * ((H - wallH) / 5); for (let x = 3; x < W - 3; x++) C.put(x, ly, [60, 45, 28]); }
  // window light pool (the room is lit)
  C.glow(W / 2 - 30, wallH + 26, 120, 80, 255, 230, 180, 0.16);
  // props (blits at SC)
  const T = (k) => SS.TEXTURES[k];
  C.blit(T('int.window'), 210, 18, SC);
  C.shadow(90, 118, 60, 12, 0.35); C.blit(T('int.bookcase'), 40, 60, SC);
  C.shadow(410, 200, 40, 10, 0.30); C.blit(T('int.plant'), 385, 155, SC);
  C.shadow(240, 170, 70, 12, 0.30); C.blit(T('int.table'), 175, 125, SC);
  C.shadow(130, 230, 55, 10, 0.30); C.blit(T('int.rug'), 80, 205, SC);
  C.shadow(90, 290, 60, 12, 0.35); C.blit(T('int.bed'), 40, 235, SC);
  // chest + stove (simple warm props with brass strokes, like the scene)
  C.rect(30, 110, 74, 138, [74, 51, 34], [216, 160, 90]);
  C.rect(400, 55, 455, 88, [58, 42, 32], [216, 160, 90]);
  C.vignette(0.45);
  C.write('/tmp/interior_home.png');
}

// ══ SHIP CABIN — matches SpaceshipScene: metal-deck floor + hull-wall band,
//    teal accents, vignette, warm porthole glow, grounded props ══
{
  const W = 480, H = 400, wallH = 96;
  const C = makeCanvas(W, H);
  // hull wall band: tile the wall texture across the top
  C.tile(SS.SHIP_SPRITES.wall, 3); // 32*3 = 96px tall band
  // mask below the wall band with floor tiles
  const floor = SS.SHIP_SPRITES.floor;
  for (let oy = wallH; oy < H; oy += floor.height * 3)
    for (let ox = 0; ox < W; ox += floor.width * 3)
      C.blit(floor, ox, oy, 3);
  // skirting seam where hull meets deck
  for (let x = 0; x < W; x++) for (let y = wallH - 2; y < wallH + 2; y++) C.put(x, y, [34, 42, 52]);
  // porthole + warm glow (like the scene's fx)
  C.shadow(W - 120, 150, 46, 46, 0.25);
  C.glow(W - 120, 150, 90, 90, 255, 200, 140, 0.14);
  C.glow(200, 130, 140, 70, 120, 220, 215, 0.10); // console teal wash
  // props: cryo pods, consoles, airlock, door
  const S = SS.SHIP_SPRITES;
  C.shadow(120, 200, 55, 14, 0.4); C.blit(S.cryopod, 60, 150, SC);
  C.shadow(230, 260, 55, 14, 0.4); C.blit(S.cryopod, 170, 210, SC);
  C.shadow(90, 340, 50, 12, 0.4); C.blit(S.console, 30, 300, SC);
  C.shadow(330, 340, 50, 12, 0.4); C.blit(S.airlock, 270, 295, SC);
  C.shadow(420, 200, 34, 30, 0.4); C.blit(S.door, 395, 150, SC);
  C.vignette(0.5);
  C.write('/tmp/ship_cabin.png');
}

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
    // Warm filmic grade — mirrors the scene's SOFT_LIGHT amber ambient wash.
    // Uses the W3C soft-light composite (not multiply): a multiply amber only
    // darkens, which is exactly why the cabin "never read warm". Soft-light
    // pushes midtones toward the fixture colour while keeping blacks open.
    warmGrade(k, r, g, b) {
      const D = (B) => (B <= 0.25 ? ((16 * B - 12) * B + 4) * B : Math.sqrt(B));
      const chans = [r / 255, g / 255, b / 255];
      for (let i = 0; i < W * H; i++) {
        const j = i * 4;
        for (let c = 0; c < 3; c++) {
          const B = Math.min(1, fb[j + c] / 255), S = chans[c];
          const sl = S <= 0.5 ? B - (1 - 2 * S) * B * (1 - B) : B + (2 * S - 1) * (D(B) - B);
          fb[j + c] = fb[j + c] * (1 - k) + sl * 255 * k;
        }
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
  // back wall: colony slate habitat (teal trim) — stretch INT_WALL across the band
  for (let y = 0; y < wallH; y++) {
    const sy = Math.min(23, Math.floor(y * 24 / wallH));
    for (let x = 0; x < W; x++) {
      const sx = Math.min(95, Math.floor(x * 96 / W));
      const p = px(SS.INT_WALL, sx, sy);
      C.put(x, y, [p[0], p[1], p[2]]);
    }
  }
  // floor: machined metal deck (colony seams) — stretch INT_FLOOR
  for (let y = wallH; y < H; y++) {
    const sy = Math.min(23, Math.floor((y - wallH) * 24 / (H - wallH)));
    for (let x = 0; x < W; x++) {
      const sx = Math.min(95, Math.floor(x * 96 / W));
      const p = px(SS.INT_FLOOR, sx, sy);
      C.put(x, y, [p[0], p[1], p[2]]);
    }
  }
  // window light pools + fixtures — the SAME hang() pairing buildRoom draws for
  // every kind (fixture rides the wall band, warm collar under the emitter,
  // wide amber pool centred under the lamp at the scene's 5.2x3.4 scale).
  const hangHere = (lampX, poolCy) => {
    const g = SS.TEXTURES['fx.lamp_glow'];
    const TINT = [255, 190, 90];
    const drawPool = (lx, cy, sx, sy, a) => {
      const gw = Math.round(g.width * sx), gh = Math.round(g.height * sy);
      for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) {
        const p = px(g, Math.min(g.width - 1, Math.floor(x / sx)), Math.min(g.height - 1, Math.floor(y / sy)));
        if (!p || p[3] <= 8) continue;
        const al = (p[3] / 255) * a;
        const bx = lx - (gw >> 1) + x, by = cy - (gh >> 1) + y;
        if (bx < 0 || by < wallH || bx >= W || by >= H) continue;
        const bg = px(SS.INT_FLOOR, Math.min(95, Math.floor(bx * 96 / W)), Math.min(23, Math.floor((by - wallH) * 24 / (H - wallH))));
        C.put(bx, by, [bg[0] + (p[0] * TINT[0] / 255 - bg[0]) * al, bg[1] + (p[1] * TINT[1] / 255 - bg[1]) * al, bg[2] + (p[2] * TINT[2] / 255 - bg[2]) * al]);
      }
    };
    // C.blit's loop bounds are the scale itself (sy < s), so FRACTIONAL scales
    // silently drop rows — a 4.3 call drew only the fixture's 5x5 corner and
    // the lamp vanished. Scale-blit by hand at full resolution instead.
    const f = SS.TEXTURES['int.ceilingLight'];
    const fs = 4.3;
    const fx0 = lampX - Math.round(f.width * fs / 2), fy0 = wallH - 26 - Math.round(f.height * fs / 2);
    for (let sy = 0; sy < f.height; sy++) for (let sx = 0; sx < f.width; sx++) {
      const p = px(f, sx, sy);
      if (!p || p[3] < 20) continue;
      const x0 = fx0 + Math.round(sx * fs), y0 = fy0 + Math.round(sy * fs);
      for (let dy = 0; dy < Math.ceil(fs); dy++) for (let dx = 0; dx < Math.ceil(fs); dx++) {
        const bx = x0 + dx, by = y0 + dy;
        if (bx < 0 || bx >= W || by < 0 || by >= wallH) continue;   // rides the wall band
        C.put(bx, by, [p[0], p[1], p[2]]);
      }
    }
    drawPool(lampX, wallH - 4, 2.6, 1.2, 0.30);
    drawPool(lampX, poolCy, 5.2, 3.4, 0.32);
  };
  hangHere(W / 2 - 30, wallH + 22);
  hangHere(W / 2 + 90, wallH + 34);
  // props — same colony language, grounded with soft shadows (scale 1 = real room)
  const T = (k) => SS.TEXTURES[k];
  C.blit(T('int.window'), 210, 20, 1);
  C.shadow(62, 92, 26, 6, 0.30); C.blit(T('int.bookcase'), 40, 60, 1);
  C.shadow(405, 190, 24, 7, 0.30); C.blit(T('int.plant'), 385, 155, 1);
  C.shadow(197, 155, 26, 7, 0.30); C.blit(T('int.table'), 175, 125, 1);
  C.shadow(104, 230, 28, 5, 0.25); C.blit(T('int.rug'), 80, 205, 1);
  C.shadow(64, 300, 28, 7, 0.30); C.blit(T('int.bed'), 40, 235, 1);
  // colony galley stove + cargo pod chest + airlock door (sprites, not debug rects)
  C.shadow(192, 90, 26, 7, 0.30); C.blit(T('int.stove'), 170, 60, 1);
  C.shadow(322, 160, 26, 7, 0.30); C.blit(T('int.chest'), 300, 130, 1);
  C.shadow(338, 296, 22, 9, 0.30); C.blit(T('int.door'), 320, 250, 1);
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
  // ceiling warm pools (mirrors scene's fx.pool_warm ADD lights) + filmic grade
  C.glow(134, 120, 110, 70, 255, 180, 106, 0.14);
  C.glow(298, 250, 120, 76, 255, 180, 106, 0.12);
  C.glow(374, 136, 128, 80, 255, 180, 106, 0.12);
  C.warmGrade(0.34, 0xff, 0xb4, 0x6a);   // SOFT_LIGHT amber wash (the scene uses this now, not multiply)
  C.vignette(0.5);
  C.write('/tmp/ship_cabin.png');
}

// ══ BUILDING INTERIORS (shop / tavern / exchange / ranch) — one colony room
//    per building kind, matching PlanetScene.buildRoom + _decorateRoom ══
function roomMock(kind, out) {
  const W = 480, H = 340, wallH = 104;
  const C = makeCanvas(W, H);
  // wall + floor (colony habitat shell)
  for (let y = 0; y < wallH; y++) {
    const sy = Math.min(23, Math.floor(y * 24 / wallH));
    for (let x = 0; x < W; x++) {
      const sx = Math.min(95, Math.floor(x * 96 / W));
      const p = px(SS.INT_WALL, sx, sy); C.put(x, y, [p[0], p[1], p[2]]);
    }
  }
  for (let y = wallH; y < H; y++) {
    const sy = Math.min(23, Math.floor((y - wallH) * 24 / (H - wallH)));
    for (let x = 0; x < W; x++) {
      const sx = Math.min(95, Math.floor(x * 96 / W));
      const p = px(SS.INT_FLOOR, sx, sy); C.put(x, y, [p[0], p[1], p[2]]);
    }
  }
  // QA 0904 3.3 mirror of buildRoom's hang(): visible ceiling fixture + warm
  // collar + wide warm pool, all paired per-lamp at the scene's exact scales.
  const hang = (lampX, poolCy) => {
    // Mirror of buildRoom's hang() at the SAME parameters: shell draws ~5x, so
    // the pool rides fx.lamp_glow at 5.2x3.4 tinted amber (the untinted core
    // over blue-slate composites grey at low alpha — measured [107,115,116]),
    // plus the same warm collar under the fixture's emitter.
    const drawPool = (lx, cy, sx, sy, a) => {
      const g = SS.TEXTURES['fx.lamp_glow'];
      const gw = Math.round(g.width * sx), gh = Math.round(g.height * sy);
      const TINT = [255, 190, 90];
      for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) {
        const p = px(g, Math.min(g.width - 1, Math.floor(x / sx)), Math.min(g.height - 1, Math.floor(y / sy)));
        if (!p || p[3] <= 8) continue;
        const al = (p[3] / 255) * a;
        const bx = lx - (gw >> 1) + x, by = cy - (gh >> 1) + y;
        if (bx < 0 || by < wallH || bx >= W || by >= H) continue;
        const bg = px(SS.INT_FLOOR, Math.min(95, Math.floor(bx * 96 / W)), Math.min(23, Math.floor((by - wallH) * 24 / (H - wallH))));
        C.put(bx, by, [bg[0] + (p[0] * TINT[0] / 255 - bg[0]) * al, bg[1] + (p[1] * TINT[1] / 255 - bg[1]) * al, bg[2] + (p[2] * TINT[2] / 255 - bg[2]) * al]);
      }
    };
    const f = SS.TEXTURES['int.ceilingLight'];
    const fs = 4.3;
    // manual scale-blit: C.blit's inner loops use the fractional scale as their
    // own bound (sy < s), so s=4.3 draws only 4 of every pixel's rows — and
    // for the 14-row fixture that clipped most of the lamp. Blit by hand.
    const fx0 = lampX - Math.round(f.width * fs / 2), fy0 = wallH - 26 - Math.round(f.height * fs / 2);
    for (let sy = 0; sy < f.height; sy++) for (let sx = 0; sx < f.width; sx++) {
      const p = px(f, sx, sy);
      if (!p || p[3] < 20) continue;
      const x0 = fx0 + Math.round(sx * fs), y0 = fy0 + Math.round(sy * fs);
      for (let dy = 0; dy < Math.ceil(fs); dy++) for (let dx = 0; dx < Math.ceil(fs); dx++) {
        const bx = x0 + dx, by = y0 + dy;
        if (bx < 0 || bx >= W || by < 0 || by >= wallH) continue;   // rides the wall band
        C.put(bx, by, [p[0], p[1], p[2]]);
      }
    }
    drawPool(lampX, wallH - 4, 2.6, 1.2, 0.30);
    drawPool(lampX, poolCy, 5.2, 3.4, 0.32);
  };
  hang(W / 2 - 30, wallH + 22);
  hang(W / 2 + 90, wallH + 34);
  const T = (k) => SS.TEXTURES[k];
  // window top-center + door bottom-right (shared shell)
  C.blit(T('int.window'), 210, 20, 1);
  C.shadow(338, 296, 22, 9, 0.30); C.blit(T('int.door'), 320, 250, 1);
  const put = (x, y, key) => { const img = T(key); C.shadow(x + img.width / 2, y + img.height + 4, img.width / 2, 6, 0.30); C.blit(img, x, y, 1); };
  // QA 0904 3.4 mirror: the scene hangs a lit signplate housing over each
  // room's service point and draws the room's WORD as real Phaser text on top
  // (headless can't render glyphs; verify_screens_wired/verify_sprites assert
  // the scene's text call is present, so the sheet doesn't lie about that).
  const sign = (x, y) => { const sp = T('int.signplate'); C.blit(sp, x - Math.floor(sp.width / 2), y - Math.floor(sp.height / 2), 1); };
  if (kind === 'shop') {
    // GROCER — counter front-left, stocked shelf wall right, crates fanning to door
    sign(63, 47);                                          // SHOP over the counter
    put(40, 60, 'int.counter');
    put(340, 46, 'int.shelf');
    put(330, 176, 'int.chest');
    put(20, 190, 'int.chest');
    put(60, 196, 'int.plant');
  } else if (kind === 'tavern') {
    // CANTINA — bottle shelf behind the bar, stools at the bar, seated tables
    sign(110, 18);                                         // TAVERN over the bar
    put(80, 30, 'int.barback');
    put(80, 62, 'int.counter');
    put(72, 96, 'int.stool');
    put(136, 96, 'int.stool');
    put(146, 170, 'int.table');
    put(120, 208, 'int.stool');
    put(172, 208, 'int.stool');
    put(286, 162, 'int.table');
    put(260, 200, 'int.stool');
    put(312, 200, 'int.stool');
  } else if (kind === 'exchange') {
    // TRADE HUB — terminal left, holo market board centre, intake counter right
    sign(63, 47);                                          // TRADE over the terminal
    put(40, 60, 'int.terminal');
    put(206, 128, 'int.holotable');
    put(330, 56, 'int.counter');
    put(20, 198, 'int.chest');
    put(58, 206, 'int.chest');
  } else if (kind === 'ranch') {
    // RANCH — service stall left, livestock pens with the animals standing in them
    sign(63, 47);                                          // RANCH over the stall
    put(40, 60, 'int.stall');
    put(316, 42, 'int.pen');
    put(316, 26, 'ranch.chicken');
    put(372, 34, 'ranch.sheep');
    put(200, 150, 'int.pen');
    put(206, 126, 'ranch.cow');
    put(20, 192, 'int.chest');
  }
  C.vignette(0.45);
  C.write(out);
}
roomMock('shop', '/tmp/interior_shop.png');
roomMock('tavern', '/tmp/interior_tavern.png');
roomMock('exchange', '/tmp/interior_exchange.png');
roomMock('ranch', '/tmp/interior_ranch.png');

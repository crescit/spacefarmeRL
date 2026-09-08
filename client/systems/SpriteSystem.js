import { ALIEN_DATA } from '../entities/AlienData.js';

// SpriteSystem.js — Space Farmer pixel-art sprite definitions
// 2000s-era 8-bit pixel art (GBA/EarthBound style).
//
// TWO authoring modes, both verified headless:
//   1. mkSprite(grid, palette, scale)  — string-grid pixel maps for compact tiles
//   2. createSurface(w, h, draw)       — procedural vector drawing for complex
//                                         multi-tile art (buildings). Deterministic,
//                                         no typo-prone wide grids.
//
// Works in browser (real canvas) and Node (TestCtx stub) for headless pixel tests.
//
// Sizing convention:
//   GROUND / DECOR : 16x16 → 16px canvas (T=16)
//   VILLAGE        : 16x16 grid @2 or 32x32 procedural → 32px canvas
//   HOUSE (hero)   : 64x60 procedural (4-tile wide, 3-tile tall)
//   PLANET         : 48x48 procedural
//   PLAYER / NPC   : 8x8 grid @2 → 16px

// ── Base palette ──
const PAL = {
  'R': [255, 42, 61],
  'G': [62, 230, 62],
  'B': [62, 138, 255],
  'K': [16, 16, 32],
  'W': [255, 255, 255],
  'Y': [255, 224, 32],
  'O': [255, 128, 32],
  'P': [200, 100, 255],
  'C': [62, 200, 200],
  'N': [32, 32, 48],
  'D': [120, 80, 35],
  'A': [128, 200, 128],
  'L': [100, 100, 200],
  'I': [255, 200, 200],
  'T': [64, 64, 80],
  'M': [200, 160, 80],
};

// ═══════════════════════════════════════════════════════════
// Surface — canvas or headless stub with a tiny vector API
// ═══════════════════════════════════════════════════════════
class TestCtx {
  constructor() { this.data = null; this.w = 0; this.h = 0; this.fillStyle = [0, 0, 0]; }
  createImageData(w, h) { this.w = w; this.h = h; this.data = new Array(w * h * 4).fill(0); return { data: this.data, width: w, height: h }; }
  putImageData(img) { this.data = img.data.slice(); }
  fillRect(x, y, w, h) {
    if (!this.data) return;
    const [r, g, b] = Array.isArray(this.fillStyle) ? this.fillStyle : [0, 0, 0];
    for (let yy = Math.max(0, y); yy < Math.min(this.h, y + h); yy++) {
      for (let xx = Math.max(0, x); xx < Math.min(this.w, x + w); xx++) {
        const i = (yy * this.w + xx) * 4;
        this.data[i] = r; this.data[i + 1] = g; this.data[i + 2] = b; this.data[i + 3] = 255;
      }
    }
  }
  fillText() {}
}

function makeStub(w, h) {
  return { width: w, height: h, _ctx: new TestCtx(), getContext() { return this._ctx; } };
}

// Sample pixel from any surface-backed canvas → [r,g,b,a]
function px(canvas, x, y) {
  if (x < 0 || y < 0 || x >= canvas.width || y >= canvas.height) return [0, 0, 0, 0];
  if (canvas._ctx && canvas._ctx.data) {
    const d = canvas._ctx.data, i = (y * canvas.width + x) * 4;
    return [d[i], d[i + 1], d[i + 2], d[i + 3]];
  }
  const d = canvas.getContext('2d').getImageData(x, y, 1, 1).data;
  return [d[0], d[1], d[2], d[3]];
}

// Create a drawing surface. draw(s) receives { rect, px, canvas }.
// Browser: real canvas (WebGL/2D friendly). Node: headless stub.
function createSurface(w, h, draw) {
  const isBrowser = typeof document !== 'undefined' && !!document.createElement;
  const canvas = isBrowser ? document.createElement('canvas') : makeStub(w, h);
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!isBrowser) ctx.createImageData(w, h);
  const s = {
    canvas,
    rect(x, y, rw, rh, color) {
      if (isBrowser) {
        ctx.fillStyle = `rgb(${color[0]},${color[1]},${color[2]})`;
        ctx.fillRect(x, y, rw, rh);
      } else {
        ctx.fillStyle = color;
        ctx.fillRect(x, y, rw, rh);
      }
    },
    px(x, y, color) { s.rect(x, y, 1, 1, color); },
    // horizontal span (alias, readability)
    hline(x0, x1, y, color) { s.rect(x0, y, x1 - x0 + 1, 1, color); },
  };
  draw(s);
  return canvas;
}

// ═══════════════════════════════════════════════════════════
// mkSprite — string grid → canvas
// ═══════════════════════════════════════════════════════════
function padArray(lines) {
  const stripped = lines.map(l => l.replace(/^\s+/, ''));
  const max = Math.max(...stripped.map(l => l.length));
  return stripped.map(l => l.padEnd(max, ' '));
}

function mkSprite(grid, palette, scale = 1) {
  const lines = padArray(grid.trim().split('\n'));
  const h = lines.length;
  const w = lines[0].length;
  return createSurface(w * scale, h * scale, (s) => {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const ch = lines[y][x] || ' ';
        if (ch !== '.' && ch !== ' ') {
          const color = palette[ch] || [0, 0, 0];
          s.rect(x * scale, y * scale, scale, scale, color);
        }
      }
    }
  });
}

// ═══════════════════════════════════════════════════════════
// GROUND TILES — 16x16 grids, scale 1
//   grass: 6 hand-drawn variants (breaks the checkerboard), each with
//   tuft/flower detail pixels. Scene picks a variant per tile position.
//   water: 2 frames (shimmer). soil/path: base + procedural speckle variant.
// ═══════════════════════════════════════════════════════════
const G_PAL = {
  'a': [92, 186, 92],   // grass base (vivid GBA green)
  'b': [128, 216, 118], // grass light (sunlit)
  'c': [64, 152, 64],   // grass dark
  'd': [48, 122, 56],   // grass tuft (deep)
  'Y': [255, 240, 150], // wildflower
  'W': [240, 250, 250], // wildflower white
  's': [206, 172, 132], // path sand (bright warm)
  't': [176, 138, 100], // path dark
  'w': [72, 168, 206],  // stardust water
  'W2': [128, 222, 244],// water light
  'D': [150, 104, 52],  // soil (warm)
  'E': [120, 80, 40],   // soil dark
  'G': [86, 208, 86],   // crop green (bright)
  'g': [56, 168, 56],   // crop dark
  'Y2': [255, 236, 40], // crop glow
  'P': [232, 128, 232], // berry
};
// water palette (brighter frame 2)
const G_PAL_WATER = { ...G_PAL, w: [64, 158, 196], W2: [110, 206, 232] };

function soilRead(canvas) {
  if (canvas._ctx && canvas._ctx.data) return canvas._ctx.data;
  return canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
}

const GROUND = buildSmoothGround();
// ══ SMOOTH SEAMLESS GROUND — painterly, continuous, zero pixel cells ══
// Every tile is a 32×32 soft ImageData field with *integer-cycle periodic*
// variation, so repeated tiles lock together into one seamless, continuous
// surface. All grass variants share ONE tile (same hue family) so the map
// reads as a single living biome instead of a checkerboard.
function buildSmoothGround() {
  const S = 32, TAU = Math.PI * 2;
  // contrast pass — warm, lighter colony floor so sky, ground and buildings
  // all separate and the scene reads clearly instead of a dark monochrome soup.
  const PA = {
    grass: { lit: [90, 126, 82], base: [62, 92, 62], deep: [40, 62, 44] },
    // Colony crete walkway — cool machined GREY, deliberately in the slate family
    // with plaza/grass. (Was warm sand-brown: the feeder trails read as dirt
    // paths cut through a sci-fi colony, which broke the whole art direction.)
    path:  { lit: [128, 136, 150], base: [100, 108, 122], deep: [72, 80, 94] },
    soil:  { lit: [128, 88, 62], base: [94, 62, 42], deep: [64, 40, 30] },         // deep warm EARTH (farm beds only)
    water: { lit: [80, 190, 204], base: [48, 142, 162], deep: [28, 96, 116] },
    sand:  { lit: [212, 188, 134], base: [182, 156, 108], deep: [150, 124, 82] },  // warm BEACH sand
    // Damp tide-line sand: sits between beach and open water so the lake edge
    // feathers instead of ending in a 1-tile razor line of dry beach.
    wetSand: { lit: [158, 140, 112], base: [126, 110, 88], deep: [96, 84, 68] },
    cliff: { lit: [118, 108, 98], base: [90, 82, 74], deep: [60, 54, 48] },        // rocky MOUNTAIN stone
    forest:{ lit: [66, 92, 50], base: [46, 66, 38], deep: [28, 44, 26] },          // mossy FOREST floor
  };
  const tile = (kind, phase = 0, vseed = 0) => {
    const P = PA[kind];
    return createSurface(S, S, (s) => {
      const ctx = s.canvas.getContext('2d');
      const img = ctx.createImageData(S, S), d = img.data;
      for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
        const nx = x / S, ny = y / S;
        // EDGE-SYMMETRIC lighting: every tile edge is the same tone, so
        // neighbouring tiles lock together with NO visible seams. Subtle
        // centre-highlight + a whisper of seamless organic mottle only.
        const edge = Math.max(Math.abs(nx - 0.5), Math.abs(ny - 0.5)) * 2; // 0 centre, 1 edge
        const key = 0.46 - 0.08 * edge;
        const f = Math.sin(nx * 2 * TAU + ny) * 0.022
                + Math.sin((nx + ny) * 3 * TAU + phase) * 0.014;
        let t = Math.max(0, Math.min(1, key + f + (kind === 'soil' ? -0.08 : kind === 'path' ? 0.1 : 0)));
        if (kind === 'soil' || kind === 'path') {
          // micro-grain so earth/stone read as textured, not flat paint
          const g = Math.sin(x * 11.7 + y * 5.3) * Math.sin(x * 3.7 - y * 17.9);
          t += g * 0.05;
          // SEAMLESS periodic grain: integer cycles across the 32px tile so it
          // locks with neighbours with no seams (QA 0904: the crete walkway was
          // near-flat at sd≈2.0 and read as one slab of paint, not ground).
          const pg = Math.sin(nx * 3 * TAU + 0.7) * Math.cos(ny * 4 * TAU - 0.3)
                   + 0.6 * Math.sin((nx + ny) * 6 * TAU)
                   + 0.4 * Math.sin((nx - ny) * 5 * TAU + 1.2);
          t += pg * 0.085;
        }
        if (kind === 'path') {
          // aggregate flecks + pits in the crete so a walkway has reading detail
          const ag = Math.sin(nx * 7 * TAU + 1.1) * Math.sin(ny * 5 * TAU + 0.4);
          if (ag > 0.72) t -= 0.14; else if (ag < -0.72) t += 0.13;
        }
        if (kind === 'soil') {
          // occasional darker clump / lighter fleck so a field never reads empty
          const cl = Math.sin((x + 7) * 3.1) * Math.cos((y + 3) * 4.7);
          if (cl > 0.86) t -= 0.12; else if (cl < -0.86) t += 0.10;
          // seamless clod field (QA 0904: soil sat at sd≈3.1 — flat warm paint)
          const clod = Math.sin(nx * 5 * TAU + 0.3) * Math.cos(ny * 6 * TAU + 1.1)
                     + 0.5 * Math.sin((nx - ny) * 4 * TAU);
          t += clod * 0.05;
          if (clod > 1.15) t -= 0.14; else if (clod < -1.15) t += 0.12;
        }
        let r = P.lit[0] + (P.deep[0] - P.lit[0]) * t;
        let g = P.lit[1] + (P.deep[1] - P.lit[1]) * t;
        let b = P.lit[2] + (P.deep[2] - P.lit[2]) * t;
        if (kind === 'grass') {          // faint bioluminescent-green undertone
          const bio = 5 * Math.max(0, Math.sin(nx * 3 * TAU + ny * 2 * TAU + vseed));
          g += bio; b += bio * 0.5;
          // organic blade tufts: light tips + dark shadow clumps (deterministic,
          // seamless-friendly) so grass reads as living ground, not wallpaper.
          // vseed rotates the tuft field per variant so a 6-variant spread is
          // genuinely distinct tiles, not the same tile under six names.
          const tuft = Math.sin((x * 3 + y * 2) * (1.7 + vseed * 0.11)) * Math.sin((x - y) * (2.3 - vseed * 0.08) + vseed);
          if (tuft > 0.72 - vseed * 0.012) { g = Math.min(255, g + 24 + vseed * 3); b = Math.min(255, b + 10); }
          else if (tuft < -0.78 + vseed * 0.01) { g = Math.max(0, g - 18); b = Math.max(0, b - 8); }
          // sparse wildflower flecks on 2 of the 6 variants (breaks monoculture
          // without turning the whole map into confetti)
          if (vseed === 2 || vseed === 4) {
            const fl = Math.sin((x * 7.3 + y * 11.1) * 1.3 + vseed * 2.2) * Math.cos((x - y * 2) * 2.7);
            if (fl > 0.93) {
              const wr = vseed === 2 ? [255, 236, 150] : [236, 232, 248];
              r = wr[0]; g = wr[1]; b = wr[2];
            }
          }
        } else if (kind === 'water') {   // soft plasma shimmer
          const sh = 12 * Math.sin((nx * 3 + ny * 2 + phase) * TAU);
          b += sh; g += sh * 0.6;
          // vseed-offset caustic sparkle + a second interference band so variants
          // do not stack into one flat cyan billboard
          const sp = Math.sin((x * 5.7 + y * 3.1) * 1.7 + vseed * 2.6) * Math.cos((x * 1.9 - y * 4.7) + vseed);
          if (sp > 0.86) { b = Math.min(255, b + 26); g = Math.min(255, g + 18); }
          const band = Math.sin((nx * 2 + ny * 5 + vseed * 0.7) * TAU);
          if (band > 0.8) { b = Math.min(255, b + 14); }
          else if (band < -0.82) { b = Math.max(0, b - 16); g = Math.max(0, g - 10); }
        } else if (kind === 'sand' || kind === 'wetSand') {    // wind-blown grains + ripple lines
          const grain = Math.sin(x * 17.3 + y * 9.1) * Math.sin(x * 5.1 - y * 13.7);
          if (grain > 0.78) { g = Math.min(255, g + 24); b = Math.min(255, b + 18); }
          else if (grain < -0.8) { g = Math.max(0, g - 18); b = Math.max(0, b - 14); }
          const ripple = Math.sin(ny * 6 * TAU + nx * 2 * TAU);
          if (Math.abs(ripple) < 0.12 && (x + y) % 7 < 4) { g = Math.min(255, g + 30); b = Math.min(255, b + 22); }
          if (kind === 'wetSand') {
            // damp sheen streaks toward the water side
            const sheen = Math.sin((nx * 4 + ny * 7 + vseed) * TAU);
            if (sheen > 0.55) { b = Math.min(255, b + 16); g = Math.min(255, g + 6); }
          }
        } else if (kind === 'cliff') {   // rock strata + light facets + cracks
          const strata = Math.sin(ny * 9 * TAU + nx * 3 * TAU);
          if (strata > 0.7) { r = Math.min(255, r + 30); g = Math.min(255, g + 26); b = Math.min(255, b + 24); }
          else if (strata < -0.72) { r = Math.max(0, r - 28); g = Math.max(0, g - 26); b = Math.max(0, b - 22); }
          const crack = Math.sin((x * 5 + y * 7) * 2.1) * Math.sin((x - y) * 3.3);
          if (crack > 0.86) { r = Math.max(0, r - 22); g = Math.max(0, g - 20); b = Math.max(0, b - 18); }
        } else if (kind === 'forest') {  // mossy organic tufts (richer, darker)
          const tuft = Math.sin((x * 3.7 + y * 2.9) * 1.9) * Math.sin((x - y) * 2.7);
          if (tuft > 0.68) { g = Math.min(255, g + 32); b = Math.min(255, b + 12); }
          else if (tuft < -0.74) { g = Math.max(0, g - 24); b = Math.max(0, b - 10); }
        }
        const i = (y * S + x) * 4;
        d[i] = Math.max(0, Math.min(255, r)) | 0;
        d[i + 1] = Math.max(0, Math.min(255, g)) | 0;
        d[i + 2] = Math.max(0, Math.min(255, b)) | 0;
                d[i + 3] = 255;
      }
      ctx.putImageData(img, 0, 0);
    });
  };
  // soil base for crop tiles
  const soilT = tile('soil');
  // crop stages layered on soil with soft SDF shapes
  const cropTile = (kind) => {
    return createSurface(S, S, (s) => {
      const ctx = s.canvas.getContext('2d');
      const img = ctx.createImageData(S, S), d = img.data;
      // copy soil base
      const sd = soilRead(soilT);
      for (let i = 0; i < d.length; i++) d[i] = sd[i];
      const blend = (x, y, c, a) => { if (x < 0 || y < 0 || x >= S || y >= S || a <= 0) return; const i2 = (y * S + x) * 4; const da = d[i2 + 3] / 255, oa = a + da * (1 - a); if (oa <= 0) return; let R, G, B; if (da <= 0) { R = c[0]; G = c[1]; B = c[2]; } else { R = (c[0] * a + d[i2] * da * (1 - a)) / oa; G = (c[1] * a + d[i2 + 1] * da * (1 - a)) / oa; B = (c[2] * a + d[i2 + 2] * da * (1 - a)) / oa; } d[i2] = R | 0; d[i2 + 1] = G | 0; d[i2 + 2] = B | 0; d[i2 + 3] = oa * 255 | 0; };
      const spr = (cx, cy, rx, ry, top, deep) => { for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) { const dx = (x - cx) / rx, dy = (y - cy) / ry; const dist = (Math.sqrt(dx * dx + dy * dy) - 1) * Math.min(rx, ry); const a = Math.max(0, Math.min(1, 0.5 - dist)); if (a > 0) blend(x, y, a < 0.5 ? top : deep, a); } };
      const strip = (y0, y1, dark) => { for (let y = y0; y <= y1; y++) for (let x = 0; x < S; x++) blend(x, y, dark, 0.55); };
      // soft furrow that tapers at the horizontal edges (blends with neighbours)
      const stripA = (y0, y1, dark, a) => { for (let y = y0; y <= y1; y++) for (let x = 0; x < S; x++) { const t = Math.min(1, Math.min(x, S - 1 - x) / 5) * a; if (t > 0) blend(x, y, dark, t); } };
      // warm raised mound between furrows (reads as a plowed bed, not a tile)
      const mound = (y0, y1, col) => { for (let y = y0; y <= y1; y++) for (let x = 0; x < S; x++) { const a = Math.max(0, 1 - Math.abs(y - (y0 + y1) / 2) / ((y1 - y0) / 2)) * 0.24; if (a > 0) blend(x, y, col, a); } };
      if (kind === 'tilled') {
        // soft furrows that TAPER at the tile edges (blend with neighbouring
        // plots) + warm raised mounds between beds → one continuous plowed
        // surface, not a square checkerboard. Warm earth tones, not cold blue.
        stripA(10, 13, [52, 34, 26], 0.5); stripA(17, 20, [52, 34, 26], 0.5); stripA(24, 27, [52, 34, 26], 0.5);
        mound(7, 9, [148, 104, 72]); mound(14, 16, [148, 104, 72]); mound(21, 23, [148, 104, 72]);
      }
      else if (kind === 'seeded') { spr(10, 12, 3, 2, [120, 210, 150], [70, 160, 110]); spr(22, 14, 3, 2, [120, 210, 150], [70, 160, 110]); spr(7, 21, 3, 2, [120, 210, 150], [70, 160, 110]); spr(24, 23, 3, 2, [120, 210, 150], [70, 160, 110]); }
      else if (kind === 'growing') { spr(16, 12, 6, 5, [110, 200, 140], [60, 150, 100]); spr(10, 16, 5, 4, [110, 200, 140], [60, 150, 100]); spr(22, 16, 5, 4, [110, 200, 140], [60, 150, 100]); }
      else if (kind === 'mature') { spr(16, 10, 8, 6, [170, 230, 150], [110, 190, 120]); spr(10, 14, 6, 4, [255, 214, 110], [226, 176, 80]); spr(22, 14, 6, 4, [255, 214, 110], [226, 176, 80]); }
      ctx.putImageData(img, 0, 0);
    });
  };
  return {
    grassA: tile('grass', 0, 0), grassB: tile('grass', 0, 1), grassC: tile('grass', 0, 2),
    grassD: tile('grass', 0, 3), grassE: tile('grass', 0, 4), grassF: tile('grass', 0, 5),
    path: tile('path'), soil: tile('soil'), soilB: tile('soil', 0, 1),
    water: tile('water', 0, 0), water2: tile('water', 2, 1), water3: tile('water', 4, 2),
    sand: tile('sand'), wetSand: tile('wetSand'), cliff: tile('cliff'), forest: tile('forest'),
    tilled: cropTile('tilled'), seeded: cropTile('seeded'),
    growing: cropTile('growing'), mature: cropTile('mature'),
  };
}

// ══ COLONY PLAZA — seamless colony decking for the town (walkable street) ══
// Cool slate-grey metal plating with teal panel seams, warm underglow, and
// subtle vent slots. Reads unmistakably as "built space" so the town separates
// from the grassy farm — the Harvest-Moon "walk into town" moment.
const COLONY_PLAZA = (() => {
  const S = 32, TAU = Math.PI * 2;
  const P = { lit: [108, 116, 132], base: [74, 82, 100], deep: [48, 56, 72] };
  return createSurface(S, S, (s) => {
    const ctx = s.canvas.getContext('2d');
    const img = ctx.createImageData(S, S), d = img.data;
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const nx = x / S, ny = y / S;
      // edge-symmetric so tiles lock seamlessly (same convention as ground)
      const edge = Math.max(Math.abs(nx - 0.5), Math.abs(ny - 0.5)) * 2;
      const key = 0.46 - 0.08 * edge;
      const f = Math.sin(nx * 2 * TAU + ny) * 0.02 + Math.sin((nx + ny) * 3 * TAU) * 0.012;
      let t = Math.max(0, Math.min(1, key + f));
      // plating micro-grain so metal reads machined, not flat
      const g = Math.sin(x * 13.3 + y * 7.1) * Math.sin(x * 5.9 - y * 11.3);
      t += g * 0.035;
      let r = P.lit[0] + (P.deep[0] - P.lit[0]) * t;
      let g2 = P.lit[1] + (P.deep[1] - P.lit[1]) * t;
      let b = P.lit[2] + (P.deep[2] - P.lit[2]) * t;
      const i = (y * S + x) * 4;
      d[i] = Math.max(0, Math.min(255, r)) | 0;
      d[i + 1] = Math.max(0, Math.min(255, g2)) | 0;
      d[i + 2] = Math.max(0, Math.min(255, b)) | 0;
      d[i + 3] = 255;
    }
    // panel seams: a 2×2 grid of plates, teal-tinted groove lines
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const seamX = (x % 16) === 0 || (x % 16) === 15;
      const seamY = (y % 16) === 0 || (y % 16) === 15;
      if (seamX || seamY) {
        const i = (y * S + x) * 4;
        // recessed groove: darker, with a teal-tinted highlight edge → machined deck
        d[i] = Math.min(255, d[i] * 0.52 + 12);
        d[i + 1] = Math.min(255, d[i + 1] * 0.52 + 34);
        d[i + 2] = Math.min(255, d[i + 2] * 0.52 + 58);
      }
    }
    // teal corner rivets where plates meet (subtle colony signature)
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const atCorner = (x % 16 === 0 && y % 16 === 0) || (x % 16 === 0 && y % 16 === 15) ||
                       (x % 16 === 15 && y % 16 === 0) || (x % 16 === 15 && y % 16 === 15);
      if (atCorner) {
        const i = (y * S + x) * 4;
        d[i] = 96; d[i + 1] = 214; d[i + 2] = 214; // teal rivet
      }
    }
    // warm underglow strip along the lower edge (lamp-lit deck)
    for (let y = 20; y < 28; y++) for (let x = 0; x < S; x++) {
      const i = (y * S + x) * 4;
      const glow = 0.10 * Math.max(0, 1 - Math.abs(y - 24) / 5);
      d[i] = Math.min(255, d[i] + 60 * glow);
      d[i + 1] = Math.min(255, d[i + 1] + 42 * glow);
      d[i + 2] = Math.min(255, d[i + 2] + 20 * glow);
    }
    ctx.putImageData(img, 0, 0);
  });
})();

function applyGroundDepth(src, seed) {
  const rnd = depthRng(seed), W = src.width, H = src.height;
  return createSurface(W, H, (s) => {
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const p = px(src, x, y);
      if (p[3] === 0) continue;
      const n = rnd();
      let [r, g, b] = p;
      const lit = Math.max(0, 1 - (y / H) * 0.62) * (1 - (x / W) * 0.35);
      let f = 0.955 + lit * 0.055 + (n - 0.5) * 0.03;
      if (y >= 8) {
        if (n > 0.96) { f *= 0.84; b *= 0.96; }          // soil clump / puddle
        else if (n < 0.045) f = Math.min(1.14, f + 0.16); // sun glint on tips
      }
      s.rect(x, y, 1, 1, [Math.min(255, r * f) | 0, Math.min(255, g * f) | 0, Math.min(255, b * f) | 0]);
    }
  });
}
// ═══════════════════════════════════════════════════════════
// DECOR — 16x16 grids, scale 1 (fence beam: 16x4 strip)
// ═══════════════════════════════════════════════════════════
const fencePost = mkSprite(`
................
................
......MMMM......
......MmMm......
......mMmM......
......mMmM......
......mMmM......
......mMmM......
......mMmM......
......mMmM......
......mMmM......
......mMmM......
......MmMm......
......MMMM......
....mmmmmmmm....
...mmmmmmmmmm...
`, { M: [170, 170, 196], m: [108, 108, 136] }, 1);

const fenceBeamA = mkSprite(`
................
................
................
................
................
cCcCcCcCcCcCcCcC
CccCccCccCccCccC
CccCccCccCccCccC
cCcCcCcCcCcCcCcC
................
................
................
................
................
................
................
`, { c: [80, 168, 192], C: [134, 242, 242] }, 1);
const fenceBeamB = mkSprite(`
................
................
................
................
................
CccCccCccCccCccC
cCcCcCcCcCcCcCcC
cCcCcCcCcCcCcCcC
CccCccCccCccCccC
................
................
................
................
................
................
................
`, { c: [80, 168, 192], C: [134, 242, 242] }, 1);

const lampPost = mkSprite(`
................
................
.....bBBBBBb....
....bBBBBBBBb...
....bBBBBBBBb...
.....bBBBBBb....
......mmmm......
......mMmM......
......mMmM......
......mMmM......
......mMmM......
......mMmM......
......mMmM......
......mmmm......
.....MMMMMM.....
....MMmmmmMM....
`, { M: [170, 170, 196], m: [116, 116, 144], B: [88, 164, 252], b: [56, 108, 208] }, 1);

// drop shadow under player/NPCs — soft dark ellipse with real per-pixel
// alpha (browser: transparent canvas; headless: TestCtx keeps the alpha)
function makeShadow(w, h, color, alphaBase) {
  const canvas = (typeof document !== 'undefined')
    ? document.createElement('canvas') : makeStub(w, h);
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(w, h);
  const cx = (w - 1) / 2, cy = (h - 1) / 2;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const d = Math.hypot((x - cx) / (w / 2), (y - cy) / (h / 2));
      if (d > 1) continue;
      const a = Math.pow(1 - d, 1.5) * alphaBase;
      const i = (y * w + x) * 4;
      img.data[i] = color[0]; img.data[i + 1] = color[1]; img.data[i + 2] = color[2];
      img.data[i + 3] = Math.round(a * 255);
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}
const SHADOW = makeShadow(18, 9, [8, 12, 24], 0.45);
// wide soft cast shadow for buildings & trees (directional, grounds objects)
const BLD_SHADOW = makeShadow(96, 26, [6, 10, 20], 0.6);

// 16x16 soft glow disc (additive in scene)
function makeGlowDisc(w, h, color, falloff = 0.5) {
  return createSurface(w, h, (s) => {
    const cx = (w - 1) / 2, cy = (h - 1) / 2;
    const rx = w / 2, ry = h / 2;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const d = Math.hypot((x - cx) / rx, (y - cy) / ry);
        if (d > 1) continue;
        const t = Math.pow(1 - d, falloff);
        s.px(x, y, [Math.round(color[0] * t), Math.round(color[1] * t), Math.round(color[2] * t)]);
      }
    }
  });
}
const lampGlow = makeGlowDisc(16, 16, [255, 220, 140]);

// ── Light pools (Task 4: real lighting) ──
// Wide elliptical pools cast on the ground by lamps/doors — additive in scene.
// Warm pool = lamps & tavern door; cool pool = shop/exchange tech light.
function makeLightPool(w, h, color, core = 0.85) {
  return createSurface(w, h, (s) => {
    const cx = (w - 1) / 2, cy = (h - 1) / 2;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const d = Math.hypot((x - cx) / (w / 2), (y - cy) / (h / 2));
        if (d > 1) continue;
        const t = Math.pow(1 - d, 1.8) * core;
        s.px(x, y, [Math.round(color[0] * t), Math.round(color[1] * t), Math.round(color[2] * t)]);
      }
    }
  });
}
const lightPoolWarm = makeLightPool(112, 72, [255, 186, 110]);
const lightPoolCool = makeLightPool(112, 72, [120, 190, 255]);
const lightPoolPlayer = makeLightPool(64, 40, [255, 214, 150], 0.7);

const planterBox = mkSprite(`
.P..C...P..y....
.hP..Ch.h.h.y...
..hh..hh..hh....
..hhhhhh.hh.....
.FFFFFFFFFFFFFF.
.FfffffFffffFfF.
.FfFFffffFFfFFf.
.FFFFFFFFFFFfFF.
................
................
................
................
................
................
................
................
`, { F: [132, 92, 52], f: [166, 122, 70], h: [58, 132, 58], P: [255, 142, 210], C: [142, 244, 244], y: [255, 228, 100] }, 1);

// 13-tall barrels
const barrelWater = mkSprite(`
.....MMMMM......
...MTTTTTTMM....
..MTtCCCCCtMT...
..MTtCCCCCtMT...
..MTtCCCCCtMT...
..MTtttttttMT...
..MTtCCCCCtMT...
..MTtCCCCCtMT...
..MTtCCCCCtMT...
..MTtttttttMT...
..MTtCCCCCtMT...
...MTTTTTTMM....
.....MMMMM......
`, { T: [95, 100, 125], t: [65, 70, 95], C: [120, 235, 235], M: [160, 160, 185] }, 1);
const barrelCargo = mkSprite(`
.....MMMMM......
...MTTTTTTMM....
..MTtRRRRRtMT...
..MTtRRRRRtMT...
..MTtRRRRRtMT...
..MTtttttttMT...
..MTtRRRRRtMT...
..MTtRRRRRtMT...
..MTtRRRRRtMT...
..MTtttttttMT...
..MTtRRRRRtMT...
...MTTTTTTMM....
.....MMMMM......
`, { T: [95, 100, 125], t: [65, 70, 95], R: [225, 85, 65], M: [160, 160, 185] }, 1);

const bush = mkSprite(`
................
.....pppp.......
...pPPPpp.......
..pPpPPPpP......
.pPPpPPPPpC.....
PPpPPPpPPPpP....
.ppPPPpPPPpp....
...ppPPpppp.....
....DpppD.......
.....D.D........
................
................
................
................
................
................
`, { P: [150, 90, 190], p: [105, 60, 150], C: [140, 235, 235], D: [90, 60, 30] }, 1);

// ═══════════════════════════════════════════════════════════
// HERO BUILDING — Player's dome house (64×60 procedural)
// ═══════════════════════════════════════════════════════════
const HOUSE_C = {
  glass: [104, 168, 224],   // dome glass (brighter)
  glassLt: [168, 214, 244], // glass highlight
  glassSh: [64, 108, 168],  // glass shade
  rim: [84, 116, 168],      // dome rim (metal)
  star: [238, 242, 255],    // stars through dome
  roof: [226, 130, 76],     // terracotta (bright warm)
  roofLt: [248, 168, 108],  // roof light
  roofSh: [168, 88, 50],    // roof shade
  eave: [118, 76, 52],      // eave shadow
  wall: [236, 228, 206],    // stucco (cream)
  wallSh: [196, 184, 162],  // stucco shadow
  win: [255, 222, 134],     // window warm
  winLt: [255, 244, 182],   // window bright
  winFr: [128, 92, 62],     // window frame
  doorFr: [96, 64, 44],
  door: [152, 106, 66],
  doorLt: [184, 132, 84],
  plant: [64, 152, 64],
  plantSh: [44, 116, 44],
  blossomP: [255, 150, 206],
  blossomC: [142, 244, 244],
  trim: [200, 200, 220],
  trimSh: [140, 140, 168],
  base: [166, 158, 142],
};

// ══ HABITAT MODULE (home) — a domed living habitat: metal collar, glass dome
//    over a warm lit interior, a glowing airlock door, and a roof beacon. Reads
//    clearly as *a place someone lives* in the Metroid colony language.
function drawHouse() {
  return paintSurface(64, 60, (P) => {
    // soft ground shadow
    P.ell(32, 54, 27, 4, [30, 40, 56], [22, 30, 44]);
    // metal collar base the dome sits in
    P.box(13, 30, 51, 51, 9, [72, 86, 106], [40, 50, 66]);
    // teal seam ring on the collar
    P.ell(32, 40, 24, 2, [70, 200, 200], [40, 140, 160]);
    // glass dome shell (translucent cool) over the living core
    P.ell(32, 24, 24, 21, [52, 118, 138], [22, 60, 82]);
    // warm life-glow inside the lower half of the dome
    P.ell(32, 32, 19, 12, [255, 222, 168], [226, 176, 114]);
    // glass specular sheen (upper-left)
    P.ell(23, 14, 10, 7, [150, 224, 238], [88, 168, 198]);
    // dome rib seams (structure reads as built, not random)
    P.ell(32, 24, 24, 21, [120, 196, 206], [92, 156, 178]);
    // airlock door — round portal, teal outer ring, warm threshold
    P.box(28, 34, 36, 51, 4, [34, 46, 64], [22, 30, 44]);
    P.ell(32, 41, 5.5, 11, [90, 214, 208], [50, 150, 164]);
    P.ell(32, 40, 3, 11, [252, 226, 168], [214, 160, 108]);
    // roof antenna + red-warm beacon light
    P.ell(32, 3, 2, 3, [120, 140, 160], [80, 100, 120]);
    P.ell(32, 1, 1.6, 1.6, [255, 150, 92], [220, 100, 60]);
  });
}
const houseSprite = drawHouse();


// houseGlow — additive window light spill (matches window positions)
const houseGlowSprite = createSurface(64, 44, (s) => {
  const g = [255, 190, 100];
  // upper windows (relative y 4..9)
  [19, 29, 39].forEach(wx => { s.rect(wx - 2, 4, 10, 6, [Math.round(g[0] * 0.75), Math.round(g[1] * 0.6), Math.round(g[2] * 0.35)]); });
  // lower windows + door (relative y 18..24)
  [19, 39].forEach(wx => { s.rect(wx - 2, 18, 10, 6, [Math.round(g[0] * 0.6), Math.round(g[1] * 0.45), Math.round(g[2] * 0.25)]); });
  s.rect(27, 18, 10, 8, [Math.round(g[0] * 0.5), Math.round(g[1] * 0.38), Math.round(g[2] * 0.2)]);
});

// ═══════════════════════════════════════════════════════════
// FUTURE BUILDINGS — 32×32 painterly (smooth-shaded, clean legible forms)
// ═══════════════════════════════════════════════════════════
function paintSurface(W, H, draw) {
  return createSurface(W, H, (s) => {
    const ctx = s.canvas.getContext('2d');
    const img = ctx.createImageData(W, H), d = img.data;
    const blend = (i, c, a) => { const da = d[i + 3] / 255, oa = a + da * (1 - a); if (oa <= 0) return; let r, g, b;
      if (da <= 0) { r = c[0]; g = c[1]; b = c[2]; } else { r = (c[0] * a + d[i] * da * (1 - a)) / oa; g = (c[1] * a + d[i + 1] * da * (1 - a)) / oa; b = (c[2] * a + d[i + 2] * da * (1 - a)) / oa; }
      d[i] = r | 0; d[i + 1] = g | 0; d[i + 2] = b | 0; d[i + 3] = oa * 255 | 0; };
    const sdfEll = (x, y, cx, cy, rx, ry) => { const dx = (x - cx) / rx, dy = (y - cy) / ry; return (Math.sqrt(dx * dx + dy * dy) - 1) * Math.min(rx, ry); };
    const sdfRound = (x, y, x0, y0, x1, y1, r) => { const cx = Math.max(x0, Math.min(x, x1)), cy = Math.max(y0, Math.min(y, y1)); const dx = x - cx, dy = y - cy; return Math.sqrt(dx * dx + dy * dy) - r; };
    const ell = (cx, cy, rx, ry, top, deep) => { for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const a = Math.max(0, Math.min(1, 0.5 - sdfEll(x, y, cx, cy, rx, ry))); if (a > 0) { const t = Math.max(0, Math.min(1, (y - (cy - ry)) / (2 * ry))); const col = t > 0.5 ? [top[0] + (deep[0] - top[0]) * (t - 0.5) / 0.5, top[1] + (deep[1] - top[1]) * (t - 0.5) / 0.5, top[2] + (deep[2] - top[2]) * (t - 0.5) / 0.5] : top; blend((y * W + x) * 4, col, a); } } };
    const box = (x0, y0, x1, y1, r, top, deep) => { for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const a = Math.max(0, Math.min(1, 0.5 - sdfRound(x, y, x0, y0, x1, y1, r))); if (a > 0) { const t = Math.max(0, Math.min(1, (y - y0) / (y1 - y0))); const col = t > 0.5 ? [top[0] + (deep[0] - top[0]) * (t - 0.5) / 0.5, top[1] + (deep[1] - top[1]) * (t - 0.5) / 0.5, top[2] + (deep[2] - top[2]) * (t - 0.5) / 0.5] : top; blend((y * W + x) * 4, col, a); } } };
    draw({ blend, ell, box, d, W, H });
    ctx.putImageData(img, 0, 0);
  });
}
const makePaint32 = (draw) => paintSurface(32, 32, draw);
// scale a smooth-shaded sprite up 2× (bilinear) so small buildings match the
// hero house's 64px size — keeps the colony's structures the same visual scale
function scale2x(cv) {
  return createSurface(cv.width * 2, cv.height * 2, (s) => {
    const ctx = s.canvas.getContext('2d');
    if (typeof ctx.drawImage === 'function') {
      // browser: smooth bilinear 2×
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(cv, 0, 0, cv.width, cv.height, 0, 0, cv.width * 2, cv.height * 2);
    } else {
      // headless stub (tests): nearest-neighbour pixel scale, preserving alpha
      for (let y = 0; y < cv.height; y++) for (let x = 0; x < cv.width; x++) {
        const p = px(cv, x, y);
        if (p[3] === 0) continue; // leave transparent (avoids opaque black backdrop)
        for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++)
          s.rect(x * 2 + dx, y * 2 + dy, 1, 1, [p[0], p[1], p[2]]);
      }
    }
  });
}

// Supply Depot (shop) — slate colony kiosk: holo sign, glass display bay,
// rooftop antenna + panel seams so it reads as *built space*.
const shopSprite = scale2x(makePaint32((P) => {
  // dark slate kiosk hull with a glowing holo sign and a glass display bay
  P.box(4, 8, 28, 30, 6, [44, 56, 74], [26, 34, 50]);            // hull
  P.box(3, 3, 29, 8, 1, [30, 38, 54], [22, 30, 44]);            // sign housing
  P.ell(16, 5, 12, 2, [120, 240, 232], [52, 158, 170]);          // teal holo sign (brighter)
  P.box(6, 11, 26, 20, 3, [20, 28, 44], [14, 20, 34]);          // glass display bay
  P.ell(16, 15, 9, 4, [120, 202, 212], [60, 132, 162]);         // bay teal glow
  // QA 0904 2.5 — the lit-window RULE: a warm window means "open for business".
  // These used to be painted BEFORE the display bay, which is drawn over them,
  // so the shop shipped with ZERO warm window pixels — the one building that
  // should always read 'open' read as dark. They now sit ON TOP of the bay
  // glass, where lamps-behind-display-glass actually belongs.
  P.ell(8, 13, 1.8, 2.3, [255, 224, 160], [220, 168, 108]);    // warm window (left)
  P.ell(24, 13, 1.8, 2.3, [255, 228, 170], [214, 182, 132]);   // warm window (right)
  P.ell(10, 15, 1.5, 1.5, [255, 218, 158], [220, 168, 110]);   // warm goods glint
  P.ell(21, 15, 1.5, 1.5, [255, 226, 180], [210, 180, 130]);
  P.box(13, 21, 19, 30, 3, [30, 42, 60], [20, 30, 44]);         // portal door
  P.ell(16, 25, 3, 4, [100, 224, 220], [60, 160, 170]);         // door glow
  P.box(3, 30, 29, 32, 1, [60, 72, 90], [40, 52, 68]);          // base plate
  // rooftop antenna mast + teal beacon (colony signature) — QA 2.4: the beacon
  // used to float on a bare stalk; it now sits in a mount collar with a strut
  P.box(21, 1, 23, 4, 1, [110, 124, 148], [70, 82, 104]);        // mast
  P.box(20, 4, 24, 5, 1, [86, 98, 120], [56, 68, 90]);           // mount ring
  P.box(23, 3, 26, 4, 0.5, [96, 108, 130], [64, 76, 98]);        // guy strut
  P.ell(22, 1.6, 1.4, 1.4, [255, 200, 110], [226, 160, 80]);    // warm beacon
  // vertical panel seams on the hull (machined, not flat paint)
  P.box(10, 12, 11, 28, 1, [36, 46, 62], [24, 32, 46]);
  P.box(21, 12, 22, 28, 1, [36, 46, 62], [24, 32, 46]);
  // side vent slots (cool teal)
  P.box(6, 9, 8, 10, 1, [56, 68, 86], [40, 50, 66]);
  P.box(24, 9, 26, 10, 1, [56, 68, 86], [40, 50, 66]);
}));
const shopGlow = createSurface(32, 24, (s) => {
  const y = [255, 200, 110];
  // QA 0904 2.5: the ADD-blend halo must land exactly on the lit windows, not
  // on a generic band — the halo IS the window-light rule read from far away.
  // Rects below mirror the two warm windows at (8,13) and (24,13) in the hull.
  s.rect(5, 10, 6, 6, [Math.round(y[0] * 0.5), Math.round(y[1] * 0.38), Math.round(y[2] * 0.18)]);
  s.rect(21, 10, 6, 6, [Math.round(y[0] * 0.5), Math.round(y[1] * 0.38), Math.round(y[2] * 0.18)]);
  // holo sign band keeps a faint cool wash (it glows on its own texture)
  s.rect(7, 4, 18, 3, [Math.round(y[0] * 0.3), Math.round(y[1] * 0.3), Math.round(y[2] * 0.22)]);
});

// Round Trading Post (Exchange) — a cozy kiosk pod with a glowing orb window
function drawExchange(s, frame) {
  // Trading Pylon — a tall beacon tower for the Grand Exchange: glowing trade
  // orb, pulsing holo ring, roof beacon. Clearly *the exchange* of the colony.
  const W = 32, H = 32;
  const ctx = s.canvas.getContext('2d');
  const img = ctx.createImageData(W, H), d = img.data;
  const blend = (i, c, a) => { const da = d[i + 3] / 255, oa = a + da * (1 - a); if (oa <= 0) return; let r, g, b; if (da <= 0) { r = c[0]; g = c[1]; b = c[2]; } else { r = (c[0] * a + d[i] * da * (1 - a)) / oa; g = (c[1] * a + d[i + 1] * da * (1 - a)) / oa; b = (c[2] * a + d[i + 2] * da * (1 - a)) / oa; } d[i] = r | 0; d[i + 1] = g | 0; d[i + 2] = b | 0; d[i + 3] = oa * 255 | 0; };
  const sdfEll = (x, y, cx, cy, rx, ry) => { const dx = (x - cx) / rx, dy = (y - cy) / ry; return (Math.sqrt(dx * dx + dy * dy) - 1) * Math.min(rx, ry); };
  const ell = (cx, cy, rx, ry, top, deep) => { for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const a = Math.max(0, Math.min(1, 0.5 - sdfEll(x, y, cx, cy, rx, ry))); if (a > 0) { const t = Math.max(0, Math.min(1, (y - (cy - ry)) / (2 * ry))); const col = t > 0.5 ? [top[0] + (deep[0] - top[0]) * (t - 0.5) / 0.5, top[1] + (deep[1] - top[1]) * (t - 0.5) / 0.5, top[2] + (deep[2] - top[2]) * (t - 0.5) / 0.5] : top; blend((y * W + x) * 4, col, a); } } };
  ell(16, 30, 13, 3, [66, 78, 96], [44, 56, 72]);               // base ring
  ell(16, 22, 10, 6, [54, 66, 88], [34, 44, 60]);                // tier hood
  ell(16, 20, 7, 5, [104, 228, 222], [52, 158, 170]);           // glowing trade orb
  ell(16, 19, (frame === 0 ? 4 : 3), 3.2, [235, 246, 250], [150, 220, 228]);  // orb pulse
  ell(16, 9, 3, 4, [120, 140, 160], [80, 100, 120]);            // beacon mast
  ell(16, 7, 1.7, 1.7, [255, 178, 96], [224, 120, 54]);         // warm beacon
  // side fins + panel seams (built-tech tower, not a smooth blob)
  ell(8, 24, 2.5, 5, [74, 88, 112], [50, 62, 84]);              // left fin
  ell(24, 24, 2.5, 5, [74, 88, 112], [50, 62, 84]);             // right fin
  ell(16, 26, 3, 1.6, [40, 52, 68], [28, 38, 52]);              // base seam
  ctx.putImageData(img, 0, 0);
}
const exchangeA = scale2x(createSurface(32, 32, (s) => drawExchange(s, 0)));
const exchangeB = scale2x(createSurface(32, 32, (s) => drawExchange(s, 1)));
const exchangeGlow = createSurface(32, 24, (s) => {
  const bl = [95, 165, 255];
  s.rect(9, 6, 12, 10, [Math.round(bl[0] * 0.4), Math.round(bl[1] * 0.32), Math.round(bl[2] * 0.2)]);
});

// Tavern Pod — a cozy mushroom-capped cantina with round warm windows
function drawTavern(s, frame) {
  // Colony Cantina — a glass-front lounge module: warm lit interior, glowing
  // awning, luminous sign. Clearly the place to drink, rest, and gossip.
  const W = 32, H = 32;
  const ctx = s.canvas.getContext('2d');
  const img = ctx.createImageData(W, H), d = img.data;
  const blend = (i, c, a) => { const da = d[i + 3] / 255, oa = a + da * (1 - a); if (oa <= 0) return; let r, g, b; if (da <= 0) { r = c[0]; g = c[1]; b = c[2]; } else { r = (c[0] * a + d[i] * da * (1 - a)) / oa; g = (c[1] * a + d[i + 1] * da * (1 - a)) / oa; b = (c[2] * a + d[i + 2] * da * (1 - a)) / oa; } d[i] = r | 0; d[i + 1] = g | 0; d[i + 2] = b | 0; d[i + 3] = oa * 255 | 0; };
  const sdfRound = (x, y, x0, y0, x1, y1, r) => { const cx = Math.max(x0, Math.min(x, x1)), cy = Math.max(y0, Math.min(y, y1)); const dx = x - cx, dy = y - cy; return Math.sqrt(dx * dx + dy * dy) - r; };
  const sdfEll = (x, y, cx, cy, rx, ry) => { const dx = (x - cx) / rx, dy = (y - cy) / ry; return (Math.sqrt(dx * dx + dy * dy) - 1) * Math.min(rx, ry); };
  const box = (x0, y0, x1, y1, r, top, deep) => { for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const a = Math.max(0, Math.min(1, 0.5 - sdfRound(x, y, x0, y0, x1, y1, r))); if (a > 0) { const t = Math.max(0, Math.min(1, (y - y0) / (y1 - y0))); const col = t > 0.5 ? [top[0] + (deep[0] - top[0]) * (t - 0.5) / 0.5, top[1] + (deep[1] - top[1]) * (t - 0.5) / 0.5, top[2] + (deep[2] - top[2]) * (t - 0.5) / 0.5] : top; blend((y * W + x) * 4, col, a); } } };
  const ell = (cx, cy, rx, ry, top, deep) => { for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const a = Math.max(0, Math.min(1, 0.5 - sdfEll(x, y, cx, cy, rx, ry))); if (a > 0) { const t = Math.max(0, Math.min(1, (y - (cy - ry)) / (2 * ry))); const col = t > 0.5 ? [top[0] + (deep[0] - top[0]) * (t - 0.5) / 0.5, top[1] + (deep[1] - top[1]) * (t - 0.5) / 0.5, top[2] + (deep[2] - top[2]) * (t - 0.5) / 0.5] : top; blend((y * W + x) * 4, col, a); } } };
  ell(16, 30, 12, 3, [40, 50, 66], [30, 38, 52]);               // ground shadow
  box(4, 8, 28, 29, 7, [52, 64, 84], [32, 42, 60]);             // slate hull (dominant mass)
  // Glass-front lounge, built the way glass actually reads at dusk: a DARK teal
  // pane with a few BRIGHT light cores behind it — not a solid amber rectangle.
  // QA 0904 round 1 replaced the rust slab with a filled amber box, which still
  // photographed as a brown timber hut: the warm mass covered ~18% of the sprite
  // with no glass or frame over it. Warmth must arrive as EMISSION, small and
  // bright, over cool glass — so the building stays slate-dominant and the
  // warmth reads as "lit from inside", which is the whole point of a cantina.
  box(8, 13, 24, 24, 5, [26, 46, 62], [14, 30, 44]);             // recessed dark glass pane
  ell(11, 20, 2.1, 2.6, [255, 228, 168], [228, 172, 96]);          // lamp core seen through glass
  ell(21, 20, 2.1, 2.6, [255, 236, 186], [222, 186, 128]);       // lamp core b
  box(9, 22, 23, 23, 0, [120, 232, 226], [56, 158, 168]);         // bar counter gleam (teal line)
  box(15, 13, 16, 24, 0, [46, 58, 78], [30, 40, 56]);             // mullion post (frame, not fill)
  box(8, 17, 24, 18, 0, [46, 58, 78], [30, 40, 56]);             // mullion rail
  box(7, 24, 25, 25, 0, [70, 84, 104], [44, 56, 74]);            // sill (slate)
  box(7, 12, 25, 13, 0, [70, 84, 104], [44, 56, 74]);            // head (slate)
  // glowing sign over the entrance
  box(10, 4, 22, 7, 2, [30, 38, 54], [22, 30, 44]);
  ell(16, 5, 5, 1.6, [255, 168, 122], [232, 110, 78]);          // warm 'OPEN' neon glow
  ell(16, 8, 11, 2.4, [84, 150, 168], [52, 96, 114]);           // awning
  // awning scallop dots (reads as fabric canopy, not flat band)
  ell(12, 9, 0.9, 0.9, [60, 120, 136], [40, 90, 104]);
  ell(19, 9, 0.9, 0.9, [60, 120, 136], [40, 90, 104]);
  // rooftop exhaust vent (colony machinery detail)
  box(24, 11, 26, 13, 1, [90, 100, 120], [60, 70, 88]);
  // QA 0904 2.4: the cantina's roof beacon floated on nothing at all — it now
  // rises from a mast + mount collar like every other building's.
  box(21, 6, 23, 11, 1, [110, 124, 148], [70, 82, 104]);   // beacon mast
  box(20, 10, 24, 11, 0.5, [86, 98, 120], [56, 68, 90]);    // mount collar
  ell(22, 6.4, 1.4, 1.4, [255, 200, 110], [226, 160, 80]);  // warm beacon
  // side panel seam
  box(6, 20, 7, 26, 1, [42, 52, 68], [30, 38, 52]);
  box(14, 21, 18, 29, 3, [38, 50, 68], [26, 36, 50]);           // door
  ell(16, 25, 3.2, 4, [234, 198, 150], [188, 150, 98]);         // warm door glow
  ctx.putImageData(img, 0, 0);
}
const tavernA = scale2x(createSurface(32, 32, (s) => drawTavern(s, 0)));
const tavernB = scale2x(createSurface(32, 32, (s) => drawTavern(s, 1)));
const tavernC = scale2x(createSurface(32, 32, (s) => drawTavern(s, 2)));
const tavernGlow = createSurface(32, 24, (s) => {
  const w = [255, 192, 102];
  [8, 21].forEach(wx => s.rect(wx - 1, 6, 7, 4, [Math.round(w[0] * 0.45), Math.round(w[1] * 0.34), Math.round(w[2] * 0.16)]));
  s.rect(13, 12, 6, 10, [Math.round(w[0] * 0.35), Math.round(w[1] * 0.26), Math.round(w[2] * 0.12)]);
});

// ═══════════════════════════════════════════════════════════


// ═══════════════════════════════════════════════════════════


// ═══════════════════════════════════════════════════════════
// ATMOSPHERE — planet + nebula
// ═══════════════════════════════════════════════════════════
const planetSprite = createSurface(48, 48, (s) => {
  const O = [232, 132, 82], o = [192, 96, 60], Y = [255, 212, 142];
  const M = [172, 172, 198], m = [112, 112, 142];
  // sphere: horizontal bands with alternating tones
  for (let y = 0; y < 40; y++) {
    const dy = y - 20;
    const half = Math.round(Math.sqrt(Math.max(0, 400 - dy * dy)) * 0.92);
    if (half <= 0) continue;
    const x0 = 24 - half;
    const band = Math.floor(y / 4) % 2 === 0;
    s.rect(x0, y, half * 2, 1, band ? O : o);
    // highlight (light from top-left)
    s.rect(x0, y, Math.max(1, Math.round(half * 0.3)), 1, band ? Y : O);
    // shade (right side)
    s.rect(x0 + Math.round(half * 0.75), y, Math.max(1, Math.round(half * 0.3)), 1, [120, 60, 40]);
  }
  // ring
  s.hline(4, 44, 41, m); s.hline(6, 42, 42, M); s.hline(8, 40, 43, m);
});

// ══ LIVING SKY — sun / moon / cloud (backdrop life) ‖ 48×48, 48×48, 64×40
const sunSprite = createSurface(48, 48, (s) => {
  const cx = 24, cy = 24, R = 15;
  // warm halo
  for (let y = 0; y < 48; y++) {
    const dy = y - cy;
    for (let x = 0; x < 48; x++) {
      const d = Math.hypot(x - cx, dy);
      if (d >= R && d < R + 6) s.px(x, y, [255, Math.round(215 + (R + 6 - d) * 6), 150]);
    }
  }
  // bright core with highlight + rim shade
  for (let y = 0; y < 48; y++) {
    const dy = y - cy, half = Math.round(Math.sqrt(Math.max(0, R * R - dy * dy)));
    if (half <= 0) continue;
    const x0 = cx - half;
    s.rect(x0, y, half * 2, 1, [255, 240, 150]);
    s.rect(x0, y, Math.max(1, Math.round(half * 0.4)), 1, [255, 252, 200]);
    s.rect(x0 + Math.round(half * 0.7), y, Math.max(1, Math.round(half * 0.3)), 1, [255, 180, 80]);
  }
});

const moonSprite = createSurface(48, 48, (s) => {
  const cx = 24, cy = 24, R = 14;
  for (let y = 0; y < 48; y++) {
    const dy = y - cy, half = Math.round(Math.sqrt(Math.max(0, R * R - dy * dy)));
    if (half <= 0) continue;
    const x0 = cx - half;
    s.rect(x0, y, half * 2, 1, [230, 234, 245]);
    s.rect(x0, y, Math.max(1, Math.round(half * 0.35)), 1, [250, 250, 255]);
    s.rect(x0 + Math.round(half * 0.65), y, Math.max(1, Math.round(half * 0.35)), 1, [190, 196, 214]);
  }
  const craters = [[12, 12, 3], [30, 26, 4], [24, 14, 2], [16, 30, 2]];
  for (const [ox, oy, r] of craters) {
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (Math.hypot(dx, dy) <= r) s.px(cx + ox + dx, cy + oy + dy, [178, 184, 204]);
    }
  }
});

const cloudSprite = createSurface(64, 40, (s) => {
  const puffs = [[20, 20, 11], [33, 15, 13], [45, 20, 10], [28, 26, 9], [38, 27, 7]];
  for (const [ox, oy, r] of puffs) {
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      const d = Math.hypot(dx, dy);
      if (d <= r) s.px(ox + dx, oy + dy, d < r * 0.8 ? [255, 255, 255] : [226, 232, 244]);
    }
  }
});

// Ship starfield porthole — metal-ring window with a drifting deep-space view
const portholeSprite = createSurface(48, 32, (s) => {
  const cx = 23, cy = 16, R = 13;
  let seed = 99;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  // window interior (deep-space gradient + sparse stars)
  for (let y = 0; y < 32; y++) for (let x = 0; x < 48; x++) {
    const d = Math.hypot(x - cx, y - cy);
    if (d <= R) {
      const b = Math.min(1, d / R);
      const star = rnd() < 0.035 ? 90 + Math.floor(rnd() * 130) : 0;
      s.px(x, y, [(16 + b * 42 + star) | 0, (18 + b * 46 + star) | 0, (40 + b * 62 + star) | 0]);
    }
  }
  // metal hull ring
  for (let y = 0; y < 32; y++) for (let x = 0; x < 48; x++) {
    const d = Math.hypot(x - cx, y - cy);
    if (d <= R + 9 && d >= R + 3) s.px(x, y, [120, 130, 150]);
    if (d <= R + 10 && d >= R + 8) s.px(x, y, [80, 88, 108]);
    if (d <= R + 9 && d >= R + 7 && (x < cx || y < cy)) s.px(x, y, [196, 204, 224]);
  }
  // glass glints + distant asteroid
  s.rect(cx - 6, cy - 8, 4, 1, [228, 240, 255]);
  s.rect(cx + 3, cy - 6, 4, 1, [190, 210, 235]);
  s.rect(cx + 4, cy + 2, 2, 1, [160, 128, 96]); s.rect(cx + 4, cy + 3, 2, 1, [120, 96, 70]);
});

// Asteroid B-612 — the farm's homeworld, used in the intro title card
const asteroidSprite = createSurface(48, 40, (s) => {
  const rx = 24, ry = 19, R = 18, Ry = 15;
  for (let y = 0; y < 40; y++) for (let x = 0; x < 48; x++) {
    const d = Math.hypot((x - rx) / R, (y - ry) / Ry);
    if (d <= 1) {
      const lit = (x - rx) < -R * 0.1 && (y - ry) < 0;
      s.px(x, y, lit ? [186, 162, 130] : [152, 130, 100]);
      if (d > 0.88) s.px(x, y, [128, 108, 82]);
    }
  }
  const craters = [[12, 17, 3], [30, 13, 2], [21, 27, 2], [34, 24, 2]];
  for (const [ox, oy, r] of craters) {
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      const d = Math.hypot(dx, dy);
      if (d <= r) { s.px(rx + ox + dx, ry + oy + dy, [112, 92, 70]); if (d > r * 0.7) s.px(rx + ox + dx, ry + oy + dy, [196, 176, 146]); }
    }
  }
});

// CRT scanlines — subtle dark horizontal rows for a 2000s TV feel
function makeScanlines(w = 8, h = 64) {
  return createSurface(w, h, (s) => {
    const ctx = s.canvas.getContext('2d');
    const img = ctx.createImageData(w, h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (y % 3 === 0) { img.data[i] = 0; img.data[i + 1] = 0; img.data[i + 2] = 0; img.data[i + 3] = 78; }
    }
    ctx.putImageData(img, 0, 0);
  });
}
// Soft radial vignette — darkens the corners of the viewport for cinematic
// depth. Transparent center → deep edges. Alpha-capable (ImageData), works
// headless like makeNebula.
function makeVignette(size = 256, edge = 70) {
  return createSurface(size, size, (s) => {
    const ctx = s.canvas.getContext('2d');
    const img = ctx.createImageData(size, size);
    const cx = size / 2, cy = size / 2;
    const R = size * 0.5;
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const d = Math.hypot(x - cx, y - cy) / R;          // 0 center → 1 corner
      const a = Math.min(1, Math.pow(Math.max(0, d - 0.62) / 0.7, 1.6));
      const i = (y * size + x) * 4;
      img.data[i] = 2; img.data[i + 1] = 4; img.data[i + 2] = 14;
      img.data[i + 3] = Math.round(a * edge);
    }
    ctx.putImageData(img, 0, 0);
  });
}

// ══ PAINTERLY DUSK SKY — tall smooth gradient with a warm glowing horizon ══
// Deep indigo-violet heavens falling to a golden hour-glowing horizon. Soft
// vertical drift bands for sky texture. Used as a parallax backdrop under the
// colony so the world reads cinematic instead of flat.
function makeSky(size = 320, height = 512) {
  // READABLE COLONY DUSK — a bright, painterly sky so the world reads clearly:
  // soft periwinkle-blue overhead melting into a warm amber-cream horizon. It
  // separates from the ground and lets building silhouettes pop. Stars fade
  // up high so the day never turns into a monochrome blue soup.
  return createSurface(size, height, (s) => {
    const ctx = s.canvas.getContext('2d');
    const img = ctx.createImageData(size, height);
    let seed = 90210;
    const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
    for (let y = 0; y < height; y++) {
      const t = y / (height - 1);
      // soft periwinkle top -> warm cream horizon
      const r = 96 + t * 150, g = 132 + t * 92, b = 172 + t * 30;
      for (let x = 0; x < size; x++) {
        const drift = Math.sin(x * 0.012 + t * 10) * 7 + (rnd() - 0.5) * 9;
        let rr = Math.max(0, Math.min(255, r + drift));
        let gg = Math.max(0, Math.min(255, g + drift * 0.8));
        let bb = Math.max(0, Math.min(255, b + drift * 0.6));
        // gentle stars only in the upper heavens
        let st = 0;
        if (t < 0.35 && rnd() < 0.05) st = 150 + Math.floor(rnd() * 60);
        const i = (y * size + x) * 4;
        img.data[i] = Math.min(255, rr + st) | 0;
        img.data[i + 1] = Math.min(255, gg + st * 0.7) | 0;
        img.data[i + 2] = Math.min(255, bb + st * 0.4) | 0;
        img.data[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
  });
}

// ══ ATMOSPHERIC HAZE — soft drifting ground-fog for depth (dusk mist) ══
function makeFog(size = 320, height = 96) {
  return createSurface(size, height, (s) => {
    const ctx = s.canvas.getContext('2d');
    const img = ctx.createImageData(size, height);
    let seed = 777;
    const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
    for (let y = 0; y < height; y++) {
      const t = y / (height - 1);
      const baseA = 0.35 * (1 - Math.pow(Math.abs(t - 0.25) * 1.9, 2)); // densest ~1/4 up
      for (let x = 0; x < size; x++) {
        const puff = Math.sin(x * 0.012 + t * 6) * 0.08 + (rnd() - 0.5) * 0.05;
        const a = Math.max(0, Math.min(1, baseA + puff));
        // warm mist tint
        const i = (y * size + x) * 4;
        img.data[i] = 232; img.data[i + 1] = 196; img.data[i + 2] = 168;
        img.data[i + 3] = Math.round(a * 220);
      }
    }
    ctx.putImageData(img, 0, 0);
  });
}

// ══ METEOR STREAK — bright bioluminescent trail for the deep-space sky ══
function makeMeteor(w = 26, h = 6) {
  return createSurface(w, h, (s) => {
    const ctx = s.canvas.getContext('2d');
    const img = ctx.createImageData(w, h), d = img.data;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const t = x / (w - 1);                       // head (x=0) -> tail
      const glow = Math.pow(1 - t, 1.7) * 255;      // brightest at head
      const a = glow / 255 * (1 - Math.abs((y - (h - 1) / 2) / ((h - 1) / 2 + 1)));
      const i = (y * w + x) * 4;
      d[i] = 220; d[i + 1] = 250; d[i + 2] = 255; d[i + 3] = Math.round(a * 200) | 0;
    }
    ctx.putImageData(img, 0, 0);
  });
}

// ══ ALIEN FLORA — a little glowing bioluminescent plant for colony decor ══
function makeFlora() {
  return createSurface(24, 26, (s) => {
    const ctx = s.canvas.getContext('2d');
    const img = ctx.createImageData(24, 26), d = img.data;
    const blend = (x, y, c, a) => { if (x < 0 || y < 0 || x >= 24 || y >= 26) return; const i = (y * 24 + x) * 4; const da = d[i + 3] / 255, oa = a + da * (1 - a); if (oa <= 0) return; let r, g, b; if (da <= 0) { r = c[0]; g = c[1]; b = c[2]; } else { r = (c[0] * a + d[i] * da * (1 - a)) / oa; g = (c[1] * a + d[i + 1] * da * (1 - a)) / oa; b = (c[2] * a + d[i + 2] * da * (1 - a)) / oa; } d[i] = r | 0; d[i + 1] = g | 0; d[i + 2] = b | 0; d[i + 3] = oa * 255 | 0; };
    // stem
    for (let y = 6; y < 22; y++) blend(12, y, [70, 170, 160], 0.9);
    // fronds (glowing teal leaves) fanning up
    const fr = [[12, 6, 5, 10], [7, 8, 5, 9], [17, 8, 5, 9], [10, 3, 5, 6], [15, 4, 5, 6]];
    for (const [cx, cy, rx, ry] of fr) for (let y = 0; y < 26; y++) for (let x = 0; x < 24; x++) {
      const dx = (x - cx) / rx, dy = (y - cy) / ry;
      const dist = (Math.sqrt(dx * dx + dy * dy) - 1) * Math.min(rx, ry);
      const a = Math.max(0, Math.min(1, 0.5 - dist));
      if (a > 0) blend(x, y, [90, 220, 200], a * 0.95);
    }
    // glowing tip
    blend(12, 1, [160, 255, 235], 1);
    ctx.putImageData(img, 0, 0);
  });
}

// Tileable nebula backdrop 256×256 — layered color clouds + star specks
function makeNebula(size = 256) {
const blobs = [
    { x: 60, y: 80, r: 95, c: [120, 130, 150] },    // soft slate-teal
    { x: 190, y: 150, r: 115, c: [150, 120, 150] }, // dusty lavender
    { x: 140, y: 40, r: 72, c: [200, 140, 110] },   // warm peach
    { x: 40, y: 200, r: 82, c: [110, 140, 150] },   // soft teal
    { x: 220, y: 40, r: 60, c: [190, 165, 130] },   // warm sand
    { x: 230, y: 215, r: 70, c: [210, 165, 130] },  // warm rose-gold
    { x: 120, y: 170, r: 55, c: [120, 160, 170] },  // aqua underglow
    { x: 90, y: 130, r: 40, c: [160, 135, 180] },   // core lavender bump
  ];
  // deterministic star field (seeded — identical in browser/headless)
  let seed = 987654321;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const stars = [];
  for (let i = 0; i < 90; i++) {
    const bright = rnd() < 0.18;
    stars.push({ x: Math.floor(rnd() * size), y: Math.floor(rnd() * size), b: bright });
  }
  const fill = (x, y) => {
    let r = 14 + y * 0.03, g = 12 + y * 0.025, b = 26 + y * 0.04;
    for (const bl of blobs) {
      const d = Math.hypot(x - bl.x, y - bl.y);
      if (d < bl.r) { const t = Math.pow(1 - d / bl.r, 1.35) * 0.55; r += bl.c[0] * t; g += bl.c[1] * t; b += bl.c[2] * t; }
    }
    return [r, g, b];
  };
  return createSurface(size, size, (s) => {
    const isBrowser = typeof document !== 'undefined' && !!document.createElement;
    const ctx = s.canvas.getContext('2d');
    const img = ctx.createImageData(size, size);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const [r, g, b] = fill(x, y);
      const i = (y * size + x) * 4;
      img.data[i] = r; img.data[i + 1] = g; img.data[i + 2] = b; img.data[i + 3] = 255;
    }
    // star specks (additive)
    for (const st of stars) {
      const base = st.b ? 235 : 150;
      const i = (st.y * size + st.x) * 4;
      img.data[i] = Math.min(255, img.data[i] + base);
      img.data[i + 1] = Math.min(255, img.data[i + 1] + base);
      img.data[i + 2] = Math.min(255, img.data[i + 2] + base + 30);
      if (st.b) { // bright stars get a soft cross
        const jx = (st.y * size + st.x + 1) * 4, jx2 = (st.y * size + st.x - 1) * 4;
        const jy = (((st.y + 1) % size) * size + st.x) * 4, jy2 = (((st.y - 1 + size) % size) * size + st.x) * 4;
        for (const j of [jx, jx2, jy, jy2]) {
          img.data[j] = Math.min(255, img.data[j] + 70);
          img.data[j + 1] = Math.min(255, img.data[j + 1] + 70);
          img.data[j + 2] = Math.min(255, img.data[j + 2] + 90);
        }
      }
    }
    if (isBrowser) ctx.putImageData(img, 0, 0);
    else ctx.putImageData(img, 0, 0); // TestCtx stores data either way
  });
}

// ═══════════════════════════════════════════════════════════
// PLAYER + NPC — 32×32 procedural, walk animation
//   player: orange suit, cyan visor, tan skin — 3 walk frames × 4 dirs
//   npc:    color-coded villagers from NPC_DATA — 3-frame idle bob
// ═══════════════════════════════════════════════════════════
function shade(c, f) {
  return [Math.round(c[0] * f), Math.round(c[1] * f), Math.round(c[2] * f)];
}
function tint(c, a) {
  return [Math.round(c[0] + (255 - c[0]) * a), Math.round(c[1] + (255 - c[1]) * a), Math.round(c[2] + (255 - c[2]) * a)];
}
const hexRGB = (h) => [(h >> 16) & 255, (h >> 8) & 255, h & 255];

// dir: 'front' | 'back' | 'left' | 'right' | 'idle'
// frame: 0 = standing, 1/2 = walk legs
// ── Painterly-cozy character via soft-edge rasterization ──
// Draws smooth antialiased ellipsoid forms with gradient shading into an
// ImageData buffer (works headless AND in-browser — no canvas path APIs).
// Shapes use signed-distance coverage with a ~1px feather, so edges read as
// soft illustrated forms instead of hard pixel cells.
function drawVillager(s, dir, frame, C, look) {
  const W = s.canvas.width, H = s.canvas.height;   // 64 x 80
  const ctx = s.canvas.getContext('2d');
  const img = ctx.createImageData(W, H);
  const d = img.data;
  const human = !!(look && look.human);
  const bob = frame === 1 ? -1 : 0;                 // subtle step bob
  // ── view + gait (QA 0904 Stage 4) — `dir` used to be passed in and then
  // IGNORED: every direction drew the same front-facing face, and the 3 walk
  // frames differed only by a 1px bob, so the cast glided on skating shoes.
  const view = (dir === 'back' || dir === 'left' || dir === 'right') ? dir : 'front';
  const side = dir === 'left' ? -1 : dir === 'right' ? 1 : 0;
  const backView = view === 'back';
  const sideView = view === 'left' || view === 'right';
  const gait = dir === 'idle' ? 0 : frame;          // 0 stance, 1 left fwd, 2 right fwd
  const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  const shade = (c, k) => [c[0] * k | 0, c[1] * k | 0, c[2] * k | 0];
  const blend = (i, c, a) => {
    const da = d[i + 3] / 255, oa = a + da * (1 - a); if (oa <= 0) return;
    let r, g, b;
    if (da <= 0) { r = c[0]; g = c[1]; b = c[2]; }
    else { r = (c[0] * a + d[i] * da * (1 - a)) / oa; g = (c[1] * a + d[i + 1] * da * (1 - a)) / oa; b = (c[2] * a + d[i + 2] * da * (1 - a)) / oa; }
    d[i] = r | 0; d[i + 1] = g | 0; d[i + 2] = b | 0; d[i + 3] = oa * 255 | 0;
  };
  const sdfEll = (x, y, cx, cy, rx, ry) => { const dx = (x - cx) / rx, dy = (y - cy) / ry; return (Math.sqrt(dx * dx + dy * dy) - 1) * Math.min(rx, ry); };
  const sdfRound = (x, y, x0, y0, x1, y1, r) => { const cx = Math.max(x0, Math.min(x, x1)), cy = Math.max(y0, Math.min(y, y1)); const dx = x - cx, dy = y - cy; return Math.sqrt(dx * dx + dy * dy) - r; };
  const paint = (cx, cy, rx, ry, topCol, deepCol) => {
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const dist = sdfEll(x, y, cx, cy, rx, ry);
      const a = Math.max(0, Math.min(1, 0.5 - dist));
      if (a <= 0) continue;
      const t = Math.max(0, Math.min(1, (y - (cy - ry)) / (2 * ry)));
      blend((y * W + x) * 4, t > 0.55 ? lerp(topCol, deepCol, (t - 0.55) / 0.45) : topCol, a);
    }
  };
  const boxu = (x0, y0, x1, y1, r, loc, deepCol) => {
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const dist = sdfRound(x, y, x0, y0, x1, y1, r);
      const a = Math.max(0, Math.min(1, 0.5 - dist));
      if (a <= 0) continue;
      const t = Math.max(0, Math.min(1, (y - y0) / (y1 - y0)));
      blend((y * W + x) * 4, t > 0.6 ? lerp(loc, deepCol, (t - 0.6) / 0.4) : loc, a);
    }
  };
  // ── per-NPC SILHOUETTE (build) — nobody has the same fat body ──
  const bd = look.build || 'avg';
  // Slimmer, leggier builds — narrow torso, thin legs, longer visible leg.
  const T = bd === 'slim'   ? { t0: 24, t1: 40, tb: 33, tl: 53, tr: 3, lx1: 26, lx2: 38, ax1: 26, ax2: 38, hx1: 26, hx2: 38, ly: 65, lr: 4 }
         : bd === 'tall'   ? { t0: 21, t1: 43, tb: 30, tl: 51, tr: 3, lx1: 22, lx2: 42, ax1: 23, ax2: 41, hx1: 23, hx2: 41, ly: 62, lr: 5 }
         : bd === 'stocky' ? { t0: 18, t1: 46, tb: 34, tl: 55, tr: 5, lx1: 19, lx2: 45, ax1: 20, ax2: 44, hx1: 20, hx2: 44, ly: 66, lr: 6 }
         :                   { t0: 21, t1: 43, tb: 33, tl: 53, tr: 3, lx1: 23, lx2: 41, ax1: 23, ax2: 41, hx1: 24, hx2: 40, ly: 65, lr: 5 };
  // ── grounded drop shadow ──
  paint(32, 79, 20, 2, [20, 26, 38], [12, 16, 26]);
  // ── legs + boots (human only — robots draw their own legs in the head/branch) ──
  if (human) {
    // gait (QA 0904 4.3): the forward foot plants flat, the trailing foot
    // lifts its toe and shortens its shin — both feet used to be drawn
    // identical at every walk frame, which is why walking read as skating.
    const lead = gait === 1 ? 1 : gait === 2 ? 2 : 0;        // 1=left fwd, 2=right fwd
    const fwdOff = lead ? 2.5 : 0, backOff = lead ? -2 : 0;
    const o1 = lead === 1 ? fwdOff : lead === 2 ? backOff : 0;
    const o2 = lead === 2 ? fwdOff : lead === 1 ? backOff : 0;
    paint(T.lx1, T.ly + bob + (o1 > 0 ? 0.8 : o1 < 0 ? -1 : 0), 5.5, T.lr, C.pants, shade(C.pants, 0.72));
    paint(T.lx2, T.ly + bob + (o2 > 0 ? 0.8 : o2 < 0 ? -1 : 0), 5.5, T.lr, C.pants, shade(C.pants, 0.72));
    // shin fills the gap between trouser hem and boot crown (QA 4.3: detached
    // capsule feet with a visible daylight gap read as skating stumps)
    paint(T.lx1 + o1, 70 + bob, 4.2, 7, shade(C.pants, 0.86), shade(C.pants, 0.6));
    paint(T.lx2 + o2, 70 + bob, 4.2, 7, shade(C.pants, 0.86), shade(C.pants, 0.6));
    paint(T.lx1 + o1, 75 + bob, 5.5, 4, C.bootLt, C.bootSh);
    paint(T.lx2 + o2, 75 + bob, 5.5, 4, C.bootLt, C.bootSh);
    // boot toe caps point the facing — front boots lead, back boots tuck
    if (sideView) {
      paint(32 + side * 5 + (o1 || o2), 75 + bob, 3.2, 3, C.bootLt, C.bootSh);
    }
    // trailing foot toe raise — the actual "mid-stride" read
    if (lead) {
      const tx = (lead === 1 ? T.lx2 : T.lx1) + (lead === 1 ? backOff : fwdOff) - 4.5;
      paint(tx, 72.5 + bob, 2.4, 1.8, shade(C.bootLt, 0.9), C.bootSh);
    }
  }
  // ── torso (shoulders → hips), shaped by build ──
  boxu(T.t0, T.tb + bob, T.t1, T.tl + bob, T.tr, C.suitLt, C.suitSh);
  boxu(T.t0 + 5, T.tb + 2 + bob, T.t1 - 5, T.tb + 11 + bob, T.tr - 1, C.suitLt, C.suit);
  boxu(T.t0, T.tb + 13 + bob, T.t1, T.tb + 16 + bob, T.tr - 1, C.belt, C.belt);
  // ── torso gear: each NPC's front carries their trade — the strongest
  //    anti-clone cue (a face can blur at small scale; a tool can't) ──
  const gear = look.gear;
  if (gear === 'toolbelt') {
    paint(32, 48, 15, 5, [96, 72, 44], [70, 52, 32]);          // leather strap
    paint(20, 47 + bob, 4, 5, [118, 92, 58], [90, 68, 42]);    // wrench pouch
    paint(44, 47 + bob, 4, 5, [118, 92, 58], [90, 68, 42]);    // seed pouch
    paint(32, 46, 3, 3, [240, 214, 140], [190, 164, 96]);      // brass buckle
  } else if (gear === 'pin') {
    paint(40, 40 + bob, 4, 3, [150, 214, 208], [100, 160, 156]); // comet pin
    paint(41, 38 + bob, 1.4, 1.4, [232, 255, 252], [180, 230, 224]);
  } else if (gear === 'seedband') {
    paint(32, 44 + bob, 14, 4, [150, 118, 70], [110, 86, 50]);  // bandolier
    paint(24, 45 + bob, 3, 3, [120, 176, 120], [90, 130, 92]);  // seed pod
    paint(32, 45 + bob, 3, 3, [120, 176, 120], [90, 130, 92]);
    paint(40, 45 + bob, 3, 3, [120, 176, 120], [90, 130, 92]);
  } else if (gear === 'pouches') {
    paint(18, 50 + bob, 5, 7, [80, 70, 54], [58, 50, 38]);      // left tool pouch
    paint(46, 50 + bob, 5, 7, [80, 70, 54], [58, 50, 38]);      // right tool pouch
    paint(32, 40 + bob, 10, 5, [110, 96, 66], [84, 72, 48]);    // tool roll
  } else if (gear === 'apron') {
    paint(32, 50, 12, 12, [214, 202, 178], [186, 172, 148]);    // kitchen apron
    paint(32, 45, 10, 4, [196, 184, 160], [168, 156, 134]);     // apron bib
    paint(24, 56 + bob, 4, 3, [196, 184, 160], [168, 156, 134]); // patch
  } else if (gear === 'book') {
    paint(40, 48 + bob, 5, 8, [150, 96, 84], [112, 70, 60]);    // arm book
    paint(39, 47 + bob, 3, 1.6, [236, 226, 200], [200, 190, 164]);
  } else if (gear === 'plasma') {
    paint(32, 50 + bob, 6, 8, [236, 120, 60], [180, 84, 40]);   // plasma cell
    paint(32, 48 + bob, 3, 2, [255, 214, 140], [236, 170, 96]); // charge glow
  } else if (gear === 'satchel') {
    paint(44, 52 + bob, 6, 8, [128, 108, 84], [96, 80, 60]);    // satchel
    paint(44, 49 + bob, 6, 3, [148, 128, 100], [112, 94, 70]);  // flap
  }
  // ── arms (distinct limbs, not bumps) ──
  paint(T.ax1, 46 + bob + (gait === 1 ? -1.2 : gait === 2 ? 0.8 : 0), 3.6, 15, C.suit, C.suitSh);
  paint(T.ax2, 46 + bob + (gait === 2 ? -1.2 : gait === 1 ? 0.8 : 0), 3.6, 15, C.suit, C.suitSh);
  // side view (QA 0904 4.3): far arm drawn on the silhouette edge swinging —
  // near arm hangs its own line — so profile frames read as a walking BODY,
  // not a frontal sprite rotated. Hands track the swing.
  if (sideView) {
    const sw = gait === 1 ? 3 : gait === 2 ? -3 : 0;                    // arm swing px
    paint(32 - side * 3.5, 46 + bob, 3.2, 15, shade(C.suit, 0.78), shade(C.suit, 0.6));   // far arm
    paint(32 - side * 3.5, 59 + bob + sw * 0.4, 2.8, 3.4, shade(C.faceSh, 0.8), shade(C.faceSh, 0.65));
    paint(32 + side * 1, 46 + bob, 3.8, 15, C.suit, C.suitSh);          // near arm
    paint(32 + side * 1 + sw * 0.5, 59 + bob, 3.2, 3.8, C.faceSh, C.faceSh);
  } else {
    paint(T.hx1, 58 + bob, 3, 3.8, C.faceSh, C.faceSh);
    paint(T.hx2, 58 + bob, 3, 3.8, C.faceSh, C.faceSh);
  }
  // ── head (approx 1/4.5 of full height — reads human) ──
  if (human) {
    if (backView) {
      // QA 0904 4.4: walking away used to show the full front face (eyes,
      // smile, blush) because `dir` was never decoded. Back view = hair
      // coverage over an unseen head + nape — no eyes, no mouth, no blush.
      const hc0 = look.hairC || shade(C.helmet, 0.6);
      paint(32, 18 + bob, 9.8, 8.4, C.faceSh, shade(C.faceSh, 0.8));   // skull back
      paint(32, 12 + bob, 14, 10, hc0, shade(hc0, 0.72));               // full hair cap
      if ((look.hair || 'short') === 'long') {
        paint(32, 24 + bob, 11, 9, hc0, shade(hc0, 0.66));              // hair falls down the back
        // backpack on the walking-away silhouette (QA 4.1 back variety)
        if (look.backpack) {
          paint(32, 42 + bob, 11, 9, [96, 116, 96], [64, 82, 66]);
          paint(32, 38 + bob, 7, 2.4, [128, 150, 124], [96, 116, 96]);
        }
      }
    } else {
    paint(32, 18 + bob, 9.8, 8.4, C.face, C.faceSh);             // face / neck
    const hc = look.hairC || shade(C.helmet, 0.6);
    const hs = look.hair || 'short';
    if (hs === 'buzz') {
      paint(32, 7 + bob, 12.5, 3.4, hc, shade(hc, 0.8));
    } else {
      paint(32, 10.5 + bob, 13.2, 7.6, hc, shade(hc, 0.72));          // hair volume (trimmed 1.5px so head:body reads 1:3, not chibi)
      if (hs === 'long') {
        paint(20, 16 + bob, 4, 9, hc, shade(hc, 0.8));
        paint(44, 16 + bob, 4, 9, hc, shade(hc, 0.8));
      } else if (hs === 'bun') {
        paint(32, 7 + bob, 4.6, 4.4, hc, shade(hc, 0.76));
      }
    }
    // expressive eyes: bigger, open, with a glint highlight + arched brows
    // (side view: features ride the leading cheek, eyes pull toward profile)
    const eyC = look.eyes || [46, 38, 30];
    const fx = sideView ? side * 3.2 : 0;
    if (sideView) {
      paint(32 + fx, 19 + bob, 3.2, 4.2, eyC, [16, 12, 10]);            // single visible eye
      paint(32 + fx + side * 1.2, 16.4 + bob, 1.3, 1.6, [255, 252, 244], [255, 244, 220]);
      paint(32 + side * 1, 14.5 + bob, 3.6, 1.2, shade(hc, 0.55), shade(hc, 0.42));
    } else {
      paint(25, 19 + bob, 3.8, 4.2, eyC, [16, 12, 10]);
      paint(39, 19 + bob, 3.8, 4.2, eyC, [16, 12, 10]);
      paint(23.6, 16.4 + bob, 1.3, 1.6, [255, 252, 244], [255, 244, 220]);   // glint
      paint(37.6, 16.4 + bob, 1.3, 1.6, [255, 252, 244], [255, 244, 220]);
      // arched brows (a little personality arc)
      paint(24, 14.5 + bob, 4, 1.2, shade(hc, 0.55), shade(hc, 0.42));
      paint(40, 14.5 + bob, 4, 1.2, shade(hc, 0.55), shade(hc, 0.42));
    }
    // mouth: closed smile vs talking (frame 2) — real expression
    const mouthOpen = frame === 2;
    paint(32 + fx, mouthOpen ? 25 : 24 + bob, mouthOpen ? 7 : 4.4, mouthOpen ? 2.6 : 1.6,
          mouthOpen ? [210, 120, 96] : shade(C.face, 0.8), mouthOpen ? [150, 78, 60] : [40, 24, 16]);
    // blush — only where the mood reads warm; the two identical 2px dots on
    // every face were one of the 'same face in nine wigs' tells (QA 4.2)
    if (['kind', 'bright', 'dreamy', 'calm'].includes(look.mood)) {
      paint(20 + fx, 21 + bob, 2.2, 1.7, [214, 122, 110], [150, 80, 70]);
      paint(44 + fx, 21 + bob, 2.2, 1.7, [214, 122, 110], [150, 80, 70]);
    }
    // ── outline prop (QA 0904 4.1): a per-NPC SILHOUETTE prop so the cast
    //    differs by shape against the bright floor, not just by colour ──
    const out = look.outline;
    if (out === 'bedroll') {
      paint(45, 34 + bob, 5, 8, [124, 138, 110], [86, 100, 78]);      // shoulder bed-roll
      paint(45, 30 + bob, 4.2, 2.4, [150, 164, 134], [112, 126, 100]);
    } else if (out === 'cratelid') {
      paint(18, 38 + bob, 6, 6, [126, 106, 80], [92, 76, 56]);          // hip crate + lid
      paint(18, 32 + bob, 7, 2, [150, 128, 98], [112, 94, 70]);
    } else if (out === 'oiltank') {
      paint(46, 44 + bob, 5, 9, [112, 122, 138], [78, 88, 104]);       // back oil tank
      paint(46, 35 + bob, 2, 2, [240, 190, 96], [200, 150, 70]);       // valve
    } else if (out === 'seedbasket') {
      paint(18, 42 + bob, 7, 7, [150, 122, 78], [110, 86, 54]);         // seed basket
      paint(18, 37 + bob, 8, 2.4, [172, 144, 96], [132, 106, 68]);
      paint(16, 40 + bob, 2, 2, [126, 180, 122], [92, 132, 92]);        // sprig
    } else if (out === 'lamp') {
      paint(47, 42 + bob, 3.4, 5.5, [96, 104, 122], [66, 74, 92]);     // hand-lamp on hip
      paint(47, 37 + bob, 3.4, 3, [250, 214, 140], [210, 160, 80]);
    }
    // ── accessories — per-character gear so every villager has a distinct
    //    silhouette, not the same body in a different colour ──
    const acc = look.acc;
    if (acc === 'sunhat') {
      paint(32, 11 + bob, 13, 3, [198, 160, 106], [150, 116, 72]);   // brim
      paint(32, 5 + bob, 10, 7, [184, 144, 94], [140, 106, 68]);     // crown
      paint(32, 9 + bob, 3, 1.4, [112, 84, 52], [84, 60, 38]);                          // hat band
    } else if (acc === 'scarf') {
      paint(32, 27 + bob, 18, 4, [110, 86, 150], [78, 60, 112]);     // neck wrap
      paint(44, 28 + bob, 5, 6, [110, 86, 150], [78, 60, 112]);      // tail
    } else if (acc === 'beanie') {
      paint(32, 7 + bob, 12, 5, [104, 140, 88], [76, 110, 66]);      // cap
      paint(32, 10 + bob, 12, 2, [134, 170, 110], [100, 136, 84]);   // cuff
    } else if (acc === 'apron') {
      paint(32, 45, 13, 16, [226, 214, 188], [196, 184, 158]);    // moss-canvas apron
      paint(32, 42, 10, 5, [120, 164, 128], [92, 128, 100]);      // feather-moss yoke
      paint(32, 49, 7, 4, [150, 190, 150], [112, 148, 116]);       // glowing moss patch
    } else if (acc === 'pilotcap') {
      paint(32, 6 + bob, 12, 6, [196, 160, 110], [150, 118, 78]);    // cap
      paint(22, 15 + bob, 8, 2.4, [196, 160, 110], [150, 118, 78]);  // brim
      paint(38, 7 + bob, 3, 2, [232, 120, 70], [190, 92, 52]);                      // badge
    } else if (acc === 'bandana') {
      paint(25, 7 + bob, 14, 3.4, [188, 120, 108], [146, 88, 78]);   // band
      paint(30, 11 + bob, 4, 2, [188, 120, 108], [146, 88, 78]);     // knot
      paint(36, 12 + bob, 7, 2.6, [188, 120, 108], [146, 88, 78]);    // tail
    } else if (acc === 'headband') {
      paint(32, 4 + bob, 14, 4, [104, 126, 168], [76, 94, 132]);     // band
      paint(27, 7 + bob, 2.2, 1.4, [70, 90, 130], [50, 66, 100]);                    // keeper
    } else if (acc === 'hood') {
      paint(20, 15 + bob, 5, 12, [186, 92, 70], [140, 64, 48]);      // left side
      paint(44, 15 + bob, 5, 12, [186, 92, 70], [140, 64, 48]);       // right side
      paint(32, 9 + bob, 16, 4, [186, 92, 70], [140, 64, 48]);       // top rim
    } else if (acc === 'ribbon') {
      paint(24, 8 + bob, 5, 3, [120, 176, 164], [84, 136, 126]);    // left bow (in hair)
      paint(40, 8 + bob, 5, 3, [120, 176, 164], [84, 136, 126]);    // right bow
      paint(32, 9 + bob, 3, 3, [150, 208, 196], [110, 168, 158]);   // knot
      paint(36, 11 + bob, 4, 3, [120, 176, 164], [84, 136, 126]);   // trailing tail
    }
    }
  } else {
    // ── ROBOTS as individuals with their OWN bodies (not a human in a shell) ──
    const ro = look.robot || {};
    // shared: metal head shell
    paint(32, 18 + bob, 14, 13, C.helmet, C.helmetSh);
    // visor glow
    paint(32, 20 + bob, 9, 3, C.visorHi, C.visor);
    if (ro.tall) {
      // NOVA — tall chrome welder: armored trapezoid torso, glowing forge-heart,
      // thick legs, smouldering top vent, spark antenna
      boxu(T.t0 + 1, T.tb + bob, T.t1 - 1, T.tl - 4 + bob, T.tr, C.helmet, shade(C.helmet, 0.55)); // armored plate
      paint(32, T.tb + 6 + bob, 7, 3, shade(C.helmet, 0.8), shade(C.helmet, 0.6));                  // chest seam
      paint(32, 40 + bob, 4, 4, [255, 168, 88], [214, 110, 40]);                                    // forge-heart
      paint(32, 40 + bob, 1.6, 1.6, [255, 232, 190], [255, 200, 120]);
      paint(32, T.tb + bob, 6, 2, [90, 96, 118], [64, 70, 90]);                                      // top vent
      paint(32, 30 + bob, 4, 2, [255, 168, 88], [236, 120, 48]);                                     // welder spark light
      paint(46, 12 + bob, 2, 5, C.helmet, C.helmetSh);                                               // antenna
      paint(47, 10 + bob, 1.6, 1.6, [255, 200, 90], [230, 140, 40]);
      // heavy legs (armor plates, not suit legs) — carried all the way down to
      // boot plates so NOVA stands ON the ground; the old version ended the
      // greaves mid-shin, which is why the tall droid visibly floated.
      paint(T.lx1, T.ly + bob, 6, T.lr, shade(C.helmet, 0.85), shade(C.helmet, 0.55));
      paint(T.lx2, T.ly + bob, 6, T.lr, shade(C.helmet, 0.85), shade(C.helmet, 0.55));
      paint(T.lx1, 70 + bob, 5.6, 5, shade(C.helmet, 0.72), shade(C.helmet, 0.45));   // shin greave
      paint(T.lx2, 70 + bob, 5.6, 5, shade(C.helmet, 0.72), shade(C.helmet, 0.45));
      paint(T.lx1, 75 + bob, 6, 4.2, C.bootLt, C.bootSh);                              // boot plate
      paint(T.lx2, 75 + bob, 6, 4.2, C.bootLt, C.bootSh);
      paint(T.lx1, 73.5 + bob, 6, 1.2, C.metalHi || C.bootLt, C.bootLt);               // knee trim
      paint(T.lx2, 73.5 + bob, 6, 1.2, C.metalHi || C.bootLt, C.bootLt);
    } else {
      // CORA — round teal-moss prop-top bot: soft spherical body, short stubby
      // legs, propeller fin, glowing prop jewel, snack pin
      paint(32, 46 + bob, 15, 15, tint(C.suit, 0.14), shade(C.suit, 0.6));                           // round body
      paint(32, 38 + bob, 9, 3, tint(C.suit, 0.34), tint(C.suit, 0.24));                             // belly highlight
      paint(32, 6 + bob, 3, 1.6, [110, 210, 200], [60, 150, 150]);                                    // prop
      paint(24, 4 + bob, 7, 2, [110, 200, 190], [70, 150, 150]);                                       // fin
      paint(22, 7 + bob, 2, 2, C.visorHi, C.visor);
      paint(40, 42 + bob, 4, 2.4, [255, 214, 150], [230, 170, 100]);                                   // snack pin
      // stubby short legs
      paint(24, 62 + bob, 4.5, 6, shade(C.pants, 0.6), shade(C.pants, 0.45));
      paint(40, 62 + bob, 4.5, 6, shade(C.pants, 0.6), shade(C.pants, 0.45));
      paint(24, 70 + bob, 4.5, 4, C.bootLt, C.bootSh);
      paint(40, 70 + bob, 4.5, 4, C.bootLt, C.bootSh);
    }
  }
  // bold silhouette: dark slate rim on the body outline so every NPC reads as a
  // distinct character against the bright colony floor at small in-world scale
  const aOf = (x, y) => (x < 0 || y < 0 || x >= W || y >= H) ? 0 : d[(y * W + x) * 4 + 3];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4, a = d[i + 3];
    if (a < 34) continue;
    if (aOf(x - 1, y) < 34 || aOf(x + 1, y) < 34 || aOf(x, y - 1) < 34 || aOf(x, y + 1) < 34) {
      d[i] = 22; d[i + 1] = 26; d[i + 2] = 40; d[i + 3] = 255;
    }
  }

  ctx.putImageData(img, 0, 0);
}


// skin tones — a real human range, because space is full of brown people.
// Keyed by NPC id (robots stay metal shell and ignore this). 'player' is the
// avatar's own tone.
const DEFAULT_SKIN = [236, 200, 160];
const PLAYER_SKIN = [176, 118, 80];               // warm brown farmer
const NPC_SKIN = {
  nova: [206, 214, 230], cora: [214, 220, 234],   // robots → metallic synth-skin
  luna: [150, 100, 66],                          // deep brown
  zephyr: [196, 146, 102],                        // sun-kissed tan
  vega: [126, 78, 50],                            // deep umber
  quasar: [180, 124, 80],                         // weathered walnut
  rhea: [204, 152, 100],                          // warm brown
  astra: [184, 142, 98],                          // olive tan
  orion: [116, 72, 46],                           // espresso
  comet: [152, 98, 62],                           // reddish brown
};

// Per-NPC look: humans are exposed-faced with hair & eyes; nova/cora are robots.
// `mood` = the resting expression (kept in lockstep with PORTRAIT_CFG.expr — the
// face in the world and the face in the dialogue box are the SAME character).
// `outline` = a silhouette prop so the cast differs by SHAPE, not only colour.
const LOOK = {
  player: { human: true, build: 'stocky', acc: 'sunhat',   gear: 'toolbelt', hair: 'short', hairC: [88, 60, 40], eyes: [52, 42, 32], mood: 'calm',   outline: 'seedbasket' },
  luna:   { human: true, build: 'slim',   acc: 'scarf',    gear: 'pin',      hair: 'long',  hairC: [24, 20, 30], eyes: [52, 44, 34], backpack: true, mood: 'kind',   outline: 'bedroll' },
  zephyr: { human: true, build: 'tall',   acc: 'beanie',   gear: 'seedband', hair: 'bun',   hairC: [92, 66, 40], eyes: [50, 42, 34], mood: 'bright', outline: 'seedbasket' },
  vega:   { human: true, build: 'slim',   acc: 'apron',                     hair: 'long',  hairC: [136, 96, 58], eyes: [58, 46, 36], mood: 'sharp',  outline: 'cratelid' },
  quasar: { human: true, build: 'tall',   acc: 'pilotcap', gear: 'pouches',  hair: 'buzz',  hairC: [212, 204, 196], eyes: [34, 30, 46], mood: 'gruff', outline: 'oiltank' },
  rhea:   { human: true, build: 'stocky', acc: 'bandana',  gear: 'apron',    hair: 'short', hairC: [46, 30, 18], eyes: [52, 44, 34], mood: 'worry',  outline: 'cratelid' },
  astra:  { human: true, build: 'slim',   acc: 'headband', gear: 'book',     hair: 'bun',   hairC: [82, 56, 34], eyes: [48, 40, 30], mood: 'clever', outline: 'lamp' },
  orion:  { human: true, build: 'tall',   acc: 'hood',     gear: 'plasma',   hair: 'short', hairC: [14, 12, 10], eyes: [56, 46, 36], mood: 'sharp',  outline: 'oiltank' },
  comet:  { human: true, build: 'slim',   acc: 'ribbon',   gear: 'satchel',  hair: 'long',  hairC: [128, 88, 46], eyes: [50, 42, 32], backpack: true, mood: 'dreamy', outline: 'bedroll' },
  nova:   { human: false, robot: { tall: true } },   // chrome welder — tall, amber forge-heart, spark antenna
  cora:   { human: false, robot: { tall: false } },  // teal-moss prop-top bot — snack pin, cheerful rounder
};

function makeFrames(id, colorHex) {
  const base = hexRGB(colorHex);
  const skinTone = id === 'player' ? PLAYER_SKIN : (NPC_SKIN[id] || DEFAULT_SKIN);
  // Per-NPC leg/pant tone so the body isn't one solid suit block. Default is a
  // darkened suit; a few get their own color for extra silhouette separation.
  const PANTS = {
    player: shade(base, 0.55), luna: [34, 30, 48], zephyr: [64, 84, 60],
    vega: [70, 44, 54], quasar: [58, 54, 66], rhea: [74, 40, 40],
    astra: [40, 44, 78], orion: [46, 40, 44], comet: [70, 84, 92],
  };
  const suit = {
    helmet: [236, 240, 255], helmetSh: [150, 160, 205],
    visor: [70, 220, 225], visorHi: [210, 255, 255],
    face: skinTone, faceSh: shade(skinTone, 0.82),
    suit: base, suitLt: tint(base, 0.22), suitSh: shade(base, 0.62),
    belt: [120, 110, 150], buckle: [240, 220, 140], skin: skinTone,
    pants: PANTS[id] || shade(base, 0.55),
    boot: [58, 58, 84], bootLt: [88, 88, 122], bootSh: [42, 42, 64],
  };
  const frames = {};
  for (const dir of ['front', 'back', 'left', 'right']) {
    for (let f = 0; f < 3; f++) {
      const c = f === 0 ? suit : { ...suit, suit: shade(base, 0.94), suitSh: shade(base, 0.56) };
      frames[`${dir}_${f}`] = createSurface(64, 80, (s) => drawVillager(s, dir, f, c, LOOK[id]));
    }
  }
  // idle (front pose, no walk) — also used as base key texture source
  const idle = createSurface(64, 80, (s) => drawVillager(s, 'idle', 0, suit, LOOK[id]));
  return { frames, idle };
}

// ── player (orange suit, cyan visor, tan skin) ──
const PLAYER_PAL = { '2': [255, 180, 64], '3': [200, 200, 255], '4': [240, 160, 80], '5': [160, 120, 60] };
const PLAYER_COLOR = 0xd98a3f;
const playerAll = makeFrames('player', PLAYER_COLOR);
const PLAYER_FRAMES = playerAll.frames;
const PLAYER_FRONT = playerAll.idle;
const PLAYER_BACK = PLAYER_FRAMES.back_0;
const PLAYER_LEFT = PLAYER_FRAMES.left_0;
const PLAYER_RIGHT = PLAYER_FRAMES.right_0;

// ── NPCs (color-coded villagers, 3-frame idle bob) ──
// Phase 5 — one-world palette: each villager keeps a distinct hue, but steeped
// into the colony's muted range (dark steel / teal / rust / olive / mauve / slate)
// so the cast lives in the same world as the buildings, deck, and sky.
const NPC_COLORS = {
  nova: 0x44b4b4, luna: 0x8a74b0, zephyr: 0x749b5c, vega: 0xb0707c,
  quasar: 0xc0945c, rhea: 0xba8276, astra: 0x687cb0, orion: 0xb0544c,
  comet: 0x6ea8a2, cora: 0x3cb0a0,
};
const NPC_SPRITES = {};
const NPC_FRAMES = {};
const NPC_WALK = {};
for (const [id, col] of Object.entries(NPC_COLORS)) {
  const all = makeFrames(id, col);
  NPC_SPRITES[id] = all.idle;
  NPC_FRAMES[id] = [all.frames.front_0, all.frames.front_1, all.frames.front_2];
  NPC_WALK[id] = all.frames; // all dirs × 3 frames — used by PlanetScene errand AI
}

// ── Ship tiles (16×16, scale 1) — SpaceshipScene ──
// ══ SHIP INTERIOR — painterly colony tiles (dark steel + teal glow), the
//    spacecraft's bridge/bunk/greenhouse deck at the world's 32px standard. ══
const SHIP_SPRITES = {
  // metal deck floor — soft centre-light, faint panel seams, teal rivets
  floor: paintSurface(32, 32, (P) => {
    P.box(0, 0, 31, 31, 1, [52, 60, 72], [34, 42, 52]);
    P.box(2, 2, 27, 27, 6, [60, 70, 84], [40, 48, 58]);       // recessed panel
    P.ell(9, 9, 2, 2, [70, 178, 176], [40, 120, 120]);           // teal rivet
    P.ell(23, 23, 2, 2, [70, 178, 176], [40, 120, 120]);
  }),
  // hull wall — dark slate bulkhead: recessed panel, glowing teal light strip,
  // a bright top beam so it reads as a RAISED surface (distinct from the deck)
  wall: paintSurface(32, 32, (P) => {
    P.box(0, 0, 31, 31, 1, [40, 50, 62], [26, 34, 44]);            // dark slate bulkhead (clearly darker than deck)
    P.box(4, 8, 27, 24, 3, [48, 58, 72], [36, 44, 54]);            // recessed panel
    P.box(4, 26, 27, 27, 1, [56, 168, 166], [34, 120, 122]);        // teal light strip
    P.ell(16, 6, 4, 3, [90, 200, 196], [50, 150, 150]);             // indicator
    // top bulkhead beam — bright lit edge so the wall reads as raised, not floor
    P.box(0, 0, 31, 4, 1, [92, 104, 118], [70, 80, 92]);
    P.box(0, 3, 31, 3, 1, [64, 74, 86], [48, 56, 66]);
    // vertical seam lines so repeated wall tiles read as metal plates
    P.box(0, 8, 1, 27, 1, [32, 40, 50], [24, 30, 38]);
    P.box(30, 8, 31, 27, 1, [32, 40, 50], [24, 30, 38]);
  }),
  // cryo-pod — glass tube with teal life-fluid, dark amber veneer cradle
  // QA fix: the old frame [120,104,84] read as bare cardboard stuck on a metal
  // hull. Dark amber veneer is a plausible habitat material and carries warmth
  // against the slate instead of looking like packaging.
  cryopod: paintSurface(32, 30, (P) => {
    P.box(4, 4, 28, 27, 5, [96, 62, 34], [58, 38, 20]);         // amber veneer frame
    P.box(4, 4, 28, 6, 2, [210, 160, 92], [140, 100, 52]);      // lit veneer top edge
    P.box(8, 7, 24, 24, 2, [20, 40, 64], [10, 22, 40]);           // glass dark
    P.ell(16, 18, 7, 8, [44, 160, 170], [18, 100, 120]);          // teal fluid
    P.ell(16, 12, 7, 2, [120, 214, 214], [60, 170, 172]);     // tube glow
    P.ell(13, 8, 1, 1, [255, 250, 210], [230, 210, 150]);         // console light
    P.ell(16, 26, 4, 1.2, [90, 228, 216], [40, 140, 160]);        // teal base seam
  }),
  // console — sleek control deck, teal screen + amber toggles
  console: paintSurface(32, 22, (P) => {
    P.box(2, 4, 30, 21, 4, [44, 54, 70], [28, 36, 48]);           // body
    P.box(5, 7, 27, 13, 2, [16, 30, 52], [8, 18, 34]);            // screen
    P.ell(11, 10, 3, 2, [90, 214, 210], [40, 150, 150]);          // teal readout
    P.ell(21, 10, 3, 2, [240, 190, 120], [200, 150, 86]);         // amber gauge
    P.ell(9, 17, 2, 1.4, [250, 140, 110], [210, 90, 70]);         // power toggle
    P.ell(23, 17, 2, 1.4, [110, 210, 200], [60, 160, 160]);
  }),
  // sliding door — twin steel leaves, teal seam glow
  door: paintSurface(24, 22, (P) => {
    P.box(3, 2, 21, 21, 3, [70, 82, 96], [48, 58, 70]);
    P.box(5, 3, 11, 20, 1, [90, 102, 116], [60, 70, 82]);        // left leaf
    P.box(13, 3, 19, 20, 1, [90, 102, 116], [60, 70, 82]);        // right leaf
    P.ell(12, 12, 1, 9, [64, 180, 178], [36, 120, 122]);          // teal center seam
  }),
  // airlock — rounded portal with teal glow ring
  airlock: paintSurface(24, 22, (P) => {
    P.box(3, 3, 21, 21, 5, [82, 92, 108], [56, 64, 78]);
    P.ell(12, 11, 6, 8, [24, 44, 66], [12, 28, 44]);              // void interior
    P.ell(12, 11, 7, 9, [64, 178, 176], [36, 118, 120]);          // teal glow ring
    P.ell(12, 7, 2, 1.6, [250, 200, 120], [210, 160, 90]);        // status lamp
  }),
};

// ══ RANCH ANIMALS — normal farm critters in little white space helmets
//    (EarthBound humor: cows & co. are colonists too). Painterly, colony-toned. ══
export const RANCH = {
  cow: paintSurface(44, 30, (P) => {
    // body (white + dark patch), four legs' shadow merged
    P.box(8, 10, 36, 26, 6, [240, 240, 244], [196, 200, 208]);     // body
    P.ell(18, 16, 10, 8, [176, 150, 158], [132, 112, 120]);        // dark patch
    P.ell(30, 14, 3, 3, [176, 150, 158], [132, 112, 120]);         // tail patch
    // head + muzzle
    P.ell(8, 14, 5, 6, [246, 244, 248], [210, 210, 216]);          // muzzle
    P.ell(5, 6, 5, 5, [246, 244, 248], [214, 214, 220]);          // head/base
    // space helmet (white bowl + teal visor + antenna)
    P.ell(7, 3, 5, 4, [240, 246, 255], [196, 210, 232]);          // helmet crown
    P.ell(6, 7, 3, 3, [120, 214, 214], [70, 160, 170]);            // visor
    P.ell(7, 7.6, 1.6, 0.9, [30, 34, 50], [18, 20, 32]);        // dark chin strap (helmet rims off the head)
    P.ell(9, 0, 1.5, 2, [210, 214, 224], [150, 160, 180]);         // antenna mast
    P.ell(11, 2, 1.4, 1.4, [255, 200, 90], [230, 140, 40]);       // antenna jewel
    // legs
    P.box(8, 24, 12, 27, 2, [236, 238, 242], [200, 204, 210]);
    P.box(28, 24, 32, 27, 2, [236, 238, 242], [200, 204, 210]);
  }),
  chicken: paintSurface(30, 26, (P) => {
    // plump feathery body
    P.ell(15, 12, 9, 8, [236, 230, 216], [200, 192, 176]);
    P.ell(10, 14, 4, 7, [236, 176, 130], [204, 140, 96]);     // wing
    // comb + beak
    P.ell(15, 4, 4, 3, [216, 60, 50], [170, 44, 38]);              // comb
    P.ell(5, 12, 2.5, 2, [248, 160, 60], [214, 120, 44]);          // beak
    // helmet + visor + antenna
    P.ell(13, 2, 6, 4, [238, 244, 252], [198, 210, 230]);
    P.ell(10, 4, 2.6, 2.6, [110, 210, 210], [66, 158, 168]);
    P.ell(14, 7.5, 1.8, 0.8, [30, 34, 50], [18, 20, 32]);          // dark neck strap
    P.ell(19, 5, 1.5, 1.5, [255, 198, 88], [228, 138, 40]);
    // legs
    P.box(10, 20, 12, 25, 2, [236, 230, 216], [200, 192, 176]);
    P.box(17, 20, 19, 25, 2, [236, 230, 216], [200, 192, 176]);
  }),
  sheep: paintSurface(40, 30, (P) => {
    // fluffy wool body
    P.box(10, 8, 30, 26, 8, [244, 244, 248], [212, 214, 222]);
    P.ell(30, 12, 6, 5, [244, 244, 248], [216, 218, 226]);         // wool fluff
    // dark face + ears
    P.ell(7, 14, 4.5, 5, [86, 70, 62], [56, 46, 42]);              // face plate
    // helmet
    P.ell(6, 3, 5, 4, [240, 246, 255], [196, 210, 232]);
    P.ell(6, 7, 2.8, 2.8, [116, 214, 212], [70, 160, 170]);        // visor
    P.ell(6, 7.6, 1.5, 0.9, [30, 34, 50], [18, 20, 32]);           // dark chin strap
    P.ell(9, 0, 1.2, 1.6, [210, 214, 224], [150, 160, 180]);       // antenna
    P.ell(10, 1.5, 1.2, 1.2, [255, 200, 90], [228, 138, 40]);
    // legs
    P.box(10, 24, 13, 27, 2, [230, 230, 236], [196, 200, 208]);
    P.box(26, 24, 29, 27, 2, [230, 230, 236], [196, 200, 208]);
  }),
};
// e.g. ranch.cow → key 'ranch.cow'

// Legacy TILE_SPRITES alias — anything importing the old name keeps working
const TILE_SPRITES = {
  soil: GROUND.soil,
  tilled: GROUND.tilled,
  seeded: GROUND.seeded,
  growing: GROUND.growing,
  mature: GROUND.mature,
  path: GROUND.path,
  floor: SHIP_SPRITES.floor,
  wall: SHIP_SPRITES.wall,
  cryopod: SHIP_SPRITES.cryopod,
  console: SHIP_SPRITES.console,
  planter: planterBox,
  door: SHIP_SPRITES.door,
  airlock: SHIP_SPRITES.airlock,
};

// ── Utilities ──
function blitSprite(spr, x, y, ctx) { ctx.drawImage(spr, x, y); }

function makeHUDSprite(text, color = '#9ddd72', bg = '#000000') {
  const canvas = document.createElement('canvas');
  const w = 960, h = 40;
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = bg;
  ctx.globalAlpha = 0.7;
  ctx.fillRect(0, 0, w, h);
  ctx.globalAlpha = 1;
  ctx.font = '12px monospace';
  ctx.fillStyle = color;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 10, h / 2);
  return canvas;
}

// camelCase name (grassA, soilB) → snake_case key (grass_a, soil_b) so scene refs match
const toSnake = k => k.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();

// ── House interior furniture — colony habitat language. Everything matches
//    the room shell: slate + teal + cream + amber. No warm wood, no rust.
//    (Old JRPG-cozy wood palette removed — it clashed with the slate room.)
// ══ HOME INTERIOR — painterly furniture in the colony palette ══
const INT_BED = paintSurface(48, 30, (P) => {
  P.box(1, 6, 47, 11, 4, [80, 92, 112], [56, 66, 84]);           // slate headboard
  P.box(1, 10, 47, 11, 1, [90, 228, 216], [40, 140, 160]);       // headboard teal trim
  P.box(3, 12, 45, 28, 4, [66, 76, 94], [48, 56, 72]);           // metal frame base
  P.box(2, 11, 46, 12, 1, [90, 228, 216], [40, 140, 160]);       // teal frame trim
  P.box(19, 11, 45, 26, 6, [236, 228, 206], [200, 190, 170]);    // cream mattress
  P.ell(34, 17, 9, 5, [246, 240, 228], [214, 204, 190]);         // cream pillow
  P.ell(30, 23, 13, 5, [90, 228, 216], [40, 140, 160]);          // teal blanket
  P.box(28, 21, 42, 22, 1, [255, 176, 96], [220, 140, 70]);      // amber blanket stripe
});
const INT_TABLE = paintSurface(44, 26, (P) => {
  P.box(0, 14, 8, 24, 3, [66, 76, 94], [48, 56, 72]);            // leg l (metal)
  P.box(36, 14, 44, 24, 3, [66, 76, 94], [48, 56, 72]);          // leg r (metal)
  P.box(2, 24, 42, 26, 3, [66, 76, 94], [48, 56, 72]);           // leg base
  P.box(3, 6, 41, 12, 3, [96, 110, 130], [64, 76, 94]);          // slate tabletop
  P.box(3, 7, 41, 8, 1, [90, 228, 216], [40, 140, 160]);         // teal tabletop trim
  P.ell(22, 14, 11, 4, [70, 160, 104], [48, 128, 80]);           // plant on table (moss)
  P.ell(33, 14, 4, 3, [255, 176, 96], [220, 140, 70]);           // amber cup
});
const INT_WINDOW = paintSurface(36, 28, (P) => {
  P.box(1, 1, 35, 27, 2, [96, 110, 130], [64, 76, 94]);          // slate frame
  P.box(2, 2, 34, 26, 1, [90, 228, 216], [40, 140, 160]);        // teal inner rim
  P.box(4, 4, 32, 24, 0, [16, 22, 40], [8, 12, 24]);             // deep-space pane
  P.ell(22, 8, 5, 5, [150, 90, 60], [120, 70, 50]);              // planet
  P.ell(10, 14, 3, 2, [90, 210, 205], [40, 150, 150]);           // teal star glint
  P.ell(29, 20, 1.5, 1.5, [255, 240, 200], [220, 190, 140]);     // star
});
const INT_BOOKCASE = paintSurface(44, 30, (P) => {
  P.box(2, 2, 42, 28, 2, [72, 84, 104], [50, 60, 78]);           // metal case body
  P.box(2, 2, 42, 3, 1, [90, 228, 216], [40, 140, 160]);         // teal top trim
  P.box(2, 8, 42, 11, 0, [56, 66, 84], [44, 52, 66]);            // shelf 2
  P.box(2, 18, 42, 21, 0, [56, 66, 84], [44, 52, 66]);           // shelf 3
  // books (colony palette spines)
  P.box(5, 4, 9, 8, 1, [70, 190, 200], [40, 130, 150]);          // teal book
  P.box(12, 4, 16, 8, 1, [236, 228, 206], [200, 190, 170]);      // cream book
  P.box(19, 4, 23, 8, 1, [255, 176, 96], [220, 140, 70]);        // amber book
  P.box(6, 12, 10, 17, 1, [110, 124, 148], [70, 82, 104]);       // slate book
  P.box(13, 12, 17, 17, 1, [70, 190, 200], [40, 130, 150]);      // teal book
  // teal lamp on top shelf
  P.ell(34, 5, 5, 3, [90, 214, 210], [44, 150, 150]);
});
const INT_RUG = paintSurface(48, 20, (P) => {
  P.ell(24, 10, 22, 9, [90, 228, 216], [40, 140, 160]);          // teal rug
  P.ell(24, 10, 17, 6.5, [236, 228, 206], [200, 190, 170]);      // cream weave
  P.ell(24, 10, 6, 2.4, [255, 176, 96], [220, 140, 70]);         // amber medallion
});
const INT_PLANT = paintSurface(40, 32, (P) => {
  P.box(10, 22, 30, 30, 4, [96, 110, 130], [64, 76, 94]);        // slate pot
  P.box(10, 22, 30, 23, 1, [90, 228, 216], [40, 140, 160]);      // teal pot rim
  P.ell(20, 24, 7, 4, [110, 200, 170], [70, 150, 120]);          // soil glow
  // bioluminescent fronds
  P.ell(20, 8, 9, 6, [100, 210, 190], [60, 160, 150]);
  P.ell(14, 14, 6, 9, [90, 190, 170], [50, 130, 120]);
  P.ell(26, 14, 6, 9, [90, 190, 170], [50, 130, 120]);           // right frond
  P.ell(20, 3, 2, 2, [180, 255, 235], [130, 220, 200]);          // glowing tip
});

// colony galley stove + cargo pod chest + teal airlock door — replace the old
// flat debug rectangles in the scene with proper sprite props (same language).
const INT_STOVE = paintSurface(44, 30, (P) => {
  P.box(0, 6, 44, 28, 4, [66, 76, 94], [48, 56, 72]);            // slate body
  P.box(2, 4, 42, 6, 1, [90, 228, 216], [40, 140, 160]);         // teal top strip
  P.box(5, 12, 39, 28, 2, [236, 228, 206], [200, 190, 170]);     // cream front panel
  P.ell(14, 12, 4, 2.5, [255, 176, 96], [220, 140, 70]);         // amber burner l
  P.ell(30, 12, 4, 2.5, [255, 176, 96], [220, 140, 70]);         // amber burner r
  P.ell(22, 20, 2.5, 1.8, [90, 228, 216], [40, 140, 160]);       // teal control
});
const INT_CHEST = paintSurface(44, 30, (P) => {
  P.box(0, 0, 44, 28, 4, [66, 76, 94], [48, 56, 72]);            // slate hull
  P.box(0, 0, 44, 4, 2, [90, 228, 216], [40, 140, 160]);         // teal lid trim
  P.box(18, 12, 26, 18, 2, [236, 228, 206], [200, 190, 170]);    // cream latch
  P.ell(8, 9, 3, 3, [255, 176, 96], [220, 140, 70]);             // amber indicator
});
const INT_DOOR = paintSurface(36, 44, (P) => {
  P.box(0, 0, 36, 44, 3, [96, 110, 130], [64, 76, 94]);          // slate frame
  P.box(4, 4, 32, 40, 2, [70, 190, 200], [40, 130, 150]);        // teal door
  P.box(8, 10, 28, 26, 1, [40, 60, 80], [24, 40, 56]);           // window slit
  P.box(4, 40, 32, 41, 1, [90, 228, 216], [40, 140, 160]);       // teal glow seam
  P.ell(26, 22, 3, 4, [255, 176, 96], [220, 140, 70]);           // amber handle
});
// shop counter / tavern bar / exchange counter — colony service counter
const INT_COUNTER = paintSurface(56, 26, (P) => {
  P.box(0, 0, 56, 24, 3, [66, 76, 94], [48, 56, 72]);            // slate counter body
  P.box(2, 2, 54, 4, 1, [90, 228, 216], [40, 140, 160]);         // teal top trim
  P.box(2, 18, 54, 24, 1, [90, 228, 216], [40, 140, 160]);       // teal base trim
  P.box(8, 6, 48, 18, 1, [236, 228, 206], [200, 190, 170]);      // cream service panel
  P.ell(20, 9, 2.5, 2, [255, 176, 96], [220, 140, 70]);          // amber indicator
  P.ell(38, 9, 2.5, 2, [90, 228, 216], [40, 140, 160]);          // teal indicator
});
// ranch barn stall — slate pen with teal railing + feed door
const INT_STALL = paintSurface(48, 30, (P) => {
  P.box(2, 2, 46, 28, 3, [66, 76, 94], [48, 56, 72]);            // slate stall
  P.box(2, 4, 46, 5, 1, [90, 228, 216], [40, 140, 160]);         // teal railing top
  P.box(2, 12, 46, 13, 1, [90, 228, 216], [40, 140, 160]);       // teal railing mid
  P.box(2, 20, 46, 21, 1, [90, 228, 216], [40, 140, 160]);       // teal railing low
  P.box(20, 8, 28, 18, 1, [110, 124, 148], [70, 82, 104]);       // slate feed door
});
// exchange console / terminal — slate monolith with teal screen
const INT_TERMINAL = paintSurface(32, 30, (P) => {
  P.box(0, 0, 32, 28, 2, [66, 76, 94], [48, 56, 72]);            // slate body
  P.box(4, 4, 28, 20, 1, [40, 60, 80], [24, 40, 56]);            // teal screen
  P.box(8, 8, 24, 16, 1, [70, 190, 200], [40, 130, 150]);        // screen glow
  P.ell(28, 24, 2, 2, [255, 176, 96], [220, 140, 70]);           // amber power light
});
// ── Per-kind interior identity props ──
// QA verdict: all five rooms read as the SAME room with glyphs swapped (one
// counter, two chests, two tables at the same anchors). These give the tavern,
// shop, exchange and ranch furniture that is unmistakably THEIRS.
// tavern bar-back — bottle shelf + taps: the room reads as a cantina instantly
const INT_BARBACK = paintSurface(56, 34, (P) => {
  P.box(2, 6, 52, 32, 3, [56, 68, 86], [36, 46, 62]);             // back cabinet
  P.box(2, 4, 52, 6, 1, [90, 228, 216], [40, 140, 160]);         // teal valance
  P.box(4, 12, 50, 13, 1, [110, 124, 148], [70, 82, 104]);       // shelf 1
  P.box(4, 22, 50, 23, 1, [110, 124, 148], [70, 82, 104]);       // shelf 2
  // bottles (amber/cream/teal glass) on both shelves
  [[8, 6], [16, 9], [24, 7], [32, 10], [40, 8], [46, 11]].forEach(([bx, bv], i) => {
    const col = i % 3 === 0 ? [255, 190, 110] : i % 3 === 1 ? [236, 228, 206] : [100, 224, 218];
    P.box(bx, 7 + (bv % 2), bx + 2, 11, 1, col, [Math.round(col[0] * 0.6), Math.round(col[1] * 0.6), Math.round(col[2] * 0.6)]);
    P.box(bx, 17 + (bv % 2), bx + 2, 21, 1, col, [Math.round(col[0] * 0.6), Math.round(col[1] * 0.6), Math.round(col[2] * 0.6)]);
  });
  P.box(2, 28, 52, 32, 2, [66, 78, 96], [44, 54, 70]);           // bar rail
  P.ell(28, 25, 3, 1.4, [255, 208, 140], [220, 160, 90]);         // warm counter lamp
});
// bar stool — pairs with the bar so the tavern seats people
const INT_STOOL = paintSurface(14, 18, (P) => {
  P.ell(7, 3, 5, 2.4, [210, 150, 80], [150, 100, 52]);            // amber seat pad
  P.box(6, 5, 8, 15, 0, [110, 124, 148], [70, 82, 104]);          // stem
  P.box(3, 15, 11, 17, 1, [90, 104, 126], [56, 66, 84]);          // footring
  P.ell(7, 5, 1.4, 1, [90, 228, 216], [40, 140, 160]);           // teal collar
});
// shop shelf-wall — stocked crate rows: the shop looks like commerce, not storage
const INT_SHELF = paintSurface(48, 38, (P) => {
  P.box(2, 2, 44, 36, 2, [58, 70, 88], [38, 48, 64]);            // slate frame
  [8, 17, 26].forEach(sy => P.box(3, sy + 8, 43, sy + 9, 0, [110, 124, 148], [70, 82, 104])); // boards
  // merchandise: produce crates + tins in colony warm/cream
  [[5, 10], [12, 11], [19, 10], [26, 11], [33, 10], [5, 19], [14, 20], [23, 19], [32, 20], [5, 28], [12, 28], [19, 29]].forEach(([mx, my], i) => {
    const c = i % 3 === 0 ? [255, 200, 120] : i % 3 === 1 ? [230, 224, 204] : [150, 226, 150];
    P.box(mx, my, mx + 4, my + 5, 1, c, [Math.round(c[0] * 0.55), Math.round(c[1] * 0.55), Math.round(c[2] * 0.55)]);
  });
  P.box(2, 34, 44, 36, 1, [90, 228, 216], [40, 140, 160]);      // teal base glow strip
});
// ranch livestock pen — low teal rails + feed trough; ranch reads as animal space
const INT_PEN = paintSurface(52, 26, (P) => {
  P.box(1, 4, 50, 5, 1, [90, 228, 216], [40, 140, 160]);         // top rail
  P.box(1, 12, 50, 13, 1, [90, 228, 216], [40, 140, 160]);       // mid rail
  [4, 16, 30, 46].forEach(px => P.box(px, 2, px + 2, 18, 1, [78, 90, 110], [50, 60, 78])); // posts
  P.box(18, 15, 34, 22, 2, [110, 124, 148], [70, 82, 104]);      // feed trough
  P.box(19, 16, 33, 18, 0, [226, 196, 130], [180, 150, 90]);     // feed grain
});
// exchange holo-table — a trade board projection: distinct from the shop counter
const INT_HOLOTABLE = paintSurface(44, 30, (P) => {
  P.box(6, 14, 38, 28, 3, [62, 74, 92], [42, 52, 68]);            // slate pedestal
  P.box(4, 12, 40, 14, 1, [90, 228, 216], [40, 140, 160]);       // teal rim
  P.ell(22, 6, 14, 6, [58, 160, 190], [30, 90, 130]);            // holo projection disc
  P.ell(22, 6, 9, 3.4, [120, 230, 235], [60, 160, 180]);          // inner holo
  P.ell(22, 6, 4, 1.6, [236, 250, 252], [150, 220, 230]);         // market glyph core
  P.ell(14, 5, 1.2, 1.2, [255, 200, 110], [220, 150, 70]);        // amber buy tick
  P.ell(30, 5, 1.2, 1.2, [90, 228, 216], [40, 140, 160]);         // teal sell tick
});


// ═══════════════════════════════════════════════════════════
// COLONY FESTIVAL — Earth Day / Hearthnight plaza kit. The town's big night
// reads as BUILT SPACE: a tech stage, holo stalls, and teal/amber pennants —
// not paper bunting. Same building language as the plaza decking.
// ═══════════════════════════════════════════════════════════
// festival palette: colony teal / cream / amber (matches plaza seam + warm glow)
const FEST_PAL = [
  [96, 226, 220],    // colony teal
  [250, 240, 220],   // cream
  [255, 176, 96],    // warm amber
];

// colony stage — slate platform, teal edge-glow strip, holo sign, support legs
const FEST_STAGE = paintSurface(56, 28, (P) => {
  P.box(0, 14, 56, 26, 4, [58, 68, 88], [34, 42, 58]);             // slate platform
  P.box(0, 12, 56, 14, 1, [86, 100, 122], [56, 66, 84]);           // deck lip
  P.box(2, 15, 54, 16, 1, [90, 228, 216], [40, 140, 160]);         // teal edge glow
  P.box(18, 3, 38, 10, 2, [40, 50, 66], [24, 32, 46]);             // holo sign back
  P.ell(28, 6, 8, 2, [120, 240, 230], [60, 170, 180]);             // teal holo sign
  P.ell(28, 9, 4, 1.5, [255, 224, 150], [220, 180, 110]);          // warm accent
  P.box(6, 26, 10, 28, 1, [40, 48, 64], [26, 34, 48]);             // support leg l
  P.box(46, 26, 50, 28, 1, [40, 48, 64], [26, 34, 48]);            // support leg r
});

// colony food stall — metal frame, cyan-striped awning, glowing counter, dishes
const FEST_STALL = paintSurface(40, 30, (P) => {
  P.box(4, 10, 6, 28, 1, [96, 108, 130], [60, 70, 90]);            // frame post l
  P.box(34, 10, 36, 28, 1, [96, 108, 130], [60, 70, 90]);          // frame post r
  P.box(2, 2, 38, 9, 2, [70, 190, 200], [40, 130, 150]);           // awning cyan stripe
  P.box(2, 4, 38, 6, 1, [240, 246, 250], [200, 210, 220]);         // awning white stripe
  P.box(2, 7, 38, 9, 1, [70, 190, 200], [40, 130, 150]);           // awning cyan stripe
  P.box(6, 16, 34, 24, 3, [120, 130, 150], [80, 88, 106]);         // metal counter
  P.ell(20, 18, 10, 2.5, [90, 228, 216], [40, 140, 160]);          // counter glow
  P.ell(12, 14, 3, 2, [255, 226, 180], [210, 180, 130]);           // warm dish
  P.ell(20, 14, 3, 2, [120, 210, 190], [70, 160, 150]);            // teal dish
  P.ell(28, 14, 3, 2, [255, 218, 158], [220, 168, 110]);           // amber dish
});

// pennant garland flags — one sprite per palette entry (3 variants, themeable)
const FEST_PENNANT = FEST_PAL.map(([r, g, b]) => paintSurface(10, 7, (P) => {
  for (let y = 0; y < 7; y++) {
    const w = Math.max(1, Math.round((7 - y) * 10 / 7));           // tapering pennant
    P.box(0, y, w, y + 1, 0, [r, g, b], [Math.round(r * 0.75), Math.round(g * 0.75), Math.round(b * 0.75)]);
  }
}));

// string-light bulb — warm glow with a soft halo (ADD-blend in the scene)
const FEST_BULB = paintSurface(8, 8, (P) => {
  P.ell(4, 4, 3.2, 3.2, [255, 244, 200], [230, 200, 130]);
  P.ell(4, 4, 1.6, 1.6, [255, 252, 236], [255, 240, 200]);
});

// confetti bits — one sprite per palette entry (tweened in the scene)
const FEST_CONFETTI = FEST_PAL.map(([r, g, b]) => paintSurface(6, 6, (P) => {
  P.box(1, 2, 5, 4, 1, [r, g, b], [Math.round(r * 0.8), Math.round(g * 0.8), Math.round(b * 0.8)]);
}));


// ═══════════════════════════════════════════════════════════
// COLONY TOOL KIT — held-item sprites for the equipped tool (hoe / watering
// can / pickaxe / fishing rod). Drawn beside the player so every craft reads as
// a held tool, and swung on use. All in the same slate+teal colony language.
// ═══════════════════════════════════════════════════════════
const TOOL_HOE = paintSurface(14, 14, (P) => {
  P.box(7, 3, 8, 12, 1, [150, 110, 70], [100, 70, 46]);            // wooden handle
  P.box(4, 0, 11, 3, 1, [96, 108, 130], [60, 70, 90]);             // metal head
  P.box(4, 1, 11, 2, 0, [140, 150, 170], [90, 100, 120]);          // blade highlight
});
const TOOL_WATERING = paintSurface(14, 14, (P) => {
  P.box(4, 7, 11, 12, 2, [90, 150, 160], [56, 104, 118]);          // can body (teal)
  P.box(3, 3, 5, 6, 1, [110, 124, 148], [70, 82, 104]);            // spout
  P.box(5, 2, 11, 3, 1, [110, 124, 148], [70, 82, 104]);           // top handle
  P.ell(8, 9, 3, 1.5, [90, 228, 216], [40, 140, 160]);             // water glint
});
const TOOL_PICKAXE = paintSurface(14, 14, (P) => {
  P.box(6, 3, 7, 12, 1, [150, 110, 70], [100, 70, 46]);            // wooden handle
  P.box(2, 0, 12, 3, 1, [110, 124, 148], [70, 82, 104]);           // pick head
  P.ell(7, 1.5, 4, 1.5, [170, 180, 200], [120, 130, 150]);         // blade
});
const TOOL_ROD = paintSurface(14, 14, (P) => {
  P.box(1, 0, 3, 1, 1, [110, 124, 148], [70, 82, 104]);            // butt
  P.box(2, 0, 11, 1, 0, [96, 108, 130], [60, 70, 90]);             // shaft
  P.box(3, 1, 12, 2, 0, [96, 108, 130], [60, 70, 90]);             // shaft taper
  P.box(12, 1, 13, 2, 1, [110, 124, 148], [70, 82, 104]);          // tip
  P.box(13, 3, 13, 12, 0, [220, 230, 240], [170, 180, 190]);       // line
  P.box(12, 12, 13, 13, 1, [150, 160, 170], [110, 120, 130]);      // hook
});


// ═══════════════════════════════════════════════════════════
// COLONY INTERIOR — the home/shop interior reads as a habitat module: slate
// panelled walls with a teal trim line and a machined metal deck floor, not a
// timber cabin. Tileable 96×24 strips used as the room's wall + floor.
// ═══════════════════════════════════════════════════════════
const INT_WALL = paintSurface(96, 24, (P) => {
  P.box(0, 0, 96, 22, 0, [96, 110, 130], [64, 76, 94]);            // slate wall
  P.box(0, 0, 96, 2, 0, [90, 228, 216], [40, 140, 160]);           // teal trim line
  P.box(0, 21, 96, 23, 0, [70, 82, 100], [52, 62, 78]);            // skirting
  // vertical panel seams (machined, not flat paint)
  P.box(24, 0, 25, 22, 0, [60, 70, 88], [44, 52, 66]);
  P.box(48, 0, 49, 22, 0, [60, 70, 88], [44, 52, 66]);
  P.box(72, 0, 73, 22, 0, [60, 70, 88], [44, 52, 66]);
});
const INT_FLOOR = paintSurface(96, 24, (P) => {
  P.box(0, 0, 96, 24, 0, [64, 74, 90], [44, 52, 66]);              // metal deck
  P.box(0, 0, 96, 1, 0, [90, 228, 216], [40, 140, 160]);           // teal seam top
  P.box(0, 12, 96, 13, 0, [60, 70, 88], [44, 52, 66]);             // seam mid
  P.box(12, 0, 13, 24, 0, [56, 66, 84], [42, 50, 64]);             // vertical seam
  P.box(36, 0, 37, 24, 0, [56, 66, 84], [42, 50, 64]);
  P.box(60, 0, 61, 24, 0, [56, 66, 84], [42, 50, 64]);
  P.box(84, 0, 85, 24, 0, [56, 66, 84], [42, 50, 64]);
});

// ── QA 0904 Stage 3.3: the light-fixture housing ──
// Interior light pools used to be generic grey ellipses hovering on the deck
// with nothing casting them — light without a visible source reads as a
// rendering artifact. Every pool in buildRoom now hangs under one of these: a
// ceiling stem + trapezoid shade + hot emitter disc, in the colony's
// slate+teal+amber language, so the eye traces the pool back to a lamp.
const INT_CEILING_LIGHT = paintSurface(20, 14, (P) => {
  // Round-3: the shade housing was slate-on-slate (70,82,102 vs wall 58,73,89)
  // and the whole fixture dissolved into the wall band at room scale — the
  // emitter dots floated with no visible lamp. Housing now reads ~2.5x the
  // wall luminance so the silhouette is seen, not inferred.
  P.box(9, 0, 11, 3, 0, [128, 142, 166], [92, 106, 128]);           // ceiling stem
  P.box(4, 3, 16, 6, 1, [150, 166, 190], [110, 126, 150]);          // shade housing
  P.box(3, 6, 17, 7, 0.5, [176, 192, 214], [128, 144, 168]);        // shade rim
  P.box(4, 3, 16, 4, 0.35, [214, 228, 246], [150, 166, 190]);        // housing highlight
  P.ell(10, 8.6, 5.4, 1.8, [255, 226, 164], [226, 168, 96]);       // hot emitter
  P.ell(10, 8.2, 2.4, 1, [255, 248, 224], [255, 226, 164]);        // filament core
});

// ── QA 0904 Stage 3.4: per-room wall dressing ──
// A named holosign plate that goes over each room's service point (SHOP over
// the counter, BAR over the bar, …). Rooms used to be legible only by prop
// archaeology; a lit sign over the trade point is how a real colony marks
// itself. The WORD itself is drawn as real text by the scene over this plate,
// so the plate carries only the housing: slate backing, teal bezel, hang stem,
// and a teal status pip (reads 'open'). No glyph bars — they collided with
// the text label and read as noise.
const INT_SIGNPLATE = paintSurface(44, 14, (P) => {
  P.box(21, 0, 23, 2, 0, [84, 96, 116], [58, 68, 88]);            // hang stem
  P.box(1, 2, 43, 13, 2, [34, 42, 58], [22, 30, 44]);            // slate plate
  P.box(2, 3, 42, 4, 0.5, [70, 200, 200], [40, 140, 160]);       // teal bezel top
  P.box(2, 12, 42, 13, 0.5, [58, 170, 176], [34, 110, 130]);     // teal bezel foot
  P.ell(40, 8, 1.6, 1.6, [120, 224, 216], [60, 150, 158]);       // status pip (teal = open)
});


// ── Ranch / barn building (livestock) ──
// Colony Ranch Module — a slate ranch pod in the SAME building language as the
// kiosk, cantina, and habitat: dark rounded slate hull, signature teal seam trim,
// warm life-glow windows, a sliding ranch door, base plate, and roof beacon.
const BLD_BARN = scale2x(makePaint32((P) => {
  P.ell(16, 30, 13, 3, [30, 40, 56], [22, 30, 44]);                  // ground shadow
  P.box(4, 9, 28, 30, 5, [44, 56, 74], [26, 34, 50]);                // slate ranch hull
  P.box(4, 11, 28, 14, 4, [52, 64, 84], [32, 42, 60]);              // lit cabin band
  P.ell(8, 16, 1.5, 1.5, [255, 224, 160], [220, 168, 108]);         // warm glint a
  P.ell(24, 16, 1.5, 1.5, [255, 228, 170], [214, 182, 132]);        // warm glint b
  P.box(4, 5, 28, 9, 3, [30, 40, 56], [22, 30, 44]);                // cabin cap
  P.ell(16, 9, 11, 1.5, [70, 200, 200], [42, 150, 164]);            // ★ teal seam trim (signature)
  P.box(13, 20, 19, 30, 2, [30, 42, 60], [20, 30, 44]);             // sliding ranch door
  P.ell(16, 25, 3, 4, [100, 224, 220], [60, 160, 172]);             // door glow
  P.box(4, 30, 28, 32, 1, [60, 72, 90], [40, 52, 68]);              // base plate
  P.ell(16, 4.5, 1.7, 1.7, [255, 200, 110], [226, 160, 80]);        // roof beacon
  // silo mast + panel seams (ranch pod reads as a working structure)
  // QA 0904 2.4: beacons no longer float on bare stalks — each rises from a
  // mount collar so it reads as bolted hardware, not a glowing dot on a wire.
  P.box(22, 1, 24, 4, 1, [110, 124, 148], [70, 82, 104]);           // mast
  P.box(21, 4, 25, 5, 1, [86, 98, 120], [56, 68, 90]);              // mount collar
  P.ell(23, 1.6, 1.4, 1.4, [255, 224, 160], [226, 168, 108]);       // mast light
  P.box(8, 16, 9, 28, 1, [36, 46, 62], [24, 32, 46]);
  P.box(22, 16, 23, 28, 1, [36, 46, 62], [24, 32, 46]);
}));

// Colony Barracks — dormitory pod where the villagers live. Same building
// language as the others: slate dormitory hull, a row of warm bunk windows,
// teal seam trim, sliding barracks door, roof beacon. Reads as housing.
const BLD_BARRACKS = scale2x(makePaint32((P) => {
  P.box(3, 8, 29, 31, 5, [44, 56, 74], [26, 34, 50]);            // dormitory hull
  P.box(4, 3, 28, 8, 1, [30, 38, 54], [22, 30, 44]);            // sign housing
  P.ell(16, 5, 8, 2, [120, 240, 232], [52, 158, 170]);          // teal holo sign
  [7, 12, 17, 22, 27].forEach(wx => P.ell(wx, 15, 1.6, 2.2, [255, 224, 160], [220, 168, 108])); // bunk windows
  P.box(12, 22, 20, 31, 2, [30, 42, 60], [20, 30, 44]);         // sliding door
  P.ell(16, 26, 2.5, 3, [100, 224, 220], [60, 160, 170]);       // door glow
  P.box(3, 30, 29, 32, 1, [60, 72, 90], [40, 52, 68]);          // base plate
  // QA 0904 2.4: the beacon used to hover at the very top of the frame with no
  // mast under it — it now rises off the hull on a strut with a mount collar.
  P.box(28, 2, 30, 9, 0.5, [96, 108, 130], [64, 76, 98]);       // beacon strut
  P.box(26, 8, 32, 9, 0.5, [86, 98, 120], [56, 68, 90]);        // mount collar
  P.ell(29, 1.6, 1.4, 1.4, [255, 200, 110], [226, 160, 80]);    // roof beacon
  P.box(5, 9, 7, 10, 1, [56, 68, 86], [40, 50, 66]);            // vent slot
}));

// ── stardust pond (fishing spot) ──
const DECOR_POND = mkSprite(`
...wwwwwwww...
..wWwWwWwWwW..
.wWwwwwwwwwww.
.WwwwwwwwwwwwW.
.wWwwWwwwwWwWw.
.WwwwWwwwWwwWw.
.wWwwwwwwwwwwW.
..wWwWwWwWwW..
...wwwwwwww...
`, { w: [86, 154, 185], W: [128, 196, 216] }, 1);

// ══ COLONY DECOR — space-colony props for the town (read as "built world") ══
// Solar array — a tilted teal photovoltaic panel on a dark mount (clean tech).
const COLONY_SOLAR = createSurface(20, 18, (s) => {
  s.rect(2, 4, 16, 9, [40, 52, 76]);                 // panel backing
  s.rect(2, 4, 16, 9, [58, 128, 150]);               // glass wash
  s.rect(2, 4, 16, 1, [90, 196, 214]);               // top specular
  s.rect(2, 12, 16, 1, [34, 88, 104]);               // bottom shade
  for (let x = 6; x < 18; x += 4) s.rect(x, 4, 1, 9, [30, 70, 88]);   // cell seams
  s.rect(8, 13, 4, 4, [52, 60, 76]);                 // mount
  s.rect(7, 17, 6, 1, [40, 46, 60]);                 // base
});

// Colony antenna — a slender comms mast with a pulsing teal beacon.
const COLONY_ANTENNA = createSurface(16, 20, (s) => {
  s.rect(7, 4, 2, 14, [96, 108, 132]);               // mast
  s.rect(6, 3, 4, 2, [56, 68, 92]);                  // top cradle
  s.rect(5, 1, 6, 2, [90, 224, 220]);                // teal beacon
  s.rect(4, 18, 8, 2, [60, 70, 88]);                 // base
  s.rect(3, 17, 10, 1, [44, 52, 68]);
});

// Colony cargo crate — a teal-striped supply box (distinct from farm barrels).
const COLONY_CRATE = mkSprite(`
................
.....MMMMMM.....
...MMTTTTTTMM...
..MTTCCCCCCTTM..
..MTCCCCCCCCCT..
..MTCCCCCCCCCT..
..MTCCCCCCCCCT..
..MTTTTTTTTTTT..
..MTCCCCCCCCCT..
..MTCCCCCCCCCT..
..MTTTTTTTTTTT..
..MTCCCCCCCCCT..
...MMTTTTTTMM...
.....MMMMMM.....
................
................
`, { M: [96, 108, 132], T: [68, 78, 100], C: [110, 214, 214] }, 1);

// Colony holo-sign — a floating teal info panel on a slim post (town signage).
const COLONY_HOLOSIGN = createSurface(18, 14, (s) => {
  s.rect(8, 8, 2, 5, [72, 84, 108]);                 // post
  s.rect(3, 1, 12, 7, [26, 38, 56]);                 // sign housing
  s.rect(4, 2, 10, 5, [70, 196, 196]);               // holo panel
  s.rect(5, 3, 3, 1, [150, 240, 240]);               // text glint a
  s.rect(9, 3, 3, 1, [150, 240, 240]);               // text glint b
  s.rect(8, 13, 2, 1, [52, 60, 78]);                 // foot
});

// ═══════════════════════════════════════════════════════════
// PORTRAITS — EarthBound-style speech-box faces (40×48, 3 mouth frames)
// One portrait per NPC, drawn from their suit color + a per-NPC config.
// frame 0 = mouth closed, 1 = talking, 2 = blabbing — scenes cycle the
// frames fast while the dialogue types out (the classic EarthBound "blab").
// ═══════════════════════════════════════════════════════════
const PSKIN = [238, 202, 168];
const PSKIN2 = [226, 184, 152];
const PSKIN3 = [252, 208, 180];
const PMOUTH = [176, 92, 72];
const PMOUTH_T = [232, 168, 118];
const PMETAL = [206, 214, 230];
const PMETAL_S = [166, 178, 200];

// `expr` drives the brow ANGLE + eye SHAPE + mouth CURVE (QA 0904 Stage 5):
// every portrait used to share one identical eye/brow/mouth geometry, so the
// whole cast read as the same flat face wearing different wigs. Each value is
// a real mood the character's dialogue is written in.
const PORTRAIT_CFG = {
  nova:  { robot: true, bot: 'welder', visor: [255, 168, 88], glow: [255, 232, 190] },
  luna:  { skin: NPC_SKIN.luna, hair: [110, 98, 150], style: 'long', expr: 'kind' },
  zephyr:{ skin: NPC_SKIN.zephyr, hair: [108, 150, 84],  style: 'spiky', expr: 'bright' },
  vega:  { skin: NPC_SKIN.vega, hair: [166, 106, 138], style: 'bob', star: true, expr: 'sharp' },
  quasar:{ skin: NPC_SKIN.quasar, hair: [190, 192, 200], style: 'bald', beard: true, expr: 'gruff' },
  rhea:  { skin: NPC_SKIN.rhea, hair: [150, 100, 76],  style: 'bun', expr: 'worry' },
  astra: { skin: NPC_SKIN.astra, hair: [94, 116, 168],  style: 'short', glasses: true, expr: 'clever' },
  orion: { skin: NPC_SKIN.orion, hair: [196, 108, 72],  style: 'spiky', expr: 'sharp' },
  comet: { skin: NPC_SKIN.comet, hair: [106, 168, 164], style: 'long', patch: true, expr: 'dreamy' },
  cora:  { robot: true, bot: 'propbot', visor: [128, 255, 136], glow: [226, 255, 216], pin: true },
};

// hairstyle drawer takes (s, P) — called over the skin head, so later rects
// overlap the face it already painted.
const HUMAN_STYLES = {
  short(s, P) {
    s.rect(8, 4, 24, 5, P.hair);
    s.rect(6, 8, 3, 6, P.hair); s.rect(31, 8, 3, 6, P.hair);
  },
  spiky(s, P) {
    s.rect(8, 4, 24, 5, P.hair);
    s.rect(9, 1, 3, 3, P.hair); s.rect(14, 0, 3, 5, P.hair);
    s.rect(19, 1, 3, 4, P.hair); s.rect(24, 0, 3, 5, P.hair); s.rect(28, 2, 3, 3, P.hair);
  },
  bob(s, P) {
    s.rect(8, 4, 24, 6, P.hair);
    s.rect(6, 5, 3, 16, P.hair); s.rect(31, 5, 3, 16, P.hair);
  },
  long(s, P) {
    s.rect(8, 4, 24, 5, P.hair);
    s.rect(4, 7, 5, 20, P.hair); s.rect(31, 7, 5, 20, P.hair);
  },
  bun(s, P) {
    s.rect(8, 4, 24, 5, P.hair);
    s.rect(13, 1, 14, 7, P.hair);
    s.rect(6, 5, 3, 12, P.hair); s.rect(31, 5, 3, 12, P.hair);
  },
  bald(s, P) {
    s.rect(8, 4, 24, 3, P.hair);
    s.rect(8, 6, 2, 5, P.hair); s.rect(30, 6, 2, 5, P.hair);
  },
};

function mkPortraitCFG(id, baseRGB) {
  const c = PORTRAIT_CFG[id] || {};
  const skin = c.skin || PSKIN;
  const P = {
    suit: baseRGB, suitLt: tint(baseRGB, 0.22), suitSh: shade(baseRGB, 0.6),
    skin, skinSh: shade(skin, 0.82),
    hair: c.hair || [120, 100, 90], style: c.style || 'short',
    eye: shade(skin, 0.22), eyeHi: [255, 255, 255],
    brow: shade(skin, 0.48), browDark: shade(c.hair || [120, 100, 90], 0.55),
    blush: [240, 150, 150],
    robot: !!c.robot, bot: c.bot || null,
    visor: c.visor || [120, 240, 240], glow: c.glow || [230, 255, 255],
    metal: PMETAL, metalS: PMETAL_S, metalHi: [240, 246, 255],
    beard: c.beard ? [206, 206, 214] : null,
    expr: c.expr || (LOOK[id] && LOOK[id].mood) || 'calm',   // lockstep with the world sprite face
    star: c.star, patch: c.patch, pin: c.pin, glasses: c.glasses,
  };
  return P;
}

function drawPortrait(s, frame, P) {
  // shoulders / torso — the NPC's suit color
  s.rect(1, 35, 38, 13, P.suit);
  s.rect(1, 35, 38, 1, P.suitLt);
  s.rect(1, 46, 36, 2, P.suitSh);
  s.rect(13, 35, 14, 2, P.suitLt);            // collar trim
  // neck
  s.rect(16, 28, 8, 7, P.skinSh);
  // head base (metal for robots)
  const headCol = P.robot ? P.metal : P.skin;
  const faceSh = P.robot ? P.metalS : P.skinSh;
  s.rect(8, 5, 24, 26, headCol);
  s.rect(8, 27, 24, 3, faceSh);               // jaw
  s.rect(5, 9, 3, 8, headCol); s.rect(32, 9, 3, 8, headCol); // ears

  if (P.robot) {
    if (P.bot === 'welder') {
      // NOVA — industrial head: wide armoured helmet plate, single hot amber
      // welding visor slit, side intakes, spark antenna, forge glow on the jaw
      s.rect(8, 4, 24, 2, P.metalHi);                       // helmet crown highlight
      s.rect(6, 6, 28, 20, P.metal);
      s.rect(6, 6, 28, 2, P.metalHi);
      s.rect(6, 22, 28, 4, P.metalS);                        // chin plate
      s.rect(3, 12, 3, 10, P.metalS); s.rect(34, 12, 3, 10, P.metalS); // intakes
      s.rect(4, 14, 1, 6, PMETAL_S); s.rect(35, 14, 1, 6, PMETAL_S);
      // hot single visor slit with a scalar pupil bar — reads as a welder mask
      s.rect(9, 13, 22, 7, [40, 26, 18]);
      s.rect(10, 14, 20, 5, P.visor);
      s.rect(10, 14, 20, 2, P.glow);
      s.rect(22, 15, 3, 3, [255, 244, 210]);                // hot core
      s.rect(12, 16, 4, 1, [120, 60, 26]);                   // slit shutter bars
      s.rect(17, 16, 4, 1, [120, 60, 26]);
      // spark antenna (off-centre, live spark)
      s.rect(26, 0, 2, 5, P.metalS); s.rect(25, 0, 4, 2, P.visor);
      s.rect(26, 1, 1, 1, [255, 236, 170]);
      // forge glow bleeding onto the cheek plates
      s.rect(8, 21, 4, 2, [180, 96, 44]); s.rect(28, 21, 4, 2, [180, 96, 44]);
      // rivet row along the jaw plate
      for (let i = 0; i < 4; i++) s.rect(10 + i * 6, 24, 1, 1, P.metalHi);
      // vent grill mouth — animates per frame
      s.rect(15, 20, 10, 5, [30, 34, 48]);
      if (frame === 0) { for (let i = 0; i < 3; i++) s.rect(16, 21 + i * 2, 8, 1, P.metalS); }
      else if (frame === 1) { s.rect(16, 21, 8, 2, P.visor); s.rect(16, 23, 8, 2, [30, 34, 48]); }
      else { s.rect(16, 21, 8, 4, P.visor); s.rect(18, 23, 4, 2, P.glow); }
      return;
    }
    // CORA — soft companion bot: rounded dome shell, twin friendly optics,
    // propeller fin, cheek lights, snack pin — deliberately NOT the same head as nova
    s.rect(9, 4, 22, 22, P.metal);
    s.rect(12, 3, 16, 2, P.metal); s.rect(14, 2, 12, 1, P.metalHi);      // dome top
    s.rect(9, 4, 22, 2, P.metalHi);                                        // dome highlight
    s.rect(9, 22, 22, 3, P.metalS);                                        // soft chin band
    // propeller fin
    s.rect(18, 0, 3, 3, P.metalS); s.rect(13, 0, 5, 2, P.visor); s.rect(21, 0, 5, 2, P.glow);
    // twin round optics with irises + glints (friendly, alive — not a slit)
    s.rect(11, 11, 7, 8, [26, 44, 40]); s.rect(22, 11, 7, 8, [26, 44, 40]);
    s.rect(12, 12, 5, 6, P.visor);  s.rect(23, 12, 5, 6, P.visor);
    s.rect(13, 13, 3, 4, P.glow);   s.rect(24, 13, 3, 4, P.glow);
    s.rect(13, 13, 2, 2, [255, 255, 255]); s.rect(24, 13, 2, 2, [255, 255, 255]);
    s.rect(13, 15, 2, 2, [20, 60, 54]);  s.rect(24, 15, 2, 2, [20, 60, 54]); // pupils
    // cheek status lights
    s.rect(8, 18, 2, 2, [255, 168, 96]); s.rect(30, 18, 2, 2, P.visor);
    // smile grille — animates per frame (open happy mouth, not a slot)
    s.rect(15, 20, 10, 4, [22, 40, 38]);
    if (frame === 0) { s.rect(16, 22, 8, 2, P.visor); s.rect(17, 21, 6, 1, P.glow); }
    else if (frame === 1) { s.rect(16, 21, 8, 3, P.visor); s.rect(17, 22, 6, 1, P.glow); }
    else { s.rect(16, 21, 8, 4, P.visor); s.rect(17, 22, 6, 2, [255, 255, 255]); }
    if (P.pin) { s.rect(27, 39, 5, 3, [250, 210, 80]); s.rect(28, 40, 3, 1, [255, 240, 170]); }
    return;
  }

  // ── human face ──
  (HUMAN_STYLES[P.style] || HUMAN_STYLES.short)(s, P);
  if (P.star) { s.rect(24, 2, 8, 8, [250, 214, 84]); s.rect(27, 4, 2, 4, [250, 244, 180]); }
  if (P.beard) { s.rect(15, 24, 10, 4, P.beard); s.rect(17, 27, 6, 3, P.beard); }
  // ── eyes + brows + mouth, all shaped by P.expr (QA 0904 Stage 5) ──
  // one geometry shared by the whole cast = a flat, dead cast; the mood is now
  // drawn, not implied by a hair-colour swap.
  const E = P.expr;
  // brows: angle + height carry most of the read (inner-up = worried,
  // inner-down/low = gruff or stern, high + arched = bright/dreamy)
  const brow = (x, innerHi, lift) => {
    const y = 11 - lift;
    if (innerHi > 0) { s.rect(x, y + 1, 5, 1, P.browDark); s.rect(x + 2, y, 3, 1, P.browDark); }
    else if (innerHi < 0) { s.rect(x, y, 5, 1, P.browDark); s.rect(x + 2, y + 1, 3, 1, P.browDark); }
    else { s.rect(x, y, 5, 1, P.browDark); }
  };
  if (E === 'worry')  { brow(11, 1, 1); brow(24, 1, 1); }
  else if (E === 'gruff' || E === 'sharp') { brow(11, -1, 1); brow(24, -1, 1); }
  else if (E === 'bright' || E === 'dreamy') { brow(11, 0, 2); brow(24, 0, 2); }
  else if (E === 'clever') { brow(11, 0, 0); brow(24, 1, 2); }
  else { brow(11, 0, 0); brow(24, 0, 0); }
  // eyes: size + openness per mood
  const eh = E === 'bright' ? 7 : E === 'dreamy' ? 7 : E === 'sharp' ? 4 : E === 'gruff' ? 4 : 6;
  const ew = E === 'sharp' ? 6 : 5;
  const ey = 12 + (6 - eh);
  s.rect(12, ey, ew, eh, P.eye); s.rect(23, ey, ew, eh, P.eye);
  s.rect(13, ey + 1, 2, 2, P.eyeHi); s.rect(24, ey + 1, 2, 2, P.eyeHi);
  if (E === 'bright' || E === 'dreamy') { s.rect(13, ey + 4, 1, 1, [210, 226, 255]); s.rect(24, ey + 4, 1, 1, [210, 226, 255]); }
  if (E === 'worry') { s.rect(12, ey - 1, ew, 1, P.skinSh); s.rect(23, ey - 1, ew, 1, P.skinSh); } // tired lid
  if (E === 'clever') { s.rect(23, ey, ew, 1, P.skinSh); }                                          // one narrowed eye
  s.rect(19, 16, 2, 2, P.skinSh);              // nose
  if (E !== 'gruff') { s.rect(10, 17, 3, 2, P.blush); s.rect(27, 17, 3, 2, P.blush); } // blush
  if (P.glasses) {
    s.rect(9, 12, 12, 7, [198, 204, 216]);
    s.rect(20, 12, 12, 7, [198, 204, 216]);
    s.rect(9, 12, 12, 2, P.browDark); s.rect(20, 12, 12, 2, P.browDark);
  }
  if (P.patch) {
    s.rect(23, 12, 9, 9, [212, 208, 196]);       // eyepatch over right eye
    s.rect(20, 16, 5, 2, [96, 100, 112]);        // strap across face
  }
  // mouth — the "blab" frames, plus an expression-specific resting shape so
  // the closed-mouth frame is not one geometry for the whole cast.
  if (frame === 0) {
    if (E === 'kind' || E === 'bright') {                 // warm curved smile
      s.rect(17, 22, 1, 1, PMOUTH); s.rect(18, 23, 5, 1, PMOUTH); s.rect(22, 22, 1, 1, PMOUTH);
    } else if (E === 'sharp' || E === 'gruff') {           // deadpan flat line
      s.rect(17, 22, 6, 1, PMOUTH);
    } else if (E === 'worry') {                            // tight, off-centre
      s.rect(18, 22, 5, 1, PMOUTH); s.rect(18, 23, 2, 1, PMOUTH);
    } else if (E === 'clever') {                           // asymmetric smirk
      s.rect(18, 23, 4, 1, PMOUTH); s.rect(22, 22, 2, 1, PMOUTH);
    } else {
      s.rect(18, 22, 4, 1, PMOUTH);                        // calm neutral
      s.rect(17, 23, 6, 1, P.skinSh);
    }
  } else if (frame === 1) {
    s.rect(16, 21, 8, 1, P.skinSh);                        // top lip
    s.rect(17, 22, 6, E === 'bright' ? 4 : 3, PMOUTH);    // open
  } else {
    s.rect(16, 21, 8, 1, P.skinSh);
    s.rect(16, 22, 8, 4, PMOUTH);                          // wide open
    s.rect(18, 24, 4, 2, PMOUTH_T);                         // tongue
  }
}

// id → [frame0, frame1, frame2]
const PORTRAITS = {};
for (const [id, col] of Object.entries(NPC_COLORS)) {
  const P = mkPortraitCFG(id, hexRGB(col));
  PORTRAITS[id] = [0, 1, 2].map((f) => createSurface(40, 48, (s) => drawPortrait(s, f, P)));
}

// Smooth 2× supersample — doubles a canvas with a soft box-blur feather so the
// world renders as rich high-res art (no 2px chunkiness), matching the modern
// painterly direction. Screen-space fx/portraits are left untouched.
function upscale2x(src) {
  // SMOOTH 2x UPSCALE (bilinear): samples each output pixel's color from its
  // 2x2 source neighborhood with fractional weights, so edges stay soft and
  // painterly instead of hard 2px blocks. Kills the CRT/grid look; preserves
  // the original palette hues. Works headless (via _ctx.data) and in browser.
  const w = src.width, h = src.height, W = w * 2, H = h * 2;
  return createSurface(W, H, (s) => {
    const ctx = s.canvas.getContext('2d');
    const img = ctx.createImageData(W, H);
    for (let y = 0; y < H; y++) {
      const sy = (y - 0.5) / 2, y0 = Math.max(0, Math.floor(sy)), y1 = Math.min(h - 1, y0 + 1);
      const fy = Math.max(0, Math.min(1, sy - y0));
      for (let x = 0; x < W; x++) {
        const sx = (x - 0.5) / 2, x0 = Math.max(0, Math.floor(sx)), x1 = Math.min(w - 1, x0 + 1);
        const fx = Math.max(0, Math.min(1, sx - x0));
        const A = px(src, x0, y0), B2 = px(src, x1, y0), C2 = px(src, x0, y1), Dd = px(src, x1, y1);
        const o = (y * W + x) * 4;
        for (let k = 0; k < 4; k++) {
          const top = A[k] * (1 - fx) + B2[k] * fx;
          const bot = C2[k] * (1 - fx) + Dd[k] * fx;
          img.data[o + k] = (top * (1 - fy) + bot * fy) | 0;
        }
      }
    }
    ctx.putImageData(img, 0, 0);
  });
}

// ── Tree sprites (vegetation for depth & scale) ──
function drawCirc(s, cx, cy, r, col) {
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    if (dx * dx + dy * dy <= r * r) s.px(cx + dx, cy + dy, col);
  }
}
// leafy canopy tree — layered foliage with a sunlit top, warm trunk
const treeLeaf = createSurface(36, 42, (s) => {
  const trunk = [124, 90, 62], trunkS = [92, 66, 46];
  s.rect(16, 20, 4, 20, trunk); s.rect(17, 36, 3, 4, trunkS);
  const mid = [96, 160, 108], under = [70, 126, 92], lit = [156, 212, 148], sun = [196, 236, 178];
  const clumps = [[18, 8, 9], [9, 14, 7], [27, 14, 7], [18, 4, 7], [12, 7, 6], [24, 7, 6], [18, 14, 8]];
  for (const [cx, cy, r] of clumps) drawCirc(s, cx, cy + 4, r, under);
  for (const [cx, cy, r] of clumps) drawCirc(s, cx, cy, r - 1, mid);
  drawCirc(s, 14, 6, 5, lit); drawCirc(s, 21, 7, 4, lit); drawCirc(s, 17, 4, 3, sun);
  s.rect(12, 38, 12, 3, [40, 52, 44]); s.rect(14, 39, 8, 2, [34, 44, 40]);
});
// stardust blossom tree — lavender canopy (colony cosmetic accents kept)
const treeBloom = createSurface(32, 38, (s) => {
  const trunk = [112, 80, 56], trunkS = [82, 58, 40];
  s.rect(14, 18, 4, 17, trunk); s.rect(15, 32, 3, 3, trunkS);
  const blo = [196, 170, 200], bloD = [152, 120, 158], bloL = [234, 200, 224], cr = [226, 200, 130];
  const clumps = [[16, 6, 7], [8, 10, 5], [24, 10, 5], [16, 13, 7], [12, 4, 4], [20, 4, 4]];
  for (const [cx, cy, r] of clumps) drawCirc(s, cx, cy + 4, r, bloD);
  for (const [cx, cy, r] of clumps) drawCirc(s, cx, cy, r - 1, blo);
  drawCirc(s, 13, 5, 4, bloL); drawCirc(s, 20, 6, 3, bloL);
  drawCirc(s, 16, 2, 2, cr); drawCirc(s, 20, 10, 2, cr);
  s.rect(11, 34, 10, 3, [42, 40, 48]); s.rect(13, 35, 6, 2, [34, 32, 40]);
});

// ── Alien envoys — eight non-human silhouettes + animated signal portraits ──
function alienRGB(hex) { return [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255]; }
function makeAlienSprite(alien) {
  const B = alienRGB(alien.palette.body), L = alienRGB(alien.palette.light);
  const D = alienRGB(alien.palette.dark), S = alienRGB(alien.palette.signal);
  return createSurface(48, 56, (s) => {
    s.rect(10, 50, 28, 3, D);
    if (alien.form === "archive") { s.rect(13, 6, 22, 43, D); s.rect(16, 9, 16, 37, B); s.rect(19, 14, 10, 2, S); s.rect(22, 22, 4, 18, L); }
    else if (alien.form === "spore") { s.rect(20, 22, 8, 28, D); s.rect(7, 10, 34, 16, B); s.rect(12, 6, 24, 13, L); s.rect(15, 14, 4, 4, S); s.rect(29, 12, 3, 3, S); }
    else if (alien.form === "machine") { s.rect(18, 8, 12, 39, B); s.rect(8, 14, 32, 6, L); s.rect(12, 25, 24, 18, D); s.rect(20, 29, 8, 8, S); s.rect(23, 2, 2, 8, S); }
    else if (alien.form === "tide") { s.rect(17, 8, 14, 39, B); s.rect(4, 18, 15, 21, L); s.rect(29, 18, 15, 21, L); s.rect(14, 39, 20, 11, D); s.rect(20, 15, 3, 4, S); s.rect(27, 15, 3, 4, S); }
    else if (alien.form === "brood") { s.rect(13, 15, 22, 32, B); s.rect(8, 21, 8, 22, D); s.rect(33, 21, 8, 22, D); s.rect(14, 7, 5, 12, L); s.rect(29, 7, 5, 12, L); s.rect(20, 18, 3, 3, S); s.rect(27, 18, 3, 3, S); }
    else if (alien.form === "crown") { s.rect(14, 16, 20, 33, B); s.rect(10, 10, 5, 12, L); s.rect(18, 4, 5, 14, L); s.rect(27, 7, 5, 12, L); s.rect(18, 21, 14, 5, D); s.rect(21, 22, 8, 3, S); }
    else if (alien.form === "ember") { s.rect(17, 13, 14, 36, B); s.rect(9, 24, 10, 17, D); s.rect(29, 20, 10, 21, D); s.rect(20, 4, 8, 17, L); s.rect(22, 18, 4, 17, S); }
    else { s.rect(14, 12, 20, 36, B); s.rect(9, 18, 30, 20, L); s.rect(13, 22, 22, 12, D); s.rect(18, 25, 12, 6, S); s.rect(20, 6, 8, 9, L); }
  });
}
function makeAlienPortrait(alien, frame) {
  const B = alienRGB(alien.palette.body), L = alienRGB(alien.palette.light);
  const D = alienRGB(alien.palette.dark), S = alienRGB(alien.palette.signal);
  return createSurface(40, 48, (s) => {
    s.rect(2, 34, 36, 14, D); s.rect(7, 7, 26, 29, B);
    if (alien.form === "spore") { s.rect(3, 5, 34, 13, L); s.rect(9, 2, 22, 8, B); }
    else if (alien.form === "archive") { s.rect(10, 2, 20, 34, D); s.rect(14, 6, 12, 27, B); }
    else if (alien.form === "machine") { s.rect(4, 14, 32, 8, L); s.rect(11, 5, 18, 30, B); }
    else { s.rect(5, 4, 30, 10, L); }
    s.rect(11, 17, 5, 4, S); s.rect(24, 17, 5, 4, S);
    const h = frame === 0 ? 2 : frame === 1 ? 5 : 8; s.rect(15, 26, 10, h, frame ? S : D);
  });
}
const ALIEN_SPRITES = Object.fromEntries(ALIEN_DATA.map((a) => [a.id, makeAlienSprite(a)]));
const ALIEN_PORTRAITS = Object.fromEntries(ALIEN_DATA.map((a) => [a.id, [0, 1, 2].map((f) => makeAlienPortrait(a, f))]));

// ── Texture registry: name → canvas (single source of truth for game.js) ──
// the little tutorial guide droid — a cute round helper that flies ahead to
// show you where to go (robots are people here).
const GUIDE_DROID = paintSurface(26, 28, (P) => {
  P.ell(13, 13, 7, 8.5, [198, 210, 226], [150, 164, 186]);    // shell
  P.ell(13, 12, 5.4, 6.4, [28, 50, 70], [14, 30, 46]);        // face panel
  P.ell(10, 12, 1.4, 1.7, [120, 220, 216], [70, 170, 176]);    // eye glow l
  P.ell(16, 12, 1.4, 1.7, [120, 220, 216], [70, 170, 176]);    // eye glow r
  P.ell(13, 16.5, 2.6, 1.1, [90, 200, 200], [58, 150, 152]);   // smile
  P.ell(6, 22, 3, 3.4, [150, 168, 190], [110, 128, 150]);      // fin l
  P.ell(20, 22, 3, 3.4, [150, 168, 190], [110, 128, 150]);     // fin r
  P.ell(10, 26, 5, 1.4, [120, 138, 160], [84, 100, 120]);     // thruster
  P.ell(13, 1.5, 1.2, 3, [184, 194, 214], [132, 146, 168]);    // antenna
  P.ell(17, 2, 1.3, 1.3, [255, 200, 90], [230, 140, 40]);      // antenna jewel
});
const TEXTURES = {
  'ship.droid': GUIDE_DROID,
  'ranch.cow': RANCH.cow,
  'ranch.chicken': RANCH.chicken,
  'ranch.sheep': RANCH.sheep,
  // interior furniture
  'int.bed': INT_BED,
  'int.table': INT_TABLE,
  'int.window': INT_WINDOW,
  'int.bookcase': INT_BOOKCASE,
  'int.rug': INT_RUG,
  'int.plant': INT_PLANT,
  'int.wall': INT_WALL,
  'int.floor': INT_FLOOR,
  'int.stove': INT_STOVE,
  'int.chest': INT_CHEST,
  'int.door': INT_DOOR,
  'int.counter': INT_COUNTER,
  'int.stall': INT_STALL,
  'int.terminal': INT_TERMINAL,
  'int.barback': INT_BARBACK,
  'int.stool': INT_STOOL,
  'int.shelf': INT_SHELF,
  'int.pen': INT_PEN,
  'int.holotable': INT_HOLOTABLE,
  'int.ceilingLight': INT_CEILING_LIGHT,
  'int.signplate': INT_SIGNPLATE,
  // colony festival kit (Earth Day / Hearthnight plaza)
  'fest.stage': FEST_STAGE,
  'fest.stall': FEST_STALL,
  ...Object.fromEntries(FEST_PENNANT.map((c, i) => [`fest.pennant_${i}`, c])),
  'fest.bulb': FEST_BULB,
  ...Object.fromEntries(FEST_CONFETTI.map((c, i) => [`fest.confetti_${i}`, c])),
  // held tool kit (equipped tool beside the player + use swing)
  'tool.hoe': TOOL_HOE,
  'tool.watering': TOOL_WATERING,
  'tool.pickaxe': TOOL_PICKAXE,
  'tool.rod': TOOL_ROD,
  // ranch + fishing
  'bld.barn': BLD_BARN,
  'bld.barracks': BLD_BARRACKS,
  'decor.pond': DECOR_POND,
  // ground (every GROUND variant auto-registered as tile.<key snake_cased>)
  ...Object.fromEntries(Object.entries(GROUND).map(([k, c]) => [`tile.${toSnake(k)}`, c])),
  // decor
  'decor.fence_post': fencePost,
  'decor.fence_beam_a': fenceBeamA,
  'decor.fence_beam_b': fenceBeamB,
  'decor.lamp': lampPost,
  'decor.lamp_glow': lampGlow,
  'decor.planter': planterBox,
  'decor.barrel_water': barrelWater,
  'decor.barrel_cargo': barrelCargo,
  'decor.bush': bush,
  'decor.tree_leaf': treeLeaf,
  'decor.tree_bloom': treeBloom,
  // colony props — tech world-feel for the town
  'decor.colony_solar': COLONY_SOLAR,
  'decor.colony_antenna': COLONY_ANTENNA,
  'decor.colony_crate': COLONY_CRATE,
  'decor.colony_holosign': COLONY_HOLOSIGN,
  // colony plaza decking (town walkable street)
  'tile.plaza': COLONY_PLAZA,
  // buildings
  'bld.house': houseSprite,
  'bld.house_glow': houseGlowSprite,
  'bld.shop': shopSprite,
  'bld.shop_glow': shopGlow,
  'bld.exchange_a': exchangeA,
  'bld.exchange_b': exchangeB,
  'bld.exchange_glow': exchangeGlow,
  'bld.tavern_a': tavernA,
  'bld.tavern_b': tavernB,
  'bld.tavern_c': tavernC,
  'bld.tavern_glow': tavernGlow,
  // atmosphere
  'fx.planet': planetSprite,
  'fx.nebula': makeNebula(),
  'fx.sky_dusk': makeSky(),
  'fx.fog': makeFog(),
  'fx.meteor': makeMeteor(),
  'decor.alien_flora': makeFlora(),
  'fx.vignette': makeVignette(),
  'fx.sun': sunSprite,
  'fx.moon': moonSprite,
  'fx.cloud': cloudSprite,
  'fx.asteroid': asteroidSprite,
  'fx.scanlines': makeScanlines(),
  'fx.lamp_glow': lampGlow,
  'fx.pool_warm': lightPoolWarm,
  'fx.pool_cool': lightPoolCool,
  'fx.pool_player': lightPoolPlayer,
  'fx.shadow': SHADOW,
  'fx.bld_shadow': BLD_SHADOW,
  // ship planter (used by SpaceshipScene greenhouse)
  'ship.planter': planterBox,
  // player — base keys (32×32) + walk frames
  'player.front': PLAYER_FRONT,
  'player.back': PLAYER_BACK,
  'player.left': PLAYER_LEFT,
  'player.right': PLAYER_RIGHT,
  ...Object.fromEntries(Object.entries(PLAYER_FRAMES).map(([f, c]) => [`player.${f}`, c])),
  // alien envoys and first-contact portraits
  ...Object.fromEntries(Object.entries(ALIEN_SPRITES).map(([id, c]) => [`alien.${id}`, c])),
  ...Object.fromEntries(Object.entries(ALIEN_PORTRAITS).flatMap(([id, fr]) => [
    [`port.${id}_0`, fr[0]], [`port.${id}_1`, fr[1]], [`port.${id}_2`, fr[2]],
  ])),
  // npcs — base keys (32×32, idle) + full 4-dir × 3-frame walk set for errand AI
  ...Object.fromEntries(Object.entries(NPC_SPRITES).map(([id, c]) => [`npc.${id}`, c])),
  ...Object.fromEntries(Object.entries(NPC_FRAMES).flatMap(([id, frs]) => [
    [`npc.${id}_0`, frs[0]], [`npc.${id}_1`, frs[1]], [`npc.${id}_2`, frs[2]],
  ])),
  ...Object.fromEntries(Object.entries(NPC_WALK).flatMap(([id, frames]) =>
    Object.entries(frames).map(([f, c]) => [`npc.${id}_${f}`, c])
  )),
  // portraits — EarthBound speech-box faces (40×48, 3 mouth frames)
  ...Object.fromEntries(Object.entries(PORTRAITS).flatMap(([id, fr]) => [
    [`port.${id}_0`, fr[0]], [`port.${id}_1`, fr[1]], [`port.${id}_2`, fr[2]],
  ])),
  // ship tiles
  ...Object.fromEntries(Object.entries(SHIP_SPRITES).map(([id, c]) => [`ship.${id}`, c])),
  'ship.porthole': portholeSprite,
};

// ── WORLD RESOLUTION BUMP: 2× every in-world texture (terrain, buildings, decor,
//    npcs, player, interiors, ship). Screen-space fx (nebula/sky/fog/vignette/
//    sun/moon/clouds) and dialogue portraits stay native-resolution.
const WORLD_PREFIX = /^(bld\.|decor\.)/;
// (player/npc are authored at full painterly res; excluded from 2x upscale)
for (const k of Object.keys(TEXTURES)) {
  if (WORLD_PREFIX.test(k)) TEXTURES[k] = upscale2x(TEXTURES[k]);
}

export {
  PAL, px, createSurface, mkSprite, padArray, TestCtx, blitSprite, makeHUDSprite, makeGlowDisc,
  GROUND, SHIP_SPRITES, TILE_SPRITES, TEXTURES,
  NPC_SPRITES, NPC_COLORS, NPC_FRAMES, NPC_WALK, PLAYER_PAL, PLAYER_FRAMES,
  PORTRAITS, PORTRAIT_CFG, ALIEN_SPRITES, ALIEN_PORTRAITS,
  fencePost, fenceBeamA, fenceBeamB, lampPost, lampGlow,
  SHADOW, BLD_SHADOW, makeShadow,
  planterBox, barrelWater, barrelCargo, bush,
  COLONY_SOLAR, COLONY_ANTENNA, COLONY_CRATE, COLONY_HOLOSIGN, COLONY_PLAZA,
  FEST_STAGE, FEST_STALL, FEST_PENNANT, FEST_BULB, FEST_CONFETTI, FEST_PAL,
  TOOL_HOE, TOOL_WATERING, TOOL_PICKAXE, TOOL_ROD,
  INT_WALL, INT_FLOOR,
  houseSprite, houseGlowSprite,
  shopSprite, shopGlow, exchangeA, exchangeB, exchangeGlow,
  tavernA, tavernB, tavernC, tavernGlow,
  planetSprite, makeNebula, makeVignette, makeScanlines,
  makeSky, makeFog, makeMeteor, makeFlora, upscale2x,
  HOUSE_C,
};

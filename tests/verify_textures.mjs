// verify_textures.mjs — ensure every texture key referenced in scene code
// exists in the SpriteSystem TEXTURES registry (catches missing-sprite bugs).
//
// Scenes resolve art through AssetTheme roles (`tex('bld.shop')`) rather than
// raw keys. This test:
//   1. resolves every role call in scene code through the active theme,
//   2. also scans for any remaining literal texture keys,
//   3. confirms every resolved key exists in the TEXTURES registry.
import { readFileSync } from 'node:fs';
import { TEXTURES } from '../client/systems/SpriteSystem.js';
import { THEME, tex, texAt, resolveKey } from '../client/systems/AssetTheme.js';

const files = [
  'client/scenes/PlanetScene.js',
  'client/scenes/SpaceshipScene.js',
  'client/scenes/IntroScene.js',
  'client/systems/AssetTheme.js',
];
const registryKeys = new Set(Object.keys(TEXTURES));

// keys of interest: 'tile.*','ship.*','player.*','npc.*','decor.*','bld.*','fx.*'
const KEY_RE = /['"]((?:tile|ship|player|npc|decor|bld|fx|int|alien|port)\.[a-z0-9_]+)['"]/g;
const ROLE_RE = /\b(tex|texAt|resolveKey)\(\s*'([a-z]+\.[a-zA-Z0-9_-]+(?:\.[a-zA-Z0-9_-]+)*)'/g; // hyphens+nested roles: 'fx.nebula-cloud' slipped past the old [\w]+ class and crashed IntroScene.create

let missing = 0;
const seen = new Set();
const locations = {};

function record(key, where) {
  seen.add(key);
  (locations[key] = locations[key] || []).push(where);
}

// 1. Resolve theme-role calls in scene code → texture keys.
for (const f of files) {
  const src = readFileSync(f, 'utf8');
  // strip role-call substrings so the literal scan below doesn't re-flag them
  const stripped = src.replace(ROLE_RE, (_, fn, role) => {
    let key;
    try {
      key = fn === 'resolveKey' ? resolveKey(role) : (fn === 'texAt' ? texAt(role, 0) : tex(role));
    } catch {
      key = `<<UNRESOLVED:${role}>>`;
    }
    record(key, f.replace('client/scenes/', '').replace('client/systems/', ''));
    return '';
  });
  // 2. Any remaining literal texture keys (skip comment lines).
  for (const line of stripped.split('\n')) {
    if (line.trim().startsWith('//')) continue;
    let m;
    while ((m = KEY_RE.exec(line)) !== null) record(m[1], f.replace('client/scenes/', '').replace('client/systems/', ''));
  }
}

// 3. Role values baked into the default theme (the registry contract).
function walk(node, where) {
  for (const v of Object.values(node)) {
    if (typeof v === 'string') record(v, where);
    else if (Array.isArray(v)) v.forEach(x => record(x, where));
    else if (v && typeof v === 'object') walk(v, where);
  }
}
walk(THEME, 'AssetTheme');

console.log(`registry has ${registryKeys.size} keys; scenes reference ${seen.size} distinct keys:\n`);
for (const key of [...seen].sort()) {
  const ok = registryKeys.has(key);
  if (!ok) {
    missing++;
    console.log(`  ✗ MISSING: ${key}  (referenced in ${locations[key].join(', ')})`);
  }
}
if (missing === 0) console.log('  ✓ all referenced keys exist in the registry');
console.log(`\n${missing} missing`);

// ── QA 0904B.9 gate: untilled soil must not be one flat rust slab. Each
//    ridged variant needs ≥2 pixel rows with real contrast against the tile's
//    mean luminance (alternating 2px ridge/furrow rows + value noise).
//    Negative control: this gate FAILS on the old code — 'tile.soil_c' and
//    'tile.soil_d' did not exist in the registry at all. ──
function canvasData(c) {
  if (c._ctx && c._ctx.data) return c._ctx.data;
  return c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
}
function rowContrastRows(canvas, threshold) {
  const d = canvasData(canvas);
  const W = canvas.width, H = canvas.height;
  const rowMean = [];
  for (let y = 0; y < H; y++) {
    let s = 0;
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      s += (d[i] + d[i + 1] + d[i + 2]) / 3;
    }
    rowMean.push(s / W);
  }
  const mean = rowMean.reduce((a, b) => a + b, 0) / rowMean.length;
  return rowMean.filter(m => Math.abs(m - mean) >= threshold).length;
}
const SOIL_VARIANTS = ['tile.soil_b', 'tile.soil_c', 'tile.soil_d'];
for (const k of SOIL_VARIANTS) {
  const c = TEXTURES[k];
  if (!c) { missing++; console.log(`  ✗ MISSING soil variant ${k} (registry)`); continue; }
  const rows = rowContrastRows(c, 9);
  if (rows < 2) {
    missing++;
    console.log(`  ✗ soil variant ${k} has only ${rows} contrast rows (needs ≥2 ridge/furrow rows)`);
  } else {
    console.log(`  ✓ ${k}: ${rows} contrast rows`);
  }
}
const soilEdge = TEXTURES['tile.soil_edge'];
if (!soilEdge) { missing++; console.log('  ✗ MISSING tile.soil_edge (border ring)'); }
else {
  const d = canvasData(soilEdge);
  const coreAlpha = d[(16 * soilEdge.width + 16) * 4 + 3];
  const rimAlpha = d[(0 * soilEdge.width + 0) * 4 + 3];
  if (coreAlpha !== 0 || rimAlpha === 0) {
    missing++;
    console.log(`  ✗ tile.soil_edge rim band wrong (core alpha ${coreAlpha}, rim alpha ${rimAlpha})`);
  } else console.log('  ✓ tile.soil_edge rim band present with transparent core');
}

// ── QA 0904B.8 gate: ship deck must not repeat a per-tile dot motif, and the
//    wall bulkhead must sit ≥10 luminance below the deck so wall vs deck never
//    reads as near-identical flat metal.
//    Negative control: this gate FAILS on the old code — the old deck carried
//    two teal rivet dots per tile (2 dot motifs detected) and the old wall
//    luminance (62.7) sat ABOVE the old deck (63.5), gap 0.8 < 10. ──
const DECK_KEYS = ['ship.floor', 'ship.floorSeamR', 'ship.floorSeamB', 'ship.floorSeamRB'];
function meanLum(cv) {
  const d = canvasData(cv);
  let sum = 0, n = 0;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] > 0) sum += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2], n++;
  }
  return sum / Math.max(1, n);
}
function medianColor(px) {
  const ch = [[], [], []];
  for (const p of px) { ch[0].push(p[0]); ch[1].push(p[1]); ch[2].push(p[2]); }
  return ch.map(v => { v.sort((a, b) => a - b); return v[Math.floor(v.length / 2)]; });
}
function dotMotifs(cv) {
  const d = canvasData(cv), W = cv.width, H = cv.height;
  const flags = new Uint8Array(W * H);
  for (let y = 2; y < H - 2; y++) for (let x = 2; x < W - 2; x++) {
    const ring = [];
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      if (dx === 0 && dy === 0) continue;
      const i = ((y + dy) * W + (x + dx)) * 4;
      if (d[i + 3] > 0) ring.push([d[i], d[i + 1], d[i + 2]]);
    }
    if (ring.length < 20) continue;
    const m = medianColor(ring);
    const i = (y * W + x) * 4;
    const dist = Math.max(Math.abs(d[i] - m[0]), Math.abs(d[i + 1] - m[1]), Math.abs(d[i + 2] - m[2]));
    if (dist > 40) flags[y * W + x] = 1;
  }
  const seen = new Uint8Array(W * H);
  let dots = 0, lineMotifs = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (!flags[y * W + x] || seen[y * W + x]) continue;
    const stack = [[x, y]], cells = [];
    seen[y * W + x] = 1;
    while (stack.length) {
      const [sx, sy] = stack.pop(); cells.push([sx, sy]);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = sx + dx, ny = sy + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        if (flags[ny * W + nx] && !seen[ny * W + nx]) { seen[ny * W + nx] = 1; stack.push([nx, ny]); }
      }
    }
    if (cells.length <= 14) dots++; else lineMotifs++;
  }
  return { dots, lineMotifs };
}
function centerEqualsFill(cv) {
  const d = canvasData(cv), W = cv.width, H = cv.height;
  const cx = Math.floor(W / 2), cy = Math.floor(H / 2);
  const ring = [];
  for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
    if (dx === 0 && dy === 0) continue;
    const i = ((cy + dy) * W + (cx + dx)) * 4;
    if (d[i + 3] > 0) ring.push([d[i], d[i + 1], d[i + 2]]);
  }
  const m = medianColor(ring);
  const ci = (cy * W + cx) * 4;
  return Math.max(Math.abs(d[ci] - m[0]), Math.abs(d[ci + 1] - m[1]), Math.abs(d[ci + 2] - m[2])) <= 4;
}
const deckMean = DECK_KEYS.reduce((a, k) => a + (TEXTURES[k] ? meanLum(TEXTURES[k]) : 0), 0) / DECK_KEYS.length;
const wallTex = TEXTURES['ship.wall'];
if (!wallTex) { missing++; console.log('  ✗ MISSING ship.wall'); }
else {
  const wallMean = meanLum(wallTex);
  const gap = deckMean - wallMean;
  console.log(`  deck mean lum ${deckMean.toFixed(1)}, wall mean lum ${wallMean.toFixed(1)}, gap ${gap.toFixed(1)}`);
  if (gap < 10) { missing++; console.log(`  ✗ wall luminance gap ${gap.toFixed(1)} < 10 (wall must sit ≥10 under the deck)`); }
}
for (const k of DECK_KEYS) {
  const c = TEXTURES[k];
  if (!c) { missing++; console.log(`  ✗ MISSING deck variant ${k}`); continue; }
  const { dots, lineMotifs } = dotMotifs(c);
  const okCenter = centerEqualsFill(c);
  console.log(`  ${k}: dot motifs ${dots}, line motifs ${lineMotifs}, centerEqualsFill ${okCenter}`);
  if (dots > 0) { missing++; console.log(`  ✗ ${k}: ${dots} isolated single-dot motif(s) on the deck`); }
  if (!okCenter) { missing++; console.log(`  ✗ ${k}: centre pixel differs from surrounding fill`); }
}

// [SF46] every NPC portrait has 5 expressions: 3 blab frames + warm + troubled,
// and the reaction faces are actually different art from the neutral frame.
{
  const { NPC_COLORS, px } = await import('../client/systems/SpriteSystem.js');
  for (const id of Object.keys(NPC_COLORS)) {
    for (let f = 0; f < 5; f++) if (!TEXTURES[`port.${id}_${f}`]) { missing++; console.log(`  ✗ MISSING port.${id}_${f}`); }
    const a = TEXTURES[`port.${id}_0`];
    for (const f of [3, 4]) {
      const b = TEXTURES[`port.${id}_${f}`]; if (!a || !b) continue;
      let diff = 0;
      for (let y = 0; y < a.height; y++) for (let x = 0; x < a.width; x++) if (px(a, x, y).join() !== px(b, x, y).join()) diff++;
      if (diff < 12) { missing++; console.log(`  ✗ port.${id}_${f} only differs from _0 by ${diff}px`); }
    }
  }
  console.log(`  portraits: ${Object.keys(NPC_COLORS).length} NPCs × 5 expressions checked`);
}

process.exit(missing > 0 ? 1 : 0);

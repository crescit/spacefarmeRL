// verify_sprites.mjs — objective pixel verification of SpriteSystem (headless)
import * as SS from '../client/systems/SpriteSystem.js';
import { px } from '../client/systems/SpriteSystem.js';
import * as MD from '../client/systems/MapData.js';
import { readFileSync } from 'node:fs';

let pass = 0, fail = 0;
function check(name, cond, detail = '') {
  if (cond) { pass++; }
  else { fail++; console.log(`  ✗ ${name} ${detail}`); }
}
function near(got, [er, eg, eb]) {
  return Math.abs(got[0] - er) <= 8 && Math.abs(got[1] - eg) <= 8 && Math.abs(got[2] - eb) <= 8;
}
// count pixels matching a predicate across a canvas region
function count(c, pred) {
  let n = 0;
  for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) {
    const p = px(c, x, y);
    if (p[3] > 0 && pred(p)) n++;
  }
  return n;
}

const is16 = (c) => c.width === 16 && c.height === 16;
const is32 = (c) => c.width === 32 && c.height === 32;
const isG = (c) => c.width === 32 && c.height === 32; // smooth ground tiles are 32x32

console.log('== GROUND (32x32 seamless) ==');
for (const k of Object.keys(SS.GROUND)) {
  const c = SS.GROUND[k];
  check(`ground.${k} 32x32`, c.width === 32 && c.height === 32, `got ${c.width}x${c.height}`);
}
check('grassA is moss-green turf', (() => { const a = px(SS.GROUND.grassA, 4, 4), b = px(SS.GROUND.grassA, 3, 3); return a[1] > a[0] && a[1] > a[2] && b[1] > b[0] && a[0] < 120; })());
check('grassB is moss-green turf', (() => { const a = px(SS.GROUND.grassB, 4, 4), b = px(SS.GROUND.grassB, 5, 5); return a[1] > a[0] && a[1] > a[2] && b[1] > b[0] && a[0] < 120; })());
check('path is cool colony crete (NOT dirt-brown)', (() => {
  // QA 0904: the feeder trails used to be warm sand-brown ("dirt paths cut
  // through a sci-fi colony"). The contract is now cool machined grey in the
  // slate family; this asserts that and pins the regression OUT of CI forever.
  const p = px(SS.GROUND.path, 8, 8);
  const q = px(SS.GROUND.path, 20, 14);
  const cool = (c) => c[2] >= c[0] - 6 && !(c[0] > c[2] + 24);   // not earth-brown
  return cool(p) && cool(q);
})());
check('path is NOT warm stone (regression guard)', (() => {
  // fail loudly if anyone re-warms the walkway palette back to sand
  let warmPx = 0;
  for (let y = 2; y < 30; y++) for (let x = 2; x < 30; x++) {
    const p = px(SS.GROUND.path, x, y);
    if (p[0] > p[2] + 28 && p[0] > 130) warmPx++;
  }
  return warmPx < 8;
})());
check('grass variants are genuinely distinct (was byte-identical)', (() => {
  // QA 0904: grassA..F all called tile('grass') with no seed — 6 names, one
  // texture ("the variation is fake"). Require every pair to differ visibly.
  const keys = ['grassA', 'grassB', 'grassC', 'grassD', 'grassE', 'grassF'];
  const raw = (k) => { const c = SS.GROUND[k]; return c._ctx ? c._ctx.data : c.getContext('2d').getImageData(0, 0, 32, 32).data; };
  for (let i = 0; i < keys.length; i++) for (let j = i + 1; j < keys.length; j++) {
    const A = raw(keys[i]), B = raw(keys[j]);
    let d = 0;
    for (let p = 0; p < A.length; p += 4) if (A[p] !== B[p] || A[p + 1] !== B[p + 1] || A[p + 2] !== B[p + 2]) d++;
    if (d < 250) return false;   // >=~250 of 1024 px must differ per pair
  }
  return true;
})());
check('water variants are distinct (no flat billboard)', (() => {
  const raw = (c) => c._ctx ? c._ctx.data : c.getContext('2d').getImageData(0, 0, 32, 32).data;
  const A = raw(SS.GROUND.water), B = raw(SS.GROUND.water2), C = raw(SS.GROUND.water3);
  const diff = (X, Y) => { let d = 0; for (let p = 0; p < X.length; p += 4) if (X[p] !== Y[p] || X[p + 1] !== Y[p + 1] || X[p + 2] !== Y[p + 2]) d++; return d; };
  return diff(A, B) > 150 && diff(A, C) > 150;
})());
check('wet_sand tide-line tile exists + reads damp', (() => {
  const w = SS.GROUND.wetSand, s = SS.GROUND.sand;
  if (!w || w.width !== 32 || !s) return false;
  const d = (c) => (c._ctx ? c._ctx.data : c.getContext('2d').getImageData(0, 0, 32, 32).data);
  const stat = (c) => { const a = d(c); let n = 0, r = 0, g = 0, b = 0;
    for (let p = 0; p < a.length; p += 4) { n++; r += a[p]; g += a[p + 1]; b += a[p + 2]; }
    return { r: r / n, g: g / n, b: b / n }; };
  const W = stat(w), S = stat(s);
  // Damp sand is physically (a) DARKER than dry beach sand and (b) relatively
  // COOLER in hue — the warm red/blue spread collapses as water darkens it.
  const darker = (W.r + W.g + W.b) < (S.r + S.g + S.b) * 0.85;
  const cooler = (W.r - W.b) < (S.r - S.b) * 0.7;
  return darker && cooler && w.width === 32;
})());
check('ground tiles clear the contrast floor', (() => {
  // QA gate-blindness fix: a near-flat tile used to pass every check. Require
  // measurable pixel std-dev on the ground family so flat/low-contrast tiles fail.
  const raw = (c) => c._ctx ? c._ctx.data : c.getContext('2d').getImageData(0, 0, 32, 32).data;
  const sd = (c) => { const d = raw(c); let n = 0, s = 0, s2 = 0; for (let p = 0; p < d.length; p += 4) { const l = 0.299 * d[p] + 0.587 * d[p + 1] + 0.114 * d[p + 2]; n++; s += l; s2 += l * l; } const m = s / n; return Math.sqrt(Math.max(0, s2 / n - m * m)); };
  for (const k of ['grassA', 'soil', 'water', 'sand', 'wetSand', 'path']) if (sd(SS.GROUND[k]) < 4) return false;
  return true;
})());
check('water is blue', px(SS.GROUND.water, 5, 5)[2] > px(SS.GROUND.water, 5, 5)[0]);
check('soil warm loam', (() => { const p = px(SS.GROUND.soil, 5, 5); return p[0] > 45 && p[0] < 130 && p[0] > p[2]; })());
check('mature has warm glow', count(SS.GROUND.mature, p => p[0] > 200 && p[1] > 150 && p[2] < 170) >= 8);
check('growing has green', count(SS.GROUND.growing, p => p[1] > p[0] + 40 && p[1] > p[2] + 40) >= 10);

console.log('== DECOR ==');
check('fencePost 16x16', is16(SS.fencePost));
check('fenceBeamA 16x16', is16(SS.fenceBeamA));
check('fenceBeamB 16x16', is16(SS.fenceBeamB));
check('fenceBeamA has cyan', count(SS.fenceBeamA, p => p[2] > 200 && p[1] > 200) > 3);
check('lampPost 16x16', is16(SS.lampPost));
check('lampPost has solar-blue head', count(SS.lampPost, p => p[2] > 180 && p[0] < 120) > 4);
check('lampGlow 16x16', is16(SS.lampGlow));
check('lampGlow center warm', px(SS.lampGlow, 8, 8)[0] > 150);
check('planterBox 16x16', is16(SS.planterBox));
check('planter has wood base', px(SS.planterBox, 8, 5)[0] > 90);
check('barrelWater 16x13', SS.barrelWater.width === 16 && SS.barrelWater.height === 13, `got ${SS.barrelWater.width}x${SS.barrelWater.height}`);
check('barrelCargo 16x13', SS.barrelCargo.width === 16 && SS.barrelCargo.height === 13, `got ${SS.barrelCargo.width}x${SS.barrelCargo.height}`);
check('barrelWater cyan label', count(SS.barrelWater, p => p[2] > 200 && p[1] > 200) > 5);
check('barrelCargo red label', count(SS.barrelCargo, p => p[0] > 180 && p[1] < 120) > 5);
check('bush 16x16', is16(SS.bush));
check('bush purple', count(SS.bush, p => p[0] > 120 && p[2] > 150 && p[1] < 100) > 8);

console.log('== HOUSE (64x60) ==');
const H = SS.houseSprite;
check('house 64x60', H.width === 64 && H.height === 60, `got ${H.width}x${H.height}`);
check('house glass dome shell', count(H, p => p[0] > 40 && p[0] < 160 && p[1] > 100 && p[2] > 120 && p[2] > p[0]) > 120);
check('house warm round window', count(H, p => p[0] > 215 && p[1] > 185 && p[2] > 115) > 40);
check('house metal collar base', count(H, p => p[0] > 40 && p[0] < 90 && p[1] > 50 && p[1] < 100 && p[2] > 60 && p[2] < 115) > 150);
check('house cozy door glow', count(H, p => p[0] > 235 && p[1] > 205 && p[2] > 165) > 25);
check('house teal seam ring', count(H, p => p[0] > 1 && p[0] < 120 && p[1] > 170 && p[2] > 170) > 1);
check('house is rounded organic (few sharp corners)', count(H, p => p[0] > 240 && p[1] > 240 && p[2] > 240) < 60);

check('house airlock teal ring', count(H, p => p[0] < 130 && p[1] > 160 && p[2] > 160) > 8);
check('houseGlow 64x44', SS.houseGlowSprite.width === 64 && SS.houseGlowSprite.height === 44, `got ${SS.houseGlowSprite.width}x${SS.houseGlowSprite.height}`);

console.log('== VILLAGE (32x32) ==');
for (const [k, c] of [['shopSprite', SS.shopSprite], ['exchangeA', SS.exchangeA], ['exchangeB', SS.exchangeB], ['tavernA', SS.tavernA], ['tavernB', SS.tavernB], ['tavernC', SS.tavernC]]) {
  check(`${k} 64x64`, c.width === 64 && c.height === 64, `got ${c.width}x${c.height}`);
}
check('shop dark slate hull', count(SS.shopSprite, p => p[0] > 20 && p[0] < 90 && p[0] < p[2] && p[1] < p[2]) > 40);
check('shop teal holo sign', count(SS.shopSprite, p => p[0] < 140 && p[1] > 180 && p[2] > 170) > 10);
check('shop glass display bay teal', count(SS.shopSprite, p => p[0] < 180 && p[1] > 140 && p[2] > 150 && p[2] > p[0]) > 15);
check('exchangeA teal trade orb', count(SS.exchangeA, p => p[0] < 130 && p[1] > 180 && p[2] > 180 && p[2] > p[0]) > 30);
check('exchangeB teal trade orb', count(SS.exchangeB, p => p[0] < 130 && p[1] > 180 && p[2] > 180 && p[2] > p[0]) > 40);
const sigA = Array.from({ length: 4096 }, (_, i) => px(SS.exchangeA, i % 64, Math.floor(i / 64)).join(',')).join('|');
const sigB = Array.from({ length: 4096 }, (_, i) => px(SS.exchangeB, i % 64, Math.floor(i / 64)).join(',')).join('|');
check('exchange frames differ', sigA !== sigB);
check('tavernA slate hull', count(SS.tavernA, p => p[0] > 25 && p[0] < 95 && p[0] < p[2] && p[2] > 40) > 40);
check('tavernC warm door lamp', count(SS.tavernC, p => p[0] > 195 && p[1] > 150 && p[2] > 85 && p[2] < 150) > 5);
check('tavern warm windows', count(SS.tavernA, p => p[0] > 200 && p[1] > 140 && p[2] < 130) > 12);

console.log('== ATMOSPHERE ==');
check('planet 48x48', SS.planetSprite.width === 48 && SS.planetSprite.height === 48, `got ${SS.planetSprite.width}x${SS.planetSprite.height}`);
check('planet orange body', count(SS.planetSprite, p => p[0] > 180 && p[1] > 80 && p[1] < 170) > 100);
check('planet ring', count(SS.planetSprite, p => near(p, [172, 172, 198])) > 10);
const neb = SS.makeNebula();
check('nebula 256x256', neb.width === 256 && neb.height === 256, `got ${neb.width}x${neb.height}`);
check('nebula has purple', count(neb, p => p[2] > p[0] && p[2] > 50) > 500);

console.log('== SHIP TILES ==');
for (const k of Object.keys(SS.SHIP_SPRITES)) {
  const c = SS.SHIP_SPRITES[k];
  check(`ship.${k} present`, !!c && c.width >= 8, `got ${c ? c.width + 'x' + c.height : 'undefined'}`);
}
// legacy alias still resolves
for (const k of ['soil', 'tilled', 'seeded', 'growing', 'mature', 'path', 'floor', 'wall', 'cryopod', 'console', 'planter', 'door', 'airlock']) {
  check(`TILE.${k} present`, !!SS.TILE_SPRITES[k], '');
}

console.log('== PLAYER / NPC (world art 2x) ==');
const is32p = (c) => c && c.width === 32 && c.height === 32;
const is6480p = (c) => c && c.width === 64 && c.height === 80;
for (const d of ['front', 'back', 'left', 'right']) {
  check(`player ${d} base 64x80 painterly`, is6480p(SS.TEXTURES[`player.${d}`]), `got ${SS.TEXTURES[`player.${d}`]?.width}x${SS.TEXTURES[`player.${d}`]?.height}`);
  for (let f = 0; f < 3; f++) {
    check(`player.${d}_${f} 64x80 painterly`, is6480p(SS.TEXTURES[`player.${d}_${f}`]), `got ${SS.TEXTURES[`player.${d}_${f}`]?.width}x${SS.TEXTURES[`player.${d}_${f}`]?.height}`);
  }
}
// player has orange suit + cyan visor pixels
check('player orange suit', count(SS.TEXTURES['player.front_0'], p => p[0] > 180 && p[1] > 110 && p[1] < 190 && p[2] < 100) > 20);
check('player is human (skin face present)', count(SS.TEXTURES['player.front_0'], p => p[0] > 120 && p[0] < 220 && p[1] < p[0] && p[0] > p[2]) > 200);
// walk frames differ from idle
const pf0 = Array.from({ length: 4096 }, (_, i) => px(SS.TEXTURES['player.front_0'], i % 64, Math.floor(i / 64)).join(',')).join('|');
const pf1 = Array.from({ length: 4096 }, (_, i) => px(SS.TEXTURES['player.front_1'], i % 64, Math.floor(i / 64)).join(',')).join('|');
const pf2 = Array.from({ length: 4096 }, (_, i) => px(SS.TEXTURES['player.front_2'], i % 64, Math.floor(i / 64)).join(',')).join('|');
check('player walk frames differ', pf0 !== pf1 && pf1 !== pf2);
for (const k of Object.keys(SS.NPC_SPRITES)) {
  check(`npc.${k} 64x80 painterly`, is6480p(SS.NPC_SPRITES[k]), `got ${SS.NPC_SPRITES[k].width}x${SS.NPC_SPRITES[k].height}`);
  for (let f = 0; f < 3; f++) {
    check(`npc.${k}_${f} 64x80 painterly`, is6480p(SS.TEXTURES[`npc.${k}_${f}`]), `got ${SS.TEXTURES[`npc.${k}_${f}`]?.width}x${SS.TEXTURES[`npc.${k}_${f}`]?.height}`);
  }
}

console.log('== PORTRAITS (40x48 speech faces) ==');
const hex = (h) => [(h >> 16) & 255, (h >> 8) & 255, h & 255];
const psig = (c) => Array.from({ length: 1920 }, (_, i) => px(c, i % 40, Math.floor(i / 40)).join(',')).join('|');
for (const [id, col] of Object.entries(SS.NPC_COLORS)) {
  const frames = [0, 1, 2].map((f) => SS.TEXTURES[`port.${id}_${f}`]);
  check(`port.${id} 40x48 x3`, frames.every((c) => c && c.width === 40 && c.height === 48), `got ${frames.map((c) => c ? c.width + 'x' + c.height : 'missing').join(' ')}`);
  check(`port.${id} mouth blabs`, psig(frames[0]) !== psig(frames[1]) && psig(frames[1]) !== psig(frames[2]));
  check(`port.${id} suit shoulders`, near(px(frames[0], 6, 40), hex(col)), `@6,40 ${px(frames[0], 6, 40)} vs #${col.toString(16)}`);
}
check('portraits distinct per NPC', new Set(Object.keys(SS.NPC_COLORS).map((id) => psig(SS.TEXTURES[`port.${id}_0`]))).size === Object.keys(SS.NPC_COLORS).length);

// ── Stage 4/5 gates (QA 0904): the cast used to be one flat face in nine wigs,
// and every walk direction/frame was the same drawing with a 1px bob. These
// gates assert the FACE and the GAIT actually differ, not that they exist. ──
const pdiff = (a, b) => { let n = 0; for (let i = 0; i < 1920; i++) { const x = i % 40, y = (i / 40) | 0; const pa = px(a, x, y), pb = px(b, x, y); if (pa.join() !== pb.join()) n++; } return n; };
console.log('== EXPRESSION & VIEW/GAIT VARIETY (QA 0904 Stage 4/5) ==');
{
  // two humans whose faces are ONLY hair-different would share the eye/brow/mouth
  // band; that is the flat-cast bug, so compare the face band alone.
  const bandSig = (c) => { let s = ''; for (let y = 10; y < 26; y++) for (let x = 9; x < 31; x++) s += px(c, x, y).join() + ';'; return s; };
  const humans = Object.keys(SS.NPC_COLORS).filter((id) => id !== 'nova' && id !== 'cora');
  const bands = new Set(humans.map((id) => bandSig(SS.TEXTURES[`port.${id}_0`])));
  check(`human portraits differ in the FACE band, not just hair (${bands.size}/${humans.length})`, bands.size >= humans.length - 1, `got ${bands.size}`);
  check('the two droids are structurally different heads (not one shell, two visor colours)',
    pdiff(SS.TEXTURES['port.nova_0'], SS.TEXTURES['port.cora_0']) > 250,
    `diff=${pdiff(SS.TEXTURES['port.nova_0'], SS.TEXTURES['port.cora_0'])}`);
  // gait: walk frames must differ by real limb motion, well past a 1px bob
  const f = SS.PLAYER_FRAMES;
  const fraw = (c) => c._ctx ? c._ctx.data : c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  const pd = (a, b) => { const A = fraw(a), B = fraw(b); let n = 0; for (let i = 0; i < A.length; i += 4) if (A[i] !== B[i] || A[i+1] !== B[i+1] || A[i+2] !== B[i+2] || A[i+3] !== B[i+3]) n++; return n; };
  check('walk frames differ by limb motion, not a bob (>600px)', pd(f.front_0, f.front_1) > 600 && pd(f.front_1, f.front_2) > 600,
    `${pd(f.front_0, f.front_1)}/${pd(f.front_1, f.front_2)}`);
  check('back view is not the front face (no eyes/mouth on a walking-away body)', pd(f.front_0, f.back_0) > 400, `diff=${pd(f.front_0, f.back_0)}`);
  check('left/right profiles are not mirror-shared poses', pd(f.left_0, f.right_0) > 200, `diff=${pd(f.left_0, f.right_0)}`);
  // NPC_FRAMES values are positional [front_0, front_1, front_2] arrays
  const nf = SS.NPC_FRAMES && SS.NPC_FRAMES.luna;
  if (nf) check('NPC walk frames animate too', pd(nf[0], nf[1]) > 600, `diff=${pd(nf[0], nf[1])}`);
}

console.log('== SKIN DIVERSITY (space has brown people) ==');
const humanIds = Object.keys(SS.NPC_COLORS).filter((id) => id !== 'nova' && id !== 'cora');
const skinHues = new Set();
let brownPpl = 0;
for (const id of humanIds) {
  const c = SS.TEXTURES[`npc.${id}_0`];
  const p = SS.px(c, 32, 20); // face center skin band (new slimmer face)
  skinHues.add(p.join(','));
  if (p[0] > 80 && p[0] < 225 && p[1] < p[0]) brownPpl++;
}
check(`8 humans have >=3 distinct skin tones`, skinHues.size >= 3, `got ${skinHues.size}`);
check(`brown skin tones present in-world`, brownPpl >= 2, `got ${brownPpl}`);

console.log('== LIVING SKY ==');
check('fx.sun 48x48', SS.TEXTURES['fx.sun'] && SS.TEXTURES['fx.sun'].width === 48 && SS.TEXTURES['fx.sun'].height === 48, `got ${SS.TEXTURES['fx.sun'] ? SS.TEXTURES['fx.sun'].width + 'x' + SS.TEXTURES['fx.sun'].height : 'missing'}`);
check('fx.moon 48x48', SS.TEXTURES['fx.moon'] && SS.TEXTURES['fx.moon'].width === 48 && SS.TEXTURES['fx.moon'].height === 48);
check('fx.cloud 64x40', SS.TEXTURES['fx.cloud'] && SS.TEXTURES['fx.cloud'].width === 64 && SS.TEXTURES['fx.cloud'].height === 40);
check('sun is warm', count(SS.TEXTURES['fx.sun'], (p) => p[0] > 220 && p[1] > 190 && p[2] < 205) > 100);
check('moon is pale + cratered', count(SS.TEXTURES['fx.moon'], (p) => p[0] > 200 && p[1] > 200 && p[2] > 210) > 80 && count(SS.TEXTURES['fx.moon'], (p) => p[0] < 200 && p[0] > 150) > 3);
check('cloud is fluffy white', count(SS.TEXTURES['fx.cloud'], (p) => p[0] > 200 && p[1] > 200 && p[2] > 200) > 80);

console.log('== CINEMATIC DEPTH (vignette / scanlines / porthole / asteroid) ==');
check('fx.vignette 256x256', SS.TEXTURES['fx.vignette'] && SS.TEXTURES['fx.vignette'].width === 256 && SS.TEXTURES['fx.vignette'].height === 256);
// vignette must be transparent in the center, dark at the corner
const vgC = SS.px(SS.TEXTURES['fx.vignette'], 128, 128), vgE = SS.px(SS.TEXTURES['fx.vignette'], 4, 4);
check('vignette center transparent', vgC[3] === 0, `a=${vgC[3]}`);
check('vignette edge dark', vgE[3] > 40, `a=${vgE[3]}`);
check('fx.scanlines 8x64', SS.TEXTURES['fx.scanlines'] && SS.TEXTURES['fx.scanlines'].width === 8 && SS.TEXTURES['fx.scanlines'].height === 64);
check('fx.asteroid 48x40', SS.TEXTURES['fx.asteroid'] && SS.TEXTURES['fx.asteroid'].width === 48 && SS.TEXTURES['fx.asteroid'].height === 40);
check('asteroid is rocky', count(SS.TEXTURES['fx.asteroid'], (p) => p[1] > 80 && p[1] < 190 && p[0] > p[2]) > 200);
check('ship.porthole 48x32', SS.TEXTURES['ship.porthole'] && SS.TEXTURES['ship.porthole'].width === 48 && SS.TEXTURES['ship.porthole'].height === 32);
check('porthole has starfield', count(SS.TEXTURES['ship.porthole'], (p) => p[2] > p[0] && p[2] > 40) > 120);

console.log('== NATURE & TERRAIN DEPTH ==');
check('decor.tree_leaf 72x84 (2x world)', SS.TEXTURES['decor.tree_leaf'] && SS.TEXTURES['decor.tree_leaf'].width === 72 && SS.TEXTURES['decor.tree_leaf'].height === 84);
check('tree_leaf has green canopy', count(SS.TEXTURES['decor.tree_leaf'], (p) => p[1] > p[0] && p[1] > p[2] && p[1] > 100) > 120);
check('decor.tree_bloom 64x76 (2x world)', SS.TEXTURES['decor.tree_bloom'] && SS.TEXTURES['decor.tree_bloom'].width === 64 && SS.TEXTURES['decor.tree_bloom'].height === 76);
check('tree_bloom is blossom-pink', count(SS.TEXTURES['decor.tree_bloom'], (p) => p[0] > 150 && p[2] > 130 && p[1] < p[0]) > 60);
const distinctShades = (c) => new Set(Array.from({ length: c.width * c.height }, (_, i) => px(c, i % c.width, Math.floor(i / c.width)).slice(0, 3).join(',')).filter((s) => !s.startsWith('0,0,0'))).size;
check('grassA has tonal depth (not flat)', distinctShades(SS.GROUND.grassA) >= 5, `got ${distinctShades(SS.GROUND.grassA)} shades`);
check('grassB has tonal depth', distinctShades(SS.GROUND.grassB) >= 5, `got ${distinctShades(SS.GROUND.grassB)} shades`);
check('soil has tonal depth', distinctShades(SS.GROUND.soil) >= 3, `got ${distinctShades(SS.GROUND.soil)}`);
check('path has tonal depth', distinctShades(SS.GROUND.path) >= 3, `got ${distinctShades(SS.GROUND.path)}`);

console.log('== DEEP-SPACE ENVIRONMENT (meteors + alien flora) ==');
check('fx.meteor streak', SS.TEXTURES['fx.meteor'] && SS.TEXTURES['fx.meteor'].width === 26 && SS.TEXTURES['fx.meteor'].height === 6);
check('meteor is bright cold-white head', count(SS.TEXTURES['fx.meteor'], p => p[0] > 190 && p[1] > 230 && p[2] > 235 && p[3] > 100) > 8);
check('decor.alien_flora 48x52 (2x world)', SS.TEXTURES['decor.alien_flora'] && SS.TEXTURES['decor.alien_flora'].width === 48 && SS.TEXTURES['decor.alien_flora'].height === 52);
check('flora glows teal', count(SS.TEXTURES['decor.alien_flora'], p => p[1] > 170 && p[2] > 150 && p[0] < p[1]) );
check('colony ground is moss-green turf', (() => { const p = px(SS.GROUND.grassA, 8, 8); return p[1] > p[0] && p[1] > p[2] && p[0] < 120; })());

console.log('== PAINTERLY DUSK (sky + haze) ==');
check('fx.sky_dusk 320x512', SS.TEXTURES['fx.sky_dusk'] && SS.TEXTURES['fx.sky_dusk'].width === 320 && SS.TEXTURES['fx.sky_dusk'].height === 512);
const skyTop = SS.px(SS.TEXTURES['fx.sky_dusk'], 160, 4);
const skyHor = SS.px(SS.TEXTURES['fx.sky_dusk'], 160, 505);
check('sky top is deep indigo/violet (b>r)', skyTop[2] > skyTop[0], `top=${skyTop}`);
check('sky horizon warm amber (r>b)', skyHor[0] > skyHor[2] && skyHor[1] > skyHor[2], `horizon=${skyHor}`);
check('sky is a smooth gradient (top!=horizon)', (skyTop[0] + skyTop[1] + skyTop[2]) !== (skyHor[0] + skyHor[1] + skyHor[2]));
check('fx.fog 320x96 warm haze', SS.TEXTURES['fx.fog'] && SS.TEXTURES['fx.fog'].width === 320 && SS.TEXTURES['fx.fog'].height === 96);
check('fog is warm-tinted (r>g>b-ish)', count(SS.TEXTURES['fx.fog'], (p) => p[0] > 180 && p[1] > 140 && p[2] < p[1]) > 200);

check('world 2x lock: tile.grass_a 32x32', SS.TEXTURES['tile.grass_a'] && SS.TEXTURES['tile.grass_a'].width === 32 && SS.TEXTURES['tile.grass_a'].height === 32, `got ${SS.TEXTURES['tile.grass_a'] ? SS.TEXTURES['tile.grass_a'].width + 'x' + SS.TEXTURES['tile.grass_a'].height : '?'}`);
check('native GROUND is 32x32 (source)', SS.GROUND.grassA && SS.GROUND.grassA.width === 32 && SS.GROUND.grassA.height === 32);
check('interior/ship stay native (not upscaled)', SS.TEXTURES['ship.planter'] && SS.TEXTURES['int.bed'] && SS.TEXTURES['ship.planter'].width < SS.TEXTURES['decor.planter'].width);
console.log('== BUILDING PALETTE COHESION (QA 0904 gate-blindness fix) ==');
// The fantasy-barn regression shipped because no gate measured COLOUR, only
// existence/dims. Contract: every bld.* module must stay slate-dominant — a
// rust/brown mass over the whole opaque sprite means a fantasy-hut breach
// (the old barn read >15% warm-rust; colony modules sit <8%).
{
  const raw = (c) => c._ctx ? c._ctx.data : c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  for (const k of Object.keys(SS.TEXTURES).filter(k => k.startsWith('bld.') && !k.endsWith('_glow'))) {
    const c = SS.TEXTURES[k];
    const d = raw(c);
    let op = 0, rust = 0;
    for (let p = 0; p < d.length; p += 4) {
      if (d[p + 3] < 40) continue;
      op++;
      const r = d[p], g = d[p + 1], b = d[p + 2];
      if (r > b + 38 && r > 88 && r > g + 18) rust++;
    }
    check(`${k} stays colony-cool (<12% rust-brown mass)`, op > 0 && (rust / op) * 100 < 12, `rust=${((rust / Math.max(1, op)) * 100).toFixed(1)}%`);
  }
}

console.log('== SHORELINE ADJACENCY CONTRACT (QA 0904 gate-blindness fix) ==');
// The lake used to end in a razor 1-tile belt of dry sand against flat cyan.
// Contract (MapData): every sand tile touching water must be wetSand, and
// every water tile touching sand must touch a wetSand neighbour somewhere —
// i.e. no direct dry-sand↔water edge anywhere on the map.
{
  const g = MD.ground;
  const at = (x, y) => (g[y] && g[y][x]) || 'grass_a';
  let dryOnWater = 0, waterOnDry = 0;
  const WATER = (t) => t === 'water';
  for (let y = 0; y < MD.MAP_H; y++) for (let x = 0; x < MD.MAP_W; x++) {
    const t = at(x, y);
    const nb = [at(x - 1, y), at(x + 1, y), at(x, y - 1), at(x, y + 1)];
    if (t === 'sand' && nb.some(WATER)) dryOnWater++;
    if (WATER(t) && nb.includes('sand')) {
      const nb2 = [at(x - 2, y), at(x + 2, y), at(x, y - 2), at(x, y + 2), at(x - 1, y - 1), at(x + 1, y + 1)];
      if (!nb.includes('wet_sand') && !nb2.includes('wet_sand')) waterOnDry++;
    }
  }
  check('no dry sand tile directly touches open water', dryOnWater === 0, `${dryOnWater} violations`);
  check('every water edge facing sand has a wet-sand feather', waterOnDry === 0, `${waterOnDry} violations`);
}

console.log('== LINE-WEIGHT (2px-min stroke rule, QA 0904 gate-blindness fix) ==');
// The old fishing rod shipped as a 1px hairline invisible at game scale; the
// language rule is 2px minimum strokes everywhere. Measure it objectively: an
// inked pixel with NO orthogonally-inked neighbour is an isolated hairline
// speck; every prop texture must keep ≥85% of its ink mass in connected runs.
{
  const raw = (c) => c._ctx ? c._ctx.data : c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  for (const k of Object.keys(SS.TEXTURES).filter(k => /^(int|fest|ranch|tool)\./.test(k))) {
    const c = SS.TEXTURES[k]; if (!c) continue;
    const d = raw(c), W = c.width, H = c.height;
    const ink = (x, y) => x >= 0 && y >= 0 && x < W && y < H && d[((y * W) + x) * 4 + 3] > 60;
    let n = 0, o = 0;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { if (!ink(x, y)) continue; n++; if (ink(x - 1, y) || ink(x + 1, y) || ink(x, y - 1) || ink(x, y + 1)) o++; }
    check(`${k} respects the 2px-min line weight`, n === 0 || (o / n) * 100 >= 85, n ? `ortho=${((o / n) * 100).toFixed(1)}%` : 'empty');
  }
  // Tool distinguishability (QA 6.1): pickaxe vs hoe used to be the same
  // stick+grey-head silhouette at two scales. Their ink silhouettes must differ
  // materially so the swing animation reads which action is happening.
  const sil = (c) => { const d = raw(c); return (x, y) => d[((y * c.width) + x) * 4 + 3] > 60; };
  const A = SS.TEXTURES['tool.pickaxe'], B = SS.TEXTURES['tool.hoe'];
  if (A && B && A.width === B.width && A.height === B.height) {
    const ia = sil(A), ib = sil(B);
    let diff = 0;
    for (let y = 0; y < A.height; y++) for (let x = 0; x < A.width; x++) if (ia(x, y) !== ib(x, y)) diff++;
    check('pickaxe vs hoe silhouettes are distinguishable (≥15% ink diff)', diff / (A.width * A.height) >= 0.15, `diff=${(diff / (A.width * A.height) * 100).toFixed(1)}%`);
  }
}

// ── QA 0904 Stage 2.5: the window-light RULE gate ──
// A commercial facade must ship WARM WINDOW PIXELS in its wall band, and the
// scene must split glows day/night by litWhen. Gate blindness lesson: this
// attribute (warm-window MASS) shipped zero on the shop for a whole pass
// because the palette-cohesion gate only measured RUST mass, never warm mass.
{
  const warm = (c, x0, y0, x1, y1) => { let n = 0; for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const p = px(c, x, y); if (p[3] > 40 && p[0] > 200 && p[1] > 170 && p[2] < 190) n++; } return n; };
  for (const [key, minWarm] of [['bld.shop', 20], ['bld.tavern_a', 20], ['bld.exchange_a', 20], ['bld.barn', 6], ['bld.barracks', 30]]) {
    const c = SS.TEXTURES[key]; if (!c) continue;
    check(`${key} carries the lit-window rule (≥${minWarm} warm px in the wall band)`, warm(c, 0, (c.height * 0.2) | 0, c.width, (c.height * 0.62) | 0) >= minWarm, `warm=${warm(c, 0, (c.height * 0.2) | 0, c.width, (c.height * 0.62) | 0)}`);
  }
  // the scene wiring side: commercial keys are tagged 'day', residential 'night'
  const mdSrc = readFileSync(new URL('../client/scenes/PlanetScene.js', import.meta.url), 'utf8');
  check('PlanetScene tags commercial glows day-lit (open for business)', /litWhen = \(b\.key === 'shop' \|\| b\.key === 'tavern' \|\| b\.key === 'exchange'\) \? 'day' : 'night'/.test(mdSrc));
  check('glow visibility respects litWhen (not blanket night-only)', /g\.litWhen !== 'day' : g\.litWhen === 'day'/.test(mdSrc));
}

// ── QA 0904 Stage 2.4: beacons are mounted, not floating ──
// Under every roof-beacon dot there must be mast hardware: ink in the 2px
// column directly below the beacon centre. A gate for the exact defect.
{
  for (const key of ['bld.shop', 'bld.barn', 'bld.barracks', 'bld.tavern_a']) {
    const c = SS.TEXTURES[key]; if (!c) continue;
    // find the warmest bright pixel in the top 14% rows = the beacon bulb
    let bx = -1, by = -1, best = -1;
    for (let y = 0; y < (c.height * 0.14) | 0; y++) for (let x = 0; x < c.width; x++) {
      const p = px(c, x, y); if (p[3] > 200 && p[0] > 230 && p[1] > 150 && p[2] < 140) { const s = p[0] + p[1]; if (s > best) { best = s; bx = x; by = y; } }
    }
    if (bx < 0) { check(`${key} roof beacon present`, false, 'no warm beacon pixel found in roof band'); continue; }
    let below = 0;
    for (let y = by + 2; y < Math.min(c.height, by + 8); y++) { const p = px(c, bx, y); if (p[3] > 40) below++; }
    check(`${key} beacon sits on a mount (mast ink under the bulb)`, below >= 3, `below=${below} at (${bx},${by})`);
  }
}

// ── QA 0904 Stage 3.3/3.4: every room light pool has a fixture; rooms carry signs ──
{
  const psSrc = readFileSync(new URL('../client/scenes/PlanetScene.js', import.meta.url), 'utf8');
  const roomBlock = psSrc.slice(psSrc.indexOf('_decorateRoom'));
  // QA round-2 geometry contract: pools and fixtures are emitted PAIRWISE by a
  // hang() helper so no pool can ship without its lamp, and the fixture must
  // sit on the wall band (top+wallH-...) while its pool centre sits BELOW it
  // (top+wallH+...) — a lamp beside a blob still reads as a blob.
  check('interior light pools hang under a visible fixture (hang() pairs them)',
    /const hang = \(px_, poolCy\)/.test(psSrc) && (psSrc.match(/hang\(cx/g) || []).length >= 2
    && /'int\.ceilingLight'/.test(psSrc), `hang calls=${(psSrc.match(/hang\(cx/g) || []).length}`);
  {
    const nSign = (roomBlock.match(/\bsign\(/g) || []).length;
    check('every room kind gets a named holosign', nSign >= 6, `sign() calls=${nSign}`);
    // the sign's WORD must be real text, not just a plate — the round-1 plate
    // with baked glyph bars collided with the label and read as noise
    check('signplate word is drawn as real stroked text over the plate',
      /int\.signplate/.test(roomBlock) && /color: '#f2d9a2'/.test(roomBlock));
  }
  check('fixture + plate textures registered', !!SS.TEXTURES['int.ceilingLight'] && !!SS.TEXTURES['int.signplate']);
  // the fixture must have a HOT emitter (amber) pixel — an all-grey disc is the
  // old generic ellipse wearing a new coat
  {
    const c = SS.TEXTURES['int.ceilingLight'];
    let hot = 0; if (c) for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) { const p = px(c, x, y); if (p[3] > 60 && p[0] > 240 && p[1] > 200 && p[2] < 200) hot++; }
    check('ceiling fixture has a hot emitter core', hot >= 8, `hot=${hot}`);
  }
  // the plate must read as a colony signboard: slate mass + teal bezel mass + pip
  {
    const c = SS.TEXTURES['int.signplate'];
    let teal = 0, slate = 0;
    if (c) for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) {
      const p = px(c, x, y); if (p[3] < 60) continue;
      if (p[2] > 140 && p[1] > 140 && p[0] < 140) teal++;
      else if (p[0] < 70 && p[2] > p[0]) slate++;
    }
    check('signplate carries slate mass + teal bezel', teal >= 25 && slate >= 80, `teal=${teal} slate=${slate}`);
  }
}

// ── QA 0904 Stage 6.3: held tools anchor to the hand, not the head ──
{
  const psSrc = readFileSync(new URL('../client/scenes/PlanetScene.js', import.meta.url), 'utf8');
  const m = psSrc.match(/_updateToolSprite\(\) \{[\s\S]*?\n  \}/);
  check('tool sprite anchors to the hand row (+18), never a head-height offset',
    !!m && /\+ 18\)/.test(m[0]) && !/dy \* 7 - 3/.test(m[0]));
  const swingAngle = Number(psSrc.match(/_swingTool\(\)[\s\S]*?setAngle\((\d+)\)/)?.[1]);
  check('tool swing tilts AWAY from the head (positive angle)', swingAngle > 0 && swingAngle <= 90, `angle=${swingAngle}`);
}

// ── QA 0904 Stage 1.5: flora grow in clusters, not lawn darts ──
{
  const fam = (t) => /tree|bush|flora/.test(t);
  const items = MD.DECOR.filter(d => fam(d.tex)).map(d => ({ x: d.x, y: d.y, t: d.tex }));
  const iso = items.filter(a => !items.some(b => b !== a && Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y)) <= 2));
  check(`flora read as clusters (isolated non-border plants ≤ 8; got ${iso.length})`, iso.length <= 8,
    iso.map(i => `${i.t}@${i.x},${i.y}`).join(' '));
  // the DECOR layout meta-check the old suite lacked: nothing in the water,
  // nothing on a building footprint, nothing on a blocked tile
  let bad = 0;
  for (const d of MD.DECOR) {
    if (d.x >= MD.MAP_W || d.y >= MD.MAP_H) { bad++; continue; }
    const g = MD.ground[d.y][d.x];
    if ((g === 'water' || g === 'river') && !/pond/.test(d.tex)) bad++;
    if (MD.blocks[d.y][d.x] && !/barrel|planter/.test(d.tex)) bad++;
    for (const b of MD.BUILDINGS) if (d.x >= b.x && d.x < b.x + (b.w || 4) && d.y >= b.y && d.y < b.y + (b.h || 4)) bad++;
  }
  check('no decor stands in water / on a building / on a blocked tile', bad === 0, `violations=${bad}`);
}

// ── QA 0904 Stage 5: portrait–world-sprite likeness (droid family) ──
// The auxiliary-vision pass flagged nova/cora portraits as unlike their world
// sprites. Gate the SIGNATURE EMISSION COLOUR: the droid portrait's visor bar
// and the world sprite's visor band must share the family hue.
{
  const meanWarm = (c, x0, y0, x1, y1, hot) => {
    let r = 0, g = 0, b = 0, n = 0;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const p = px(c, x, y); if (p[3] > 60 && hot(p)) { r += p[0]; g += p[1]; b += p[2]; n++; } }
    return n ? [r / n, g / n, b / n, n] : null;
  };
  const amber = (p) => p[0] > 200 && p[1] > 120 && p[2] < 140;
  for (const id of ['nova']) {
    const world = SS.TEXTURES[`npc.${id}_0`], port = SS.TEXTURES[`port.${id}_0`];
    if (!world || !port) continue;
    const wA = meanWarm(world, 0, 0, world.width, world.height, amber);
    const pA = meanWarm(port, 0, 0, port.width, port.height, amber);
    check(`${id} keeps its amber forge-emission in portrait AND world`, !!wA && !!pA && wA[3] > 8 && pA[3] > 8, `world=${wA && wA[3]} port=${pA && pA[3]}`);
  }
  const teal = (p) => p[2] > 170 && p[1] > 170 && p[0] < 160;
  for (const id of ['cora']) {
    const world = SS.TEXTURES[`npc.${id}_0`], port = SS.TEXTURES[`port.${id}_0`];
    const wA = meanWarm(world, 0, 0, world.width, world.height, teal);
    const pA = meanWarm(port, 0, 0, port.width, port.height, teal);
    check(`${id} keeps its teal optic glow in portrait AND world`, !!wA && !!pA && wA[3] > 8 && pA[3] > 8, `world=${wA && wA[3]} port=${pA && pA[3]}`);
  }
}

console.log('== TEXTURES registry ==');
check('registry has 40+ entries', Object.keys(SS.TEXTURES).length >= 40, `got ${Object.keys(SS.TEXTURES).length}`);
check('registry all canvases', Object.values(SS.TEXTURES).every(c => c && typeof c.width === 'number'));

console.log(`\n===== ${pass} passed, ${fail} failed =====`);
if (fail === 0) console.log('ALL GREEN ✓');
process.exit(fail > 0 ? 1 : 0);

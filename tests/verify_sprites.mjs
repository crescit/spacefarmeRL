// verify_sprites.mjs — objective pixel verification of SpriteSystem (headless)
import * as SS from '../client/systems/SpriteSystem.js';
import { px } from '../client/systems/SpriteSystem.js';

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
check('path is warm stone', (() => { const p = px(SS.GROUND.path, 5, 5); return p[0] > 95 && p[0] < 200 && p[1] > p[2]; })());
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
  check(`${k} 32x32`, is32(c), `got ${c.width}x${c.height}`);
}
check('shop dark slate hull', count(SS.shopSprite, p => p[0] > 20 && p[0] < 90 && p[0] < p[2] && p[1] < p[2]) > 40);
check('shop teal holo sign', count(SS.shopSprite, p => p[0] < 140 && p[1] > 180 && p[2] > 170) > 10);
check('shop glass display bay teal', count(SS.shopSprite, p => p[0] < 180 && p[1] > 140 && p[2] > 150 && p[2] > p[0]) > 15);
check('exchangeA teal trade orb', count(SS.exchangeA, p => p[0] < 130 && p[1] > 180 && p[2] > 180 && p[2] > p[0]) > 30);
check('exchangeB teal trade orb', count(SS.exchangeB, p => p[0] < 130 && p[1] > 180 && p[2] > 180 && p[2] > p[0]) > 40);
const sigA = Array.from({ length: 1024 }, (_, i) => px(SS.exchangeA, i % 32, Math.floor(i / 32)).join(',')).join('|');
const sigB = Array.from({ length: 1024 }, (_, i) => px(SS.exchangeB, i % 32, Math.floor(i / 32)).join(',')).join('|');
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
console.log('== TEXTURES registry ==');
check('registry has 40+ entries', Object.keys(SS.TEXTURES).length >= 40, `got ${Object.keys(SS.TEXTURES).length}`);
check('registry all canvases', Object.values(SS.TEXTURES).every(c => c && typeof c.width === 'number'));

console.log(`\n===== ${pass} passed, ${fail} failed =====`);
if (fail === 0) console.log('ALL GREEN ✓');
process.exit(fail > 0 ? 1 : 0);

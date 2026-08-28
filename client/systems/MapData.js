// MapData.js — Asteroid B-612 colony layout (declarative, scene-agnostic)
// All coordinates are TILE indices on a 40×32 grid (16px tiles).
// Layout: player's dome house (top) → yard → street → village row (shop/tavern/exchange)
//         → energy fence (gate) → farm field (split by a path) + stardust pond.
// Ground, collision, buildings, decor, NPC placement — one source of truth.

export const MAP_W = 40;
export const MAP_H = 32;

// ── Region constants ──
const FENCE_Y = 14;             // energy fence line between village and farm
const GATE_X = [17, 18];        // fence gate (walkable gap)
const FIELD = { x0: 7, x1: 31, y0: 16, y1: 28 };   // farm soil
const FIELD_PATH_X = 18;        // vertical path splitting the field
const POND = { x0: 34, x1: 37, y0: 20, y1: 23 };   // stardust water (blocks)
const STREET_Y = 12;            // main village street
const STREET_X0 = 4, STREET_X1 = 34;
const GATE_PATH_X = 17;         // house door → street (x=17)

// ── Ground grid [y][x] ── values: 'grass_a'..'grass_f' | 'path' | 'soil' | 'soil_b' | 'water'
function makeGround() {
  const g = Array.from({ length: MAP_H }, () => new Array(MAP_W).fill('grass_a'));
  // organic grass variation — 6 variants picked by position (deterministic,
  // breaks the old 2-color checkerboard into natural clumps)
  for (let y = 0; y < MAP_H; y++) {
    for (let x = 0; x < MAP_W; x++) {
      const v = (x * 7 + y * 13 + ((x * y) % 5)) % 7;
      const variant = v % 6;
      if (variant !== 0) g[y][x] = ['grass_a', 'grass_c', 'grass_b', 'grass_d', 'grass_e', 'grass_f'][variant];
    }
  }
  // farm soil (skip the split path column) — 2 alternating variants
  for (let y = FIELD.y0; y <= FIELD.y1; y++)
    for (let x = FIELD.x0; x <= FIELD.x1; x++)
      if (x !== FIELD_PATH_X) g[y][x] = (x + y) % 2 === 0 ? 'soil' : 'soil_b';
  // pond
  for (let y = POND.y0; y <= POND.y1; y++)
    for (let x = POND.x0; x <= POND.x1; x++) g[y][x] = 'water';
  // main street
  for (let x = STREET_X0; x <= STREET_X1; x++) g[STREET_Y][x] = 'path';
  // gate path (house door → street)
  for (let y = 6; y <= STREET_Y; y++) g[y][GATE_PATH_X] = 'path';
  // field split path (street → field bottom)
  for (let y = STREET_Y; y <= FIELD.y1; y++) g[y][FIELD_PATH_X] = 'path';
  return g;
}

// ── Collision [y][x] — true = blocked ──
function makeBlocks(ground) {
  const b = Array.from({ length: MAP_H }, () => new Array(MAP_W).fill(false));
  for (let y = 0; y < MAP_H; y++)
    for (let x = 0; x < MAP_W; x++)
      if (ground[y][x] === 'water') b[y][x] = true;
  // fence posts (every 4 tiles, gate gap)
  for (let x = 2; x < MAP_W; x += 4) {
    if (GATE_X.includes(x)) continue;
    b[FENCE_Y][x] = true;
  }
  return b;
}

// ── Buildings ── (tex key, tile anchor, footprint, door tile, glow)
export const BUILDINGS = [
  {
    key: 'house', tex: 'bld.house', glow: 'bld.house_glow',
    x: 16, y: 2, w: 4, h: 4,
    door: { x: 17, y: 6 },
    label: 'HOME', action: 'sleep',
  },
  {
    key: 'shop', tex: 'bld.shop', glow: 'bld.shop_glow',
    x: 5, y: 9, w: 2, h: 2,
    door: { x: 6, y: 11 },
    label: 'SUPPLY DEPOT', action: 'shop',
  },
  {
    key: 'tavern', tex: 'bld.tavern', glow: 'bld.tavern_glow',
    x: 18, y: 9, w: 2, h: 2,
    door: { x: 19, y: 11 },
    label: 'STARDUST TAVERN', action: 'talk_rhea',
  },
  {
    key: 'exchange', tex: 'bld.exchange', glow: 'bld.exchange_glow',
    x: 29, y: 9, w: 2, h: 2,
    door: { x: 30, y: 11 },
    label: 'GRAND EXCHANGE', action: 'exchange',
  },
  {
    key: 'barn', tex: 'bld.barn',
    x: 2, y: 16, w: 3, h: 3,
    door: { x: 3, y: 19 },
    label: 'RANCH', action: 'ranch',
  },
];

// ── Decor ── (tex key, tile anchor)
export const DECOR = [
  // solar lamps — street + field
  { tex: 'decor.lamp', x: 16, y: 12 },
  { tex: 'decor.lamp', x: 21, y: 12 },
  { tex: 'decor.lamp', x: 11, y: 12 },
  { tex: 'decor.lamp', x: 17, y: 19 },
  { tex: 'decor.lamp', x: 32, y: 17 },
  // alien planters by the house
  { tex: 'decor.planter', x: 14, y: 6 },
  { tex: 'decor.planter', x: 20, y: 6 },
  { tex: 'decor.planter', x: 26, y: 12 },
  // stardust pond (fishing spot) in the farm field
  { tex: 'decor.pond', x: 27, y: 22 },
  // cargo / water barrels by the shop
  { tex: 'decor.barrel_cargo', x: 4, y: 11 },
  { tex: 'decor.barrel_water', x: 8, y: 11 },
  // alien bushes — edges + corners
  { tex: 'decor.bush', x: 1, y: 1 },
  { tex: 'decor.bush', x: 38, y: 1 },
  { tex: 'decor.bush', x: 1, y: 30 },
  { tex: 'decor.bush', x: 38, y: 30 },
  { tex: 'decor.bush', x: 36, y: 14 },
  { tex: 'decor.bush', x: 2, y: 18 },
  { tex: 'decor.bush', x: 31, y: 29 },
  { tex: 'decor.bush', x: 39, y: 27 },
  // trees — natural canopy for depth & scale (walkable under)
  { tex: 'decor.tree_leaf', x: 2, y: 2 },
  { tex: 'decor.tree_leaf', x: 37, y: 2 },
  { tex: 'decor.tree_leaf', x: 14, y: 0 },
  { tex: 'decor.tree_leaf', x: 25, y: 0 },
  { tex: 'decor.tree_leaf', x: 1, y: 9 },
  { tex: 'decor.tree_leaf', x: 38, y: 8 },
  { tex: 'decor.tree_bloom', x: 5, y: 30 },
  { tex: 'decor.tree_bloom', x: 35, y: 30 },
  { tex: 'decor.tree_bloom', x: 12, y: 30 },
  { tex: 'decor.tree_bloom', x: 26, y: 30 },
  // bioluminescent alien flora — the colony's own glowing biomes
  { tex: 'decor.alien_flora', x: 8, y: 30 },
  { tex: 'decor.alien_flora', x: 33, y: 5 },
  { tex: 'decor.alien_flora', x: 20, y: 30 },
  { tex: 'decor.alien_flora', x: 4, y: 21 },
  { tex: 'decor.alien_flora', x: 36, y: 26 },
];

// ── Fence spans (beams between posts) ──
export function fenceSpans() {
  const spans = [];
  for (let x = 2; x < MAP_W; x += 4) {
    if (GATE_X.includes(x)) continue;
    const next = x + 4;
    if (next < MAP_W) {
      let end = next;
      if (GATE_X.includes(next)) end = x + 2;
      if (end > x) spans.push({ x0: x, x1: end, y: FENCE_Y });
    }
  }
  return spans;
}

// ── NPC tile positions (village yards + farm edges) ──
export const NPC_POS = {
  nova: { x: 12, y: 5 },
  luna: { x: 25, y: 4 },
  zephyr: { x: 34, y: 6 },
  vega: { x: 8, y: 5 },
  quasar: { x: 3, y: 10 },
  rhea: { x: 22, y: 13 },
  astra: { x: 13, y: 8 },
  orion: { x: 9, y: 21 },
  comet: { x: 24, y: 25 },
  cora: { x: 31, y: 13 },
};

export const PLAYER_START = { x: 17, y: 13 };

export const FENCE_Y_EXPORT = FENCE_Y;

// ── Derived (built once) ──
const ground = makeGround();
const blocks = makeBlocks(ground);
// buildings block
for (const bld of BUILDINGS) {
  for (let y = bld.y; y < bld.y + bld.h; y++)
    for (let x = bld.x; x < bld.x + bld.w; x++)
      if (y < MAP_H && x < MAP_W) blocks[y][x] = true;
}
// blocking decor
const BLOCKING_DECOR = new Set(['decor.barrel_cargo', 'decor.barrel_water', 'decor.planter']);
for (const d of DECOR) {
  if (BLOCKING_DECOR.has(d.tex) && d.y < MAP_H && d.x < MAP_W) blocks[d.y][d.x] = true;
}

export { ground, blocks };

// ── Walkability verification (flood fill from player start) ──
export function verifyWalkability() {
  const seen = Array.from({ length: MAP_H }, () => new Array(MAP_W).fill(false));
  const stack = [[PLAYER_START.x, PLAYER_START.y]];
  seen[PLAYER_START.y][PLAYER_START.x] = true;
  const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  while (stack.length) {
    const [x, y] = stack.pop();
    for (const [dx, dy] of DIRS) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= MAP_W || ny >= MAP_H) continue;
      if (seen[ny][nx] || blocks[ny][nx]) continue;
      seen[ny][nx] = true;
      stack.push([nx, ny]);
    }
  }
  const report = { reachable: 0, unreachable: [], ok: true };
  const mustReach = [
    ...Object.values(NPC_POS),
    ...BUILDINGS.map(b => b.door),
  ];
  for (let y = 0; y < MAP_H; y++)
    for (let x = 0; x < MAP_W; x++)
      if (ground[y][x] === 'soil') mustReach.push({ x, y });
  let walkable = 0;
  for (let y = 0; y < MAP_H; y++)
    for (let x = 0; x < MAP_W; x++)
      if (seen[y][x]) walkable++;
  report.walkable = walkable;
  for (const { x, y } of mustReach) {
    if (seen[y][x]) report.reachable++;
    else { report.unreachable.push({ x, y }); report.ok = false; }
  }
  return report;
}

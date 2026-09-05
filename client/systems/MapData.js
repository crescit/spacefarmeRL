// MapData.js — Asteroid B-612 colony layout (declarative, scene-agnostic)
// GBA-style Harvest Moon world: a tile map LARGER than one viewport (64×48)
// with the camera scrolling as you walk — you never see the whole world at
// once. Natural terrain gives it depth + character:
//   NW = farm (fenced field + ranch)      N/NE = lake + beach
//   center = winding river with a bridge  E = forest grove
//   SW = mine mountain (cliff)            S = downtown (shop/tavern/exchange/home)

export const MAP_W = 64;
export const MAP_H = 48;

// ── Cross roads (2-tile wide, connect all zones) ──
const VROAD_X0 = 24, VROAD_X1 = 25;   // vertical main road
const HROAD_Y0 = 22, HROAD_Y1 = 23;   // horizontal main road

// ── Zone bounds ──
export const FARM = { x0: 4, x1: 20, y0: 4, y1: 15 };
const LAKE_WATER = { x0: 28, x1: 42, y0: 3, y1: 15 };
const LAKE_BEACH = { x0: 26, x1: 44, y0: 2, y1: 16 };
const RIVER_X0 = 42, RIVER_X1 = 45;   // river flows south (bridge at the road)
const TOWN  = { x0: 18, x1: 41, y0: 26, y1: 46 };
const FOREST = { x0: 52, x1: 63, y0: 4, y1: 44 };
const MINE  = { x0: 3, x1: 16, y0: 26, y1: 44 };

// access paths
const FARM_PATH_X = 21;   // farm gate → vertical road
const MINE_PATH_X = 22;   // vertical road → mine
const FOREST_PATH_Y = 22; // horizontal road → forest
const LAKE_PATH_X = 26;   // lake shore → road

// Farm fence line (south + east edges, gate on the road side)
const FENCE_Y = 16;
const GATE_X = [FARM_PATH_X];

// ── Ground grid [y][x] ── values: grass_a..f | path | soil | soil_b | water | plaza | sand | cliff | forest
function makeGround() {
  const g = Array.from({ length: MAP_H }, () => new Array(MAP_W).fill('grass_a'));
  // organic grass variation
  for (let y = 0; y < MAP_H; y++) {
    for (let x = 0; x < MAP_W; x++) {
      const v = (x * 7 + y * 13 + ((x * y) % 5)) % 7;
      const variant = v % 6;
      if (variant !== 0) g[y][x] = ['grass_a', 'grass_c', 'grass_b', 'grass_d', 'grass_e', 'grass_f'][variant];
    }
  }
  // farm soil (NW field) — 2 alternating variants
  for (let y = FARM.y0; y <= FARM.y1; y++)
    for (let x = FARM.x0; x <= FARM.x1; x++)
      if (x !== FARM_PATH_X) g[y][x] = (x + y) % 2 === 0 ? 'soil' : 'soil_b';
  // lake beach (sand ring)
  for (let y = LAKE_BEACH.y0; y <= LAKE_BEACH.y1; y++)
    for (let x = LAKE_BEACH.x0; x <= LAKE_BEACH.x1; x++) g[y][x] = 'sand';
  // lake water
  for (let y = LAKE_WATER.y0; y <= LAKE_WATER.y1; y++)
    for (let x = LAKE_WATER.x0; x <= LAKE_WATER.x1; x++) g[y][x] = 'water';
  // wet tide-line: the beach ring's inner row (the one touching open water)
  // becomes damp sand, so the shore feathers sand→wet→deep instead of ending in
  // a hard 1-tile razor belt of dry beach against a flat cyan slab.
  const isWater = (x, y) =>
    (y >= LAKE_WATER.y0 && y <= LAKE_WATER.y1 && x >= LAKE_WATER.x0 && x <= LAKE_WATER.x1) ||
    (x >= RIVER_X0 && x <= RIVER_X1 && y > LAKE_WATER.y1 && !(y >= HROAD_Y0 && y <= HROAD_Y1));
  for (let y = LAKE_BEACH.y0; y <= LAKE_BEACH.y1; y++)
    for (let x = LAKE_BEACH.x0; x <= LAKE_BEACH.x1; x++) {
      if (g[y][x] !== 'sand') continue;
      if (isWater(x - 1, y) || isWater(x + 1, y) || isWater(x, y - 1) || isWater(x, y + 1)) g[y][x] = 'wet_sand';
    }
  // river water (flows south from the lake, bridged at the road)
  for (let y = LAKE_WATER.y1 + 1; y < MAP_H; y++)
    for (let x = RIVER_X0; x <= RIVER_X1; x++)
      if (!(y >= HROAD_Y0 && y <= HROAD_Y1)) g[y][x] = 'water';
  // bridge (path) where the horizontal road crosses the river
  for (let y = HROAD_Y0; y <= HROAD_Y1; y++)
    for (let x = RIVER_X0; x <= RIVER_X1; x++) g[y][x] = 'path';
  // downtown plaza (S) — colony decking
  for (let y = TOWN.y0; y <= TOWN.y1; y++)
    for (let x = TOWN.x0; x <= TOWN.x1; x++) g[y][x] = 'plaza';
  // forest floor (E)
  for (let y = FOREST.y0; y <= FOREST.y1; y++)
    for (let x = FOREST.x0; x <= FOREST.x1; x++) g[y][x] = 'forest';
  // mine mountain (SW) — rough rock
  for (let y = MINE.y0; y <= MINE.y1; y++)
    for (let x = MINE.x0; x <= MINE.x1; x++) g[y][x] = 'cliff';
  // main roads — colony decking (built space, not dirt paths)
  for (let y = 0; y < MAP_H; y++)
    for (let x = VROAD_X0; x <= VROAD_X1; x++) g[y][x] = 'plaza';
  for (let y = HROAD_Y0; y <= HROAD_Y1; y++)
    for (let x = 0; x < MAP_W; x++) g[y][x] = 'plaza';
  // farm gate path (field → vertical road)
  for (let y = FARM.y0; y <= HROAD_Y1; y++) g[y][FARM_PATH_X] = 'path';
  // mine trail (vertical road → mine vein)
  for (let y = HROAD_Y1; y <= 38; y++) g[y][MINE_PATH_X] = 'path';
  // lake shore trail (horizontal road → lake)
  for (let y = LAKE_WATER.y1; y <= HROAD_Y0; y++) g[y][LAKE_PATH_X] = 'path';
  // forest trail (horizontal road → forest)
  for (let x = FOREST.x0; x <= 50; x++) g[FOREST_PATH_Y][x] = 'path';
  return g;
}

// ── Collision [y][x] — true = blocked ──
function makeBlocks(ground) {
  const b = Array.from({ length: MAP_H }, () => new Array(MAP_W).fill(false));
  for (let y = 0; y < MAP_H; y++)
    for (let x = 0; x < MAP_W; x++)
      if (ground[y][x] === 'water') b[y][x] = true;
  // farm fence posts (south edge, gate gap)
  for (let x = 2; x < MAP_W; x += 4) {
    if (GATE_X.includes(x)) continue;
    b[FENCE_Y][x] = true;
  }
  // farm fence east edge (between field and road), gate gap
  for (let y = FARM.y0; y <= FENCE_Y; y++) {
    if (y % 4 === 0 && !GATE_X.includes(FARM_PATH_X)) continue;
    b[y][FARM_PATH_X - 1] = true;
  }
  return b;
}

// ── Buildings ── (tex key, tile anchor, footprint, door tile, glow)
export const BUILDINGS = [
  {
    key: 'house', tex: 'bld.house', glow: 'bld.house_glow',
    x: 18, y: 40, w: 4, h: 4,
    door: { x: 18, y: 44 },
    label: 'HOME', action: 'sleep',
  },
  {
    key: 'shop', tex: 'bld.shop', glow: 'bld.shop_glow',
    x: 18, y: 28, w: 4, h: 4,
    door: { x: 18, y: 32 },
    label: 'SUPPLY DEPOT', action: 'shop',
  },
  {
    key: 'tavern', tex: 'bld.tavern', glow: 'bld.tavern_glow',
    x: 28, y: 28, w: 4, h: 4,
    door: { x: 28, y: 32 },
    label: 'STARDUST TAVERN', action: 'talk_rhea',
  },
  {
    key: 'exchange', tex: 'bld.exchange', glow: 'bld.exchange_glow',
    x: 38, y: 28, w: 4, h: 4,
    door: { x: 38, y: 32 },
    label: 'GRAND EXCHANGE', action: 'exchange',
  },
  {
    key: 'barracks', tex: 'bld.barracks',
    x: 28, y: 40, w: 4, h: 4,
    door: { x: 28, y: 44 },
    label: 'COLONY BARRACKS', action: 'barracks',
  },
  {
    key: 'barn', tex: 'bld.barn',
    x: 4, y: 4, w: 4, h: 4,
    door: { x: 5, y: 8 },
    label: 'RANCH', action: 'ranch',
  },
];

// ── Decor ── (tex key, tile anchor)
export const DECOR = [
  // solar lamps — roads + downtown + lake shore
  { tex: 'decor.lamp', x: 24, y: 22 },
  { tex: 'decor.lamp', x: 26, y: 24 },
  { tex: 'decor.lamp', x: 33, y: 24 },
  { tex: 'decor.lamp', x: 26, y: 15 },
  { tex: 'decor.lamp', x: 10, y: 38 },
  // alien planters by the farm + downtown
  // QA 0904: this used to sit at (6,4) — ON the barn footprint (4..7,4..7), so
  // a planter sprouted out of the ranch pod's hull. Moved clear south of it.
  { tex: 'decor.planter', x: 6, y: 10 },
  { tex: 'decor.planter', x: 14, y: 4 },
  { tex: 'decor.planter', x: 24, y: 28 },
  // stardust lake (fishing spot) — NE shore
  { tex: 'decor.pond', x: 26, y: 15 },
  // cargo / water barrels by the shop
  { tex: 'decor.barrel_cargo', x: 26, y: 33 },
  { tex: 'decor.barrel_water', x: 27, y: 33 },
  // colony props — tech world-feel along the downtown street
  { tex: 'decor.colony_solar', x: 30, y: 33 },
  { tex: 'decor.colony_antenna', x: 34, y: 33 },
  { tex: 'decor.colony_holosign', x: 38, y: 33 },
  { tex: 'decor.colony_crate', x: 36, y: 33 },
  { tex: 'decor.colony_antenna', x: 40, y: 33 },
  // forest grove — dense trees for depth
  { tex: 'decor.tree_leaf', x: 54, y: 6 },
  { tex: 'decor.tree_leaf', x: 58, y: 10 },
  { tex: 'decor.tree_leaf', x: 56, y: 16 },
  { tex: 'decor.tree_bloom', x: 60, y: 22 },
  { tex: 'decor.tree_leaf', x: 55, y: 28 },
  { tex: 'decor.tree_bloom', x: 59, y: 34 },
  { tex: 'decor.tree_leaf', x: 57, y: 40 },
  // alien bushes — edges + corners
  { tex: 'decor.bush', x: 1, y: 1 },
  { tex: 'decor.bush', x: 62, y: 1 },
  { tex: 'decor.bush', x: 1, y: 46 },
  { tex: 'decor.bush', x: 62, y: 46 },
  { tex: 'decor.bush', x: 46, y: 20 },
  { tex: 'decor.bush', x: 20, y: 46 },
  { tex: 'decor.bush', x: 47, y: 45 },
  // trees — natural canopy for depth & scale (walkable under)
  { tex: 'decor.tree_leaf', x: 6, y: 3 },
  { tex: 'decor.tree_leaf', x: 18, y: 3 },
  { tex: 'decor.tree_leaf', x: 12, y: 2 },
  { tex: 'decor.tree_leaf', x: 1, y: 20 },
  { tex: 'decor.tree_bloom', x: 8, y: 46 },
  { tex: 'decor.tree_bloom', x: 12, y: 46 },
  { tex: 'decor.tree_bloom', x: 48, y: 46 },
  { tex: 'decor.tree_bloom', x: 52, y: 46 },
  // bioluminescent alien flora — the colony's own glowing biomes
  { tex: 'decor.alien_flora', x: 10, y: 46 },
  { tex: 'decor.alien_flora', x: 46, y: 4 },
  { tex: 'decor.alien_flora', x: 20, y: 46 },
  { tex: 'decor.alien_flora', x: 4, y: 26 },
  // (the flora that used to sit at 42,44 stood in the lake's south arm — see
  //  the corrected placement beside the downtown row, QA 0904 layout audit)
  // ── ambient life along the roads (so the colony streets feel alive) ──
  { tex: 'decor.lamp', x: 24, y: 4 },
  { tex: 'decor.lamp', x: 25, y: 10 },
  { tex: 'decor.lamp', x: 24, y: 18 },
  { tex: 'decor.lamp', x: 25, y: 32 },
  { tex: 'decor.lamp', x: 24, y: 40 },
  { tex: 'decor.lamp', x: 24, y: 46 },
  { tex: 'decor.lamp', x: 4, y: 22 },
  { tex: 'decor.lamp', x: 14, y: 23 },
  { tex: 'decor.lamp', x: 32, y: 22 },
  { tex: 'decor.lamp', x: 44, y: 22 },
  { tex: 'decor.lamp', x: 50, y: 23 },
  { tex: 'decor.lamp', x: 58, y: 22 },
  // colony tech props along the street + lake shore
  { tex: 'decor.colony_solar', x: 25, y: 12 },
  { tex: 'decor.colony_antenna', x: 25, y: 20 },
  { tex: 'decor.colony_holosign', x: 26, y: 26 },
  { tex: 'decor.colony_crate', x: 24, y: 34 },
  { tex: 'decor.colony_antenna', x: 25, y: 42 },
  { tex: 'decor.colony_solar', x: 27, y: 12 },
  // scattered trees / bushes / flora to break up open grass
  { tex: 'decor.tree_leaf', x: 10, y: 18 },
  { tex: 'decor.tree_bloom', x: 48, y: 8 },
  { tex: 'decor.tree_leaf', x: 50, y: 30 },
  { tex: 'decor.bush', x: 18, y: 18 },
  { tex: 'decor.bush', x: 48, y: 26 },
  { tex: 'decor.alien_flora', x: 50, y: 44 },
  { tex: 'decor.alien_flora', x: 12, y: 24 },
  { tex: 'decor.alien_flora', x: 46, y: 12 },
  // QA 0904 layout audit: this one shipped ON the lake's south arm (water tile
  // at 42,44) — a glowing plant standing in the lake read as a placement bug.
  { tex: 'decor.alien_flora', x: 38, y: 44 },
  // ── QA 0904 Stage 1.5: flora in CLUSTERS, not singles ──
  // A 64x48 world dotted with lone trees read as errors ("why is there one rock
  // here?"); real terrain grows life in groves, thickets, and patches with a
  // dense core and a scattered skirt. Every cluster below is 4-7 items with
  // at least two touching tiles. Trees/bushes/flora are visual-only (never in
  // BLOCKING_DECOR), so walkability is unaffected — verifyWalkability still
  // runs on every layout edit regardless.
  // thicket W of the farm field (NW quadrant was one-tree-empty)
  { tex: 'decor.tree_leaf', x: 4, y: 14 },
  { tex: 'decor.tree_leaf', x: 5, y: 14 },
  { tex: 'decor.tree_leaf', x: 4, y: 15 },
  { tex: 'decor.bush', x: 5, y: 15 },
  { tex: 'decor.bush', x: 3, y: 15 },
  { tex: 'decor.alien_flora', x: 4, y: 16 },
  { tex: 'decor.alien_flora', x: 6, y: 15 },
  // grove SE of the lake shore (NE quadrant filler)
  { tex: 'decor.tree_bloom', x: 44, y: 6 },
  { tex: 'decor.tree_bloom', x: 45, y: 7 },
  { tex: 'decor.tree_leaf', x: 44, y: 7 },
  { tex: 'decor.bush', x: 45, y: 6 },
  { tex: 'decor.alien_flora', x: 43, y: 7 },
  { tex: 'decor.alien_flora', x: 46, y: 8 },
  // riverside thicket, west bank mid-map (the long empty centre-west strip)
  { tex: 'decor.tree_leaf', x: 16, y: 28 },
  { tex: 'decor.tree_leaf', x: 17, y: 29 },
  { tex: 'decor.tree_bloom', x: 16, y: 29 },
  { tex: 'decor.bush', x: 17, y: 28 },
  { tex: 'decor.bush', x: 15, y: 29 },
  { tex: 'decor.alien_flora', x: 16, y: 30 },
  // meadow patch S of the cross road, east of the river (empty centre-east).
  // QA: two earlier placements failed the layout audit — y27-28 landed ON the
  // exchange footprint, y40-41 landed in the lake's south arm. This pocket was
  // verified clear of water/blocks/buildings by the layout meta-check.
  { tex: 'decor.tree_bloom', x: 36, y: 39 },
  { tex: 'decor.tree_leaf', x: 37, y: 40 },
  { tex: 'decor.tree_bloom', x: 37, y: 39 },
  { tex: 'decor.bush', x: 36, y: 40 },
  { tex: 'decor.alien_flora', x: 38, y: 40 },
  { tex: 'decor.alien_flora', x: 35, y: 40 },
  // minefoot scatter, SW rock slope base (was a lone rock quadrant)
  { tex: 'decor.bush', x: 8, y: 36 },
  { tex: 'decor.bush', x: 9, y: 37 },
  { tex: 'decor.alien_flora', x: 8, y: 37 },
  { tex: 'decor.alien_flora', x: 10, y: 37 },
  { tex: 'decor.tree_leaf', x: 9, y: 36 },
  // ── flora skirts — every non-border lone plant got a verified companion so
  //    no single tile stands alone (computed against ground/blocks/BUILDINGS) ──
  { tex: 'decor.bush', x: 55, y: 6 },
  { tex: 'decor.bush', x: 59, y: 10 },
  { tex: 'decor.bush', x: 57, y: 16 },
  { tex: 'decor.bush', x: 61, y: 22 },
  { tex: 'decor.bush', x: 56, y: 28 },
  { tex: 'decor.bush', x: 60, y: 34 },
  { tex: 'decor.bush', x: 58, y: 40 },
  { tex: 'decor.bush', x: 47, y: 20 },
  { tex: 'decor.bush', x: 6, y: 2 },
  { tex: 'decor.bush', x: 19, y: 3 },
  { tex: 'decor.bush', x: 5, y: 26 },
  { tex: 'decor.bush', x: 11, y: 18 },
  { tex: 'decor.bush', x: 51, y: 30 },
  { tex: 'decor.bush', x: 19, y: 18 },
  { tex: 'decor.bush', x: 49, y: 26 },
  { tex: 'decor.bush', x: 13, y: 24 },
  { tex: 'decor.bush', x: 47, y: 12 },
  { tex: 'decor.bush', x: 39, y: 44 },
  { tex: 'decor.bush', x: 13, y: 2 },
  { tex: 'decor.bush', x: 2, y: 20 },
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

// ── NPC tile positions (spread across the world) ──
export const NPC_POS = {
  nova: { x: 12, y: 6 },    // farm
  luna: { x: 27, y: 14 },   // lake shore
  zephyr: { x: 38, y: 34 }, // downtown
  vega: { x: 8, y: 6 },     // farm
  quasar: { x: 8, y: 34 },  // mine
  rhea: { x: 32, y: 33 },   // downtown (tavern)
  astra: { x: 14, y: 22 },  // crossroads west
  orion: { x: 7, y: 12 },   // farm
  comet: { x: 26, y: 44 },  // downtown (south plaza)
  cora: { x: 55, y: 12 },   // forest
};

export const PLAYER_START = { x: 24, y: 21 }; // central crossroads

// ── world activity spots (scene-agnostic): stays on-map & walkable ──
export const MINE_SPOT = { x: 10, y: 38 };       // vein in the mine mountain
export const DEEP_DROP_SPOT = { x: 27, y: 15 };  // the lake's far shore (rare/night fish)

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
    MINE_SPOT,
    DEEP_DROP_SPOT,
  ];
  for (const p of mustReach) {
    if (seen[p.y] && seen[p.y][p.x]) report.reachable++;
    else report.unreachable.push(p);
  }
  report.ok = report.unreachable.length === 0;
  return report;
}

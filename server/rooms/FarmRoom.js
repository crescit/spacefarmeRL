// FarmRoom.js — Colyseus room for Space Farmer
// Each room = one planet instance with up to 16 players
const { Room } = require('@colyseus/core');
const { Schema, ArraySchema, defineTypes } = require('@colyseus/schema');
const { savePlayer, loadPlayer } = require('../persistence');
// The B-612 calendar is a SERVICE we depend on, never reimplemented here:
// days-per-season, season boundaries, growth pacing, crop maturity, and the
// yearly festival dates all come from the single shared module. Inject a
// different Calendar for tests/variants via FarmRoom.calendar or room.calendar.
const { createCalendar, DEFAULT_CALENDAR } = require('../../shared/calendar.js');

// ── Schema definitions ──

// 'The Stardust Story' — per-player quest progress (server-authoritative).
// The quest DEFINITIONS (titles, objectives, rewards) live in the QUESTS table
// below; this schema only tracks WHICH quest + per-objective counters, so the
// server can validate objective completion and award rewards.
class QuestState extends Schema {
  constructor() {
    super();
    this.current = '';        // quest id in progress ('' = none / arc complete)
    this.completed = new ArraySchema(); // ids of finished quests, in order
    this.progress = {};      // `${questId}::${objectiveIndex}` → numeric count
    this.arcDone = false;    // the whole 3-act story is finished
  }
}
defineTypes(QuestState, {
  current: 'string',
  completed: { array: 'string' },
  progress: { map: 'number' },
  arcDone: 'boolean',
});

class Player extends Schema {
  constructor(id, name) {
    super();
    this.id = id;
    this.playerId = '';   // stable client-provided identity (save key)
    this.name = name;
    this.x = 200;
    this.y = 200;
    this.credits = 100;
    this.energy = 100;
    this.tutorialComplete = false;
    this.friendships = {};   // npcId → 0..100 (Harvest Moon-style bond)
    this.lastTalkDay = {};   // npcId → day they were last talked to (daily +2 cap)
    this.heartEvents = {};   // npcId → highest friendship threshold event already shown
    this.marriedTo = '';    // npcId when married
    this.giftsGiven = {};    // npcId → count of gifts given (for event pacing)
    this.inventory = {};     // item → count (starter items granted in onJoin for new farmers)
    this.storage = {};           // chest contents (safe-kept harvests)
    this.tool = 'base';          // hoe tier: base → iron → gold
    this.animals = {};           // species → count owned (auto-wraps to MapSchema)
    this.animalsFedDay = {};     // species → last day fed
    this.mineHp = 0;             // current vein's remaining swings (0 = idle)
    this.mineMax = 0;            // vein hardness: swings needed to break it
    this.staminaMax = 100;       // stamina ceiling — trains up with hard work (a skill you build)
    this.todayWork = 0;          // stamina spent today (drives conditioning + overnight recovery)
    this.quests = new QuestState();   // 'The Stardust Story' progress (server-authoritative)
    this.lifetime = {};          // lifetime totals (earned, harvested, sold, fished, mined, gifts) — survive New Game+
    this.ngPlus = 0;             // New Game+ cycle count (0 = first playthrough)
    this.milestonesSeen = {};    // milestoneId → 1 (toast fires once per save)
  }
}
defineTypes(Player, {
  id: 'string', playerId: 'string', name: 'string', x: 'number', y: 'number',
  credits: 'number', energy: 'number',
  tutorialComplete: 'boolean',
  friendships: { map: 'number' },
  lastTalkDay: { map: 'number' },
  heartEvents: { map: 'number' },
  marriedTo: 'string',
  giftsGiven: { map: 'number' },
  inventory: { map: 'number' },
  storage: { map: 'number' },  // chest storage at home (safe-kept items)
  tool: 'string',         // hoe tier: 'base' | 'iron' | 'gold'
  animals: { map: 'number' },    // species → count owned (chicken, cow, sheep…)
  animalsFedDay: { map: 'number' }, // species → last day fed
  mineHp: 'number',                 // mining vein progress (swings remaining)
  mineMax: 'number',                // vein hardness (total swings to break it)
  staminaMax: 'number',             // stamina ceiling (trains up with hard work)
  todayWork: 'number',              // stamina spent so far today (conditioning tally)
  quests: { type: QuestState },     // 'The Stardust Story' quest progress
  lifetime: { map: 'number' },      // lifetime totals across New Game+ cycles
  ngPlus: 'number',                 // NG+ cycle count
  milestonesSeen: { map: 'number' },// milestoneId → 1
});

class Tile extends Schema {
  constructor(x, y) {
    super();
    this.x = x;
    this.y = y;
    this.type = 'empty'; // empty, tilled, seeded, growing, mature
    this.crop = '';      // crop type if planted
    this.growthDay = 0;
    this.watered = false;
  }
}
defineTypes(Tile, {
  x: 'number', y: 'number', type: 'string', crop: 'string',
  growthDay: 'number', watered: 'boolean'
});

class FarmPlot extends Schema {
  constructor(playerId) {
    super();
    this.playerId = playerId;
    this.tiles = new ArraySchema();
    this.tier = 1;
    this.houseLevel = 1;
    // 8x8 grid
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) {
        const tile = new Tile(x, y);
        this.tiles.push(tile);
      }
    }
  }
}
defineTypes(FarmPlot, {
  playerId: 'string', tiles: { array: Tile }, tier: 'number', houseLevel: 'number'
});

class GrandExchangeOrder extends Schema {
  constructor(item, quantity, price, type, playerId) {
    super();
    this.item = item;
    this.quantity = quantity;
    this.price = price;
    this.type = type;
    this.playerId = playerId;
  }
}
defineTypes(GrandExchangeOrder, {
  item: 'string', quantity: 'number', price: 'number',
  type: 'string', playerId: 'string'
});

class FarmState extends Schema {
  constructor() {
    super();
    this.players = {};
    this.farms = {};
    this.orders = new ArraySchema();
    this.day = 0;
    this.time = 360;
    this.isDay = true;
    this.season = 0;   // start in spring
    this.festival = false;      // no festival on day 0
    this.festivalClaimed = false;
    this.festivalPhase = 'none'; // M3: 'none' | 'setup' | 'feast' | 'afterglow'
    this.feastPeak = false;      // M3: the Earth Feast was served this festival day
  }
}
defineTypes(FarmState, {
  players: { map: Player },
  farms: { map: FarmPlot },
  orders: { array: GrandExchangeOrder },
  day: 'number', time: 'number', isDay: 'boolean',
  season: 'number',   // 0=spring 1=summer 2=fall 3=winter
  festival: 'boolean', // today is a seasonal festival day
  festivalClaimed: 'boolean', // someone claimed the festival reward today
  festivalPhase: 'string',    // M3: none|setup|feast|afterglow (drives the spectacle)
  feastPeak: 'boolean'        // M3: the feast has peaked this festival day
});

// ── Friendship gift-affinity tables (single source: the StoryBank) ──
// The per-NPC loved/liked/hated gift lists are story facts — they live ONCE
// in shared/story/npcs.js, next to the dialogue that says them aloud. This
// room derives its table from the bank instead of mirroring it, so the gift
// you offer, the line the NPC speaks, and the agent's tool schema can never
// disagree about what Nova loves.
// loved → +15, liked → +5, hated → -8, neutral → +2
const NPC_DATA = require('../../shared/story/npcs.js');
const NPC_GIFTS = Object.fromEntries(
  Object.entries(NPC_DATA).map(([id, npc]) => [
    id,
    { loved: npc.lovedGift, liked: npc.likedGifts, hated: npc.hatedGifts },
  ]),
);
const HEART_THRESHOLDS = [20, 40, 60, 80, 100];

// ── Tool upgrades (hoe tiers) ──
// Higher tiers let you farm more efficiently (client reads tier for energy cost).
const TOOLS = {
  base: { name: 'Basic Hoe',  next: 'iron',  cost: 150, energyMult: 1.0 },
  iron: { name: 'Iron Hoe',   next: 'gold',  cost: 400, energyMult: 0.8 },
  gold: { name: 'Gold Hoe',   next: null,   cost: 0,    energyMult: 0.6 },
};

// ── Energy: one table, one gate. Every action that spends energy goes
//    through _energyCost()/_spendEnergy() on the room — nothing else mutates
//    a player's energy. Base costs below; tool tiers (energyMult) scale farm
//    work. Each rest (day advance) refills +30 energy, so the budget is real
//    but forgiving. The browser and the RL env both call these exact handlers,
//    so humans and agents pay the same price for the same work. ──
const ENERGY_COSTS = { till: 5, plant: 5, water: 5, harvest: 5, fish: 10, mine: 5 };

// ── Stamina (a skill you build, not a tax you pay). Work costs stamina;
//    resting/living overnight recovers STAmina_REST_RATE toward the ceiling;
//    and doing real work conditions the body — staminaMax creeps up over
//    days of honest labor, capped at STAMINA_MAX. Tool tiers are technique:
//    a better hoe spends less stamina per action. ──
const STAMINA_REST_RATE = 30;    // how much rest returns each night
const STAMINA_TRAIN_RATE = 2;    // ceiling grows +2 after a day with any real work
const STAMINA_MAX = 150;         // how far conditioning can push the ceiling

// ── The Kitchen (M4): named recipes instead of one generic "cooked-food" ──
// Each recipe = 2-3 real ingredients the player can actually gather (6 crops,
// 4 fish, egg/milk/wool). `season` is the FLAVOR label (what season it tastes
// best in) shown in the recipe book — it does NOT hard-block cooking, because
// gating every recipe to its season would dead-end play when an ingredient
// ran out; seasonal crops already gate the ingredients in practice.
// Earth-feast-plate is THE festival dish (gates q3_earth_feast), made only on
// a festival day, using three ingredients at once.
const RECIPES = {
  // Spring — light, fresh
  'space-pudding':        { name: 'Space Pudding',        season: 0, ingredients: ['space-wheat', 'egg'],                sell: 70 },
  'green-nebula-broth':   { name: 'Green Nebula Broth',   season: 0, ingredients: ['space-wheat', 'egg', 'milk'],         sell: 110 },
  'wheat-star-salad':     { name: 'Wheat & Star Salad',   season: 0, ingredients: ['space-wheat', 'star-berry'],          sell: 60 },
  // Summer — rich, heavy
  'nebula-stew':          { name: 'Nebula Stew',          season: 1, ingredients: ['space-wheat', 'plasma-tomato'],      sell: 90 },
  'melon-nectar-cobbler': { name: 'Melon Nectar Cobbler', season: 1, ingredients: ['moon-melon', 'egg'],                 sell: 95 },
  'plasma-skewer':        { name: 'Plasma Skewer',        season: 1, ingredients: ['plasma-tomato', 'space-wheat'],      sell: 85 },
  // Autumn — foraged, warm
  'berry-tart':           { name: 'Berry Tart',           season: 2, ingredients: ['star-berry', 'egg', 'space-wheat'],  sell: 100 },
  'melon-crostata':       { name: 'Melon Crostata',       season: 2, ingredients: ['moon-melon', 'egg'],                 sell: 90 },
  'autumn-roast':         { name: 'Autumn Roast',         season: 2, ingredients: ['space-wheat', 'plasma-tomato', 'egg'], sell: 130 },
  // Deep-space — rare fish, premium
  'stellar-fish-curry':   { name: 'Stellar Fish Curry',   season: 1, ingredients: ['moonfish', 'space-wheat'],           sell: 95 },
  'comet-trout-grille':   { name: 'Comet Trout Grille',   season: 2, ingredients: ['comet-trout', 'egg'],                sell: 150 },
  'solar-omakase':        { name: 'Solar Omakase',        season: 1, ingredients: ['stardust-salmon', 'nebula-marlin'], sell: 280 },
  // THE festival dish — the climax quest's plate
  'earth-feast-plate':    { name: 'Earth Feast Plate',    season: null, festival: true,
                            ingredients: ['space-wheat', 'egg', 'moon-melon'], sell: 300 },
};
// sell price of each named dish (raw ingredients sell for ~2-4x less).
const DISH_SELL = {}; for (const k in RECIPES) DISH_SELL[k] = RECIPES[k].sell;
// distinct friendship bonuses per dish per NPC (in addition to base gift tiers).
// Rhea loves the Earth Feast Plate (+30); Nova likes Solar Omakase (+15); etc.
const DISH_GIFT_BONUS = {
  'earth-feast-plate':    { rhea: 30, nova: 15, astra: 10, vega: 10, luna: 8 },
  'solar-omakase':        { nova: 15, rhea: 8, comet: 8, astra: 6 },
  'autumn-roast':         { rhea: 10, quasar: 8, astra: 8, vega: 6 },
  'green-nebula-broth':   { luna: 10, vega: 8, rhea: 6 },
  'melon-nectar-cobbler': { rhea: 8, luna: 6, cora: 6 },
  'comet-trout-grille':   { comet: 10, nova: 6, orion: 6 },
  'space-pudding':        { rhea: 6, cora: 6 },
  'nebula-stew':          { rhea: 6, quasar: 6 },
  'berry-tart':           { luna: 6, rhea: 6 },
  'plasma-skewer':        { vega: 6, quasar: 6 },
  'stellar-fish-curry':   { luna: 6, nova: 6 },
  'wheat-star-salad':     { astra: 6, zephyr: 6 },
};

// ── Livestock (Harvest Moon-style ranching) ──
// Feed an animal each morning → it produces a sellable good the next morning.
const ANIMALS = {
  chicken: { label: 'Chicken', cost: 100, produce: { item: 'egg', qty: 1 },
             feedCost: 0, season: null },
  cow:     { label: 'Cow',     cost: 350, produce: { item: 'milk', qty: 1 },
             feedCost: 0, season: null },
  sheep:   { label: 'Sheep',    cost: 300, produce: { item: 'wool', qty: 1 },
             feedCost: 0, season: null },
};
// produce prices (sell handler)
const PRODUCE_PRICES = { egg: 25, milk: 30, wool: 45 };

// Seasonal farming depth: each crop only truly grows in its listed seasons,
// and `regrow` marks CONTINUOUS crops (harvest again & again) vs one-time (replant).
const CROP_INFO = {
  'space-wheat':    { seasons: [0, 2], regrow: true,  cr: 20 },
  'star-berry':     { seasons: [1],    regrow: true,  cr: 14 },
  'moon-melon':     { seasons: [1, 2], regrow: false, cr: 26 },
  'plasma-tomato':  { seasons: [0, 1], regrow: false, cr: 22 },
  'nebula-pepper':  { seasons: [2],    regrow: true,  cr: 30 },
  'glow-kelp':      { seasons: [3],    regrow: true,  cr: 18 },
};

// Fishing depth: a fish is only catchable at certain spots, in certain seasons,
// and (for some) only at NIGHT. `night:true` = night-only; `night:false` = any time.
const FISH_INFO = {
  'moonfish':         { worth: 25,  spots: ['stardust', 'deep'], seasons: [0, 1, 3], night: false },
  'stardust-salmon':  { worth: 45,  spots: ['stardust'],          seasons: [1, 2],    night: false },
  'comet-trout':      { worth: 65,  spots: ['stardust'],          seasons: [2, 3],    night: true },
  'nebula-marlin':    { worth: 120, spots: ['deep'],              seasons: [3],       night: true },
};

// ══ 'THE STARDUST STORY' — the quest arc ═════════════════════════════════
// 3 acts / 14 quests. Every objective maps to an EXISTING server event, so the
// arc composes out of gameplay that already works:
//   talk, plant, harvest, sell, fish, mine, cook, gift, feed, animal, tool,
//   friendship, festival.
// Objective matching (server-side, in questHit):
//   - count-based  (plant/harvest/fish/mine/cook/gift/feed/talk/animal/festival)
//       progress += 1 per matching event; done at progress >= n
//   - value-based  (sell)  progress += credits earned; done at progress >= n
//   - level-based  (tool)  done when the player's tool tier is reached
//   - social       (friendship)  progress = count of NPCs at the bond level
// `festival:true` on an objective only counts while state.festival is set.
const QUESTS = {
  // ── ACT 1 — THE DEBT (learn the farm, meet the colony, pay Quasar) ──
  q1_meet_quasar: {
    act: 1, giver: 'quasar', title: 'A Very Large Debt',
    brief: 'Grandpa left the farm behind him — and a very large unpaid bill. Quasar the mechanic says he\u2019s "all caught up in paperwork." Find him and hear the bad news yourself.',
    objectives: [
      { type: 'talk', n: 1, npc: 'quasar', label: 'Talk to Quasar' },
    ],
    reward: {}, next: 'q1_first_soil',
  },
  q1_first_soil: {
    act: 1, giver: 'quasar', title: 'Back to the Soil',
    brief: 'A farm earns nothing standing still. Quasar still has Grandpa\u2019s wrench (borrowed "for quality control"). Get the field working again.',
    objectives: [
      { type: 'plant', n: 4, label: 'Plant 4 crops' },
    ],
    reward: { credits: 30, items: { 'seeds': 5 } }, next: 'q1_first_harvest',
  },
  q1_first_harvest: {
    act: 1, giver: 'rhea', title: 'Something to Grow',
    brief: 'Water them, let the sun do its thing, and cut what\u2019s ripe. Rhea says a colony that feeds itself can\u2019t go dark.',
    objectives: [
      { type: 'harvest', n: 3, label: 'Harvest 3 crops' },
    ],
    reward: { credits: 40, items: { 'cooked-food': 1 } }, next: 'q1_learn_fish',
  },
  q1_learn_fish: {
    act: 1, giver: 'luna', title: 'The Shore Is Watching You',
    brief: 'Luna says the stardust shore "bites back" if you\u2019re not patient. It bites either way, apparently. Catch one.',
    objectives: [
      { type: 'fish', n: 1, label: 'Catch 1 fish' },
    ],
    reward: { credits: 50 }, next: 'q1_debt_installment',
  },
  q1_debt_installment: {
    act: 1, giver: 'quasar', title: 'The First Installment',
    brief: 'The Exchange pays in credits; the wrench comes back on the first payment. Quasar will say it was "always going to be fine." He won\u2019t look at you.',
    objectives: [
      { type: 'sell', n: 150, label: 'Earn 150cr selling at the Exchange' },
      { type: 'talk', n: 1, npc: 'quasar', label: 'Talk to Quasar' },
    ],
    reward: { credits: 200 }, next: 'q2_meet_nova',
  },
  // ── ACT 2 — THE FAILING HEART (the colony generator is dying) ──
  q2_meet_nova: {
    act: 2, giver: 'nova', title: 'The Light Is Old',
    brief: 'The cantina\u2019s "old supernova light" drink? That\u2019s generator output, straight up. Nova keeps the colony\u2019s heart warm — and the gauge isn\u2019t lying. Time to do the maintenance.',
    objectives: [
      { type: 'talk', n: 1, npc: 'nova', label: 'Talk to Nova' },
    ],
    reward: { credits: 30 }, next: 'q2_mine_crystal',
  },
  q2_mine_crystal: {
    act: 2, giver: 'nova', title: 'Picking at the Rock',
    brief: 'The old veins near the colony are tired but they\u2019re not done. Three good hauls of ore and Nova can rebuild the intake.',
    objectives: [
      { type: 'mine', n: 3, label: 'Mine 3 ores' },
    ],
    reward: { credits: 60, items: { 'tech-part': 1 } }, next: 'q2_upgrade_tool',
  },
  q2_upgrade_tool: {
    act: 2, giver: 'quasar', title: 'Worth His Wrench',
    brief: 'The generator work needs clean cuts, not Grandpa\u2019s basic hoe. Quasar finally parts with the iron one. "It was never really mine," he says.',
    objectives: [
      { type: 'tool', n: 1, tool: 'iron', label: 'Upgrade to the Iron Hoe' },
    ],
    reward: { credits: 100 }, next: 'q2_cook_feast',
  },
  q2_cook_feast: {
    act: 2, giver: 'rhea', title: 'Fuel Is Also Dinner',
    brief: 'The generator runs on heat, and so do people. Rhea\u2019s kitchen is the colony\u2019s real engine room. Cook for it, then let her decide who eats.',
    objectives: [
      { type: 'cook', n: 2, label: 'Cook 2 dishes' },
      { type: 'gift', n: 1, item: 'cooked-food', label: 'Give a dish to a villager' },
    ],
    reward: { credits: 80 }, next: 'q2_bond',
  },
  q2_bond: {
    act: 2, giver: 'astra', title: 'A Colony Is People',
    brief: 'Astra\u2019s ledger has one column nobody audits: who actually shows up for the other people. Two villagers, steady. She\u2019ll note it.',
    objectives: [
      { type: 'friendship', n: 40, count: 2, label: 'Reach 40 bond with 2 villagers' },
    ],
    reward: { credits: 100 }, next: 'q3_animal_farm',
  },
  // ── ACT 3 — EARTH DAY (the festival is the finale) ──
  q3_animal_farm: {
    act: 3, giver: 'vega', title: 'Helmets on the Cows',
    brief: 'Vega\u2019s space ranch is the only place the colony\u2019s livestock look the part. Two animals, fed and helmeted. The solar wind does not negotiate.',
    objectives: [
      { type: 'animal', n: 2, label: 'Own 2 animals' },
      { type: 'feed', n: 1, label: 'Feed an animal' },
    ],
    reward: { credits: 80 }, next: 'q3_festival_stock',
  },
  q3_festival_stock: {
    act: 3, giver: 'comet', title: 'Stocks for the Big Day',
    brief: 'Hearthnight — the colony\u2019s Sol Earth Festival — comes the 25th of every winter. Comet\u2019s trading post needs a buffer: the whole colony eats in one night. Sell enough, and add one fish to the reserve.',
    objectives: [
      { type: 'sell', n: 300, label: 'Earn 300cr selling' },
      { type: 'fish', n: 1, label: 'Catch 1 fish for the reserve' },
    ],
    reward: { credits: 120 }, next: 'q3_earth_feast',
  },
  q3_earth_feast: {
    act: 3, giver: 'rhea', title: 'The Earth Feast',
    brief: 'On Hearthnight the whole colony eats Earth rations — the meal that tastes like grief and salt. Rhea needs three dishes ready before the line wraps the block.',
    objectives: [
      { type: 'cook', n: 3, festival: true, dish: 'earth-feast-plate', label: 'Cook 3 Earth Feast Plates on festival day' },
    ],
    reward: { credits: 150, items: { 'cooked-food': 2 } }, next: 'q3_heart_of_stardust',
  },
  q3_heart_of_stardust: {
    act: 3, giver: 'nova', title: 'The Heart of Stardust',
    brief: 'The last maintenance is the core itself. Nova wants the old heart running one more Hearthnight — then the stardust core goes in and the light stops being old. It stops being anyone\u2019s grief.',
    objectives: [
      { type: 'mine', n: 5, label: 'Mine 5 more ores for the core' },
      { type: 'festival', n: 1, label: 'Attend the festival' },
      { type: 'talk', n: 1, npc: 'nova', label: 'Talk to Nova' },
    ],
    reward: { credits: 500, items: { 'stardust-core': 1 } }, next: null,
  },
};
const QUEST_ORDER = [
  'q1_meet_quasar', 'q1_first_soil', 'q1_first_harvest', 'q1_learn_fish', 'q1_debt_installment',
  'q2_meet_nova', 'q2_mine_crystal', 'q2_upgrade_tool', 'q2_cook_feast', 'q2_bond',
  'q3_animal_farm', 'q3_festival_stock', 'q3_earth_feast', 'q3_heart_of_stardust',
];


// ── Room ──

// Deterministic PRNG (mulberry32). Live play keeps Math.random; the RL env
// (rl/env_core.mjs) injects a seeded one via room.setRng(seed) so every
// stochastic seam — fishing pool, vein hardness, ore roll, festival NPC —
// replays identically episode to episode.
// getState/setState expose the internal stream position so a mid-episode
// checkpoint can capture — and a restore replay — the exact point in the
// random sequence (save/load determinism, RL trajectory replay).
function mulberry32(seed) {
  let a = seed >>> 0;
  const fn = function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  fn.getState = () => a >>> 0;
  fn.setState = (s) => { a = s >>> 0; };
  return fn;
}

class FarmRoom extends Room {
  // Calendar service injection seam: FarmRoom.calendar (class-level) defaults
  // the whole class; per-room this.calendar overrides it; everything else
  // falls back to the shared DEFAULT_CALENDAR. The RL env injects its own via
  // room.calendar so a variant calendar reaches every handler unchanged.
  static calendar = DEFAULT_CALENDAR;

  constructor(...args) {
    super(...args);
    this.calendar = FarmRoom.calendar || DEFAULT_CALENDAR;
  }

  _cal() { return this.calendar || FarmRoom.calendar || DEFAULT_CALENDAR; }

  onCreate() {
    this.setState(new FarmState());
    this.rng = Math.random;      // stochastic seam (see setRng)
    this._persistence = true;   // live room: save/load on join/leave/advance
    // empty simulation tick (colyseus 0.17 signature: (callback, delay));
    // day-advance is message-driven via onAdvanceDay, so nothing runs here.
    this.setSimulationInterval(() => {}, 166);
    // M3 — Earth Day spectacle: a festival day runs through phases
    // setup (morning) → feast (a few hours later) → afterglow (next morning).
    // Headless/test rooms (no setSimulationInterval) just set the phase
    // directly; see _applyFestivalPhase.
    this._festTimers = [];
    this._festTimers.push(this.setSimulationInterval(() => {
      if (this.state.festival && this.state.festivalPhase === 'setup') this._applyFestivalPhase('feast');
    }, 5 * 60 * 1000));
    // periodic autosave — even if a player never advances a day or leaves
    // cleanly, their progress flushes every 90s while they're in the room.
    this.setSimulationInterval(() => {
      this.state.players.forEach((p) => { if (p) this.saveNow(p.id, false); });
    }, 90000);

    // ── register message handlers (colyseus 0.17: this.onMessage(type, (client, data) => …)) ──
    this.onMessage('move', (client, data) => this.onMove(client, data));
    this.onMessage('plant', (client, data) => this.onPlant(client, data));
    this.onMessage('water', (client, data) => this.onWater(client, data));
    this.onMessage('harvest', (client, data) => this.onHarvest(client, data));
    this.onMessage('till', (client, data) => this.onTill(client, data));
    this.onMessage('sell', (client, data) => this.onSell(client, data));
    this.onMessage('order', (client, data) => this.onOrder(client, data));
    // reply-capable handlers: colyseus 0.17 no longer auto-replies return values,
    // so explicitly send the result back to the caller via client.send(type, result).
    this.onMessage('gift', (client, data) => {
      const result = this.onGift(client, data);
      if (client && client.send) client.send('gift', result);
    });
    this.onMessage('talk', (client, data) => {
      const result = this.onTalk(client, data);
      if (client && client.send) client.send('talk', result);
    });
    this.onMessage('propose', (client, data) => {
      const result = this.onPropose(client, data);
      if (client && client.send) client.send('propose', result);
    });
    this.onMessage('advance', (client, data) => this.onAdvanceDay(client, data));
    this.onMessage('newGamePlus', (client, data) => this.onNewGamePlus(client));
    this.onMessage('completeTutorial', (client, data) => this.onTutorialComplete(client, data));
    // ── livestock + seasons ──
    this.onMessage('buyAnimal', (client, data) => {
      const r = this.onBuyAnimal(client, data);
      if (client && client.send) client.send('buyAnimal', r);
    });
    this.onMessage('feedAnimal', (client, data) => {
      const r = this.onFeedAnimal(client, data);
      if (client && client.send) client.send('feedAnimal', r);
    });
    this.onMessage('fish', (client, data) => {
      const r = this.onFish(client, data);
      if (client && client.send) client.send('fish', r);
    });
    this.onMessage('mine', (client, data) => {
      const r = this.onMine(client, data);
      if (client && client.send) client.send('mine', r);
    });
    this.onMessage('cook', (client, data) => {
      const r = this.onCook(client, data);
      if (client && client.send) client.send('cook', r);
    });
    this.onMessage('deposit', (client, data) => {
      const r = this.onDeposit(client, data);
      if (client && client.send) client.send('deposit', r);
    });
    this.onMessage('withdraw', (client, data) => {
      const r = this.onWithdraw(client, data);
      if (client && client.send) client.send('withdraw', r);
    });
    this.onMessage('upgradeTool', (client, data) => {
      const r = this.onUpgradeTool(client, data);
      if (client && client.send) client.send('upgradeTool', r);
    });
    this.onMessage('claimFestival', (client, data) => {
      const r = this.onClaimFestival(client, data);
      if (client && client.send) client.send('claimFestival', r);
    });
  }

  // ── Persistence: serialize a player + farm into a plain JSON-safe object ──
  _playerToData(player, farm) {
    const map = (m) => { const o = {}; m.forEach?.((v, k) => { o[k] = v; }); return o; };
    return {
      name: player.name,
      x: player.x, y: player.y,
      credits: player.credits, energy: player.energy,
      tutorialComplete: player.tutorialComplete,
      marriedTo: player.marriedTo,
      tool: player.tool,
      friendships: map(player.friendships),
      lastTalkDay: map(player.lastTalkDay),
      heartEvents: map(player.heartEvents),
      giftsGiven: map(player.giftsGiven),
      inventory: map(player.inventory),
      storage: map(player.storage),
      animals: map(player.animals),
      animalsFedDay: map(player.animalsFedDay),
      mineHp: player.mineHp, mineMax: player.mineMax,
      staminaMax: player.staminaMax || 100,
      todayWork: player.todayWork || 0,
      lifetime: map(player.lifetime),
      ngPlus: player.ngPlus || 0,
      milestonesSeen: map(player.milestonesSeen),
      quests: {
        current: player.quests.current,
        completed: Array.from(player.quests.completed),
        progress: map(player.quests.progress),
        arcDone: player.quests.arcDone,
      },
      // world time — a save must restore the episode clock, or crops/quests
      // computed against `day` diverge after a reload
      world: {
        day: this.state?.day, time: this.state?.time, season: this.state?.season,
        isDay: this.state?.isDay, festival: this.state?.festival,
        festivalClaimed: this.state?.festivalClaimed,
      },
      farm: farm ? {
        tier: farm.tier, houseLevel: farm.houseLevel,
        tiles: Array.from(farm.tiles).map((t) => ({
          x: t.x, y: t.y, type: t.type, crop: t.crop, growthDay: t.growthDay, watered: t.watered,
        })),
      } : null,
      // stochastic stream position (see setRng) — checkpoints replay from the
      // exact point in the random sequence, not from the seed
      rngState: this.rngState(),
    };
  }

  // Current stochastic-seam stream position, or null on the live Math.random
  // path (nothing serializable there — live play is not replayed).
  rngState() {
    return this.rng && this.rng.getState ? this.rng.getState() : null;
  }

  // Jump the stochastic seam to a captured position. Restores determinism
  // across save/load: the next _rand() after a restore equals the next
  // _rand() at capture time.
  setRngState(s) {
    if (s == null) return false;
    this.rng = mulberry32(s >>> 0);
    return true;
  }

  _applySave(player, farm, data) {
    player.name = data.name || player.name;
    player.x = data.x || player.x; player.y = data.y || player.y;
    player.credits = data.credits ?? player.credits;
    player.energy = data.energy ?? player.energy;
    player.tutorialComplete = !!data.tutorialComplete;
    player.marriedTo = data.marriedTo || '';
    player.tool = data.tool || 'base';
    // The save is the source of truth for these collections: clear before
    // fill so a restore can't leave residue from the object being restored
    // into (fresh maps on live join; reset-granted starters on env load).
    const fill = (m, o) => { m.clear(); for (const [k, v] of Object.entries(o || {})) m.set(k, v); };
    fill(player.friendships, data.friendships);
    fill(player.lastTalkDay, data.lastTalkDay);
    fill(player.heartEvents, data.heartEvents);
    fill(player.giftsGiven, data.giftsGiven);
    fill(player.inventory, data.inventory);
    fill(player.storage, data.storage);
    fill(player.animals, data.animals);
    fill(player.animalsFedDay, data.animalsFedDay);
    player.mineHp = data.mineHp || 0; player.mineMax = data.mineMax || 0;
    player.staminaMax = data.staminaMax || 100;
    player.todayWork = data.todayWork || 0;
    fill(player.lifetime, data.lifetime);
    player.ngPlus = data.ngPlus || 0;
    fill(player.milestonesSeen, data.milestonesSeen);
    const q = player.quests;
    if (data.quests) {
      q.current = data.quests.current || '';
      q.completed.clear();
      for (const id of data.quests.completed || []) q.completed.push(id);
      for (const [k, v] of Object.entries(data.quests.progress || {})) q.progress.set(k, v);
      q.arcDone = !!data.quests.arcDone;
    }
    if (data.farm && farm && data.farm.tiles && data.farm.tiles.length === farm.tiles.length) {
      farm.tier = data.farm.tier || 1;
      farm.houseLevel = data.farm.houseLevel || 1;
      data.farm.tiles.forEach((td, i) => {
        const t = farm.tiles[i];
        t.type = td.type || 'empty'; t.crop = td.crop || '';
        t.growthDay = td.growthDay || 0; t.watered = !!td.watered;
      });
    }
  }

  // Save one player now. `announce` broadcasts a 'saved' blip to their client.
  // No-op in headless test harnesses (they have no persistence flag), so
  // test runs never write save files. Saves are keyed by the STABLE player id
  // (player.playerId, client-provided), not the per-session Colyseus id —
  // that's what makes "come back tomorrow" actually find your farm.
  saveNow(sessionId, announce) {
    if (!this._persistence) return false;
    const player = this.state.players.get(sessionId);
    if (!player) return false;
    const key = player.playerId || sessionId;
    const farm = this.state.farms.get(sessionId);
    const ok = savePlayer(key, this._playerToData(player, farm));
    if (ok && announce) {
      const c = this.clients && this.clients.size
        ? Array.from(this.clients).find((cl) => cl.sessionId === sessionId)
        : null;
      if (c) c.send('saved');
    }
    return ok;
  }

  onJoin(client, options) {
    const stableId = String(options.playerId || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 40);
    const saveKey = stableId || client.sessionId;   // no stable id yet → session key
    const freshPlayer = new Player(client.sessionId, options.name || 'Farmer');
    freshPlayer.playerId = stableId;   // stable identity across sessions (saves)
    const farm = new FarmPlot(client.sessionId);
    const save = this._persistence ? loadPlayer(saveKey) : null;
    if (save && save.name) {
      // returning farmer — restore their whole life
      this._applySave(freshPlayer, farm, save);
      // resume the stochastic stream where the save left off (null on the
      // live Math.random path → no-op; seeded harnesses replay exactly)
      if (save.rngState != null) this.setRngState(save.rngState);
      if (save.world) {
        for (const k of ['day', 'time', 'season', 'isDay', 'festival', 'festivalClaimed']) {
          if (save.world[k] !== undefined) this.state[k] = save.world[k];
        }
      }
      console.log(`${freshPlayer.name} returned (save v${save.savedAt ? 'loaded' : '?'})`);
    } else {
      // new farmer — starter gift items so the friendship/gifting loop is
      // testable from day one (inventory is a MapSchema — populate via .set())
      freshPlayer.name = options.name || 'Farmer';
      freshPlayer.inventory.set('seeds', 5);
      freshPlayer.inventory.set('tech-part', 2);
      freshPlayer.inventory.set('starlight-crystal', 1);
      freshPlayer.inventory.set('exotic-seed', 1);
      freshPlayer.inventory.set('space-feather', 1);
      freshPlayer.inventory.set('data-crystal', 1);
      freshPlayer.inventory.set('rare-mineral', 1);
      freshPlayer.inventory.set('cooked-food', 1);
      freshPlayer.inventory.set('weeds', 1);
      freshPlayer.inventory.set('flowers', 1);
      // 'The Stardust Story' begins for every new farmer — the intro crawl
      // hands them the farm, and Quasar's first quest is waiting in town.
      freshPlayer.quests.current = QUEST_ORDER[0];
      console.log(`${freshPlayer.name} joined (new farm)`);
    }
    // MapSchema (schema 4) requires .set() / .get() / .delete() — not bracket access
    this.state.players.set(client.sessionId, freshPlayer);
    this.state.farms.set(client.sessionId, farm);
    // P3 — hydrate the seen-milestones set from the save so a returning farmer
    // never gets the same toast twice (and new milestones keep firing).
    if (!this._milestonesSeen) this._milestonesSeen = new Map();
    const seen = new Set();
    freshPlayer.milestonesSeen.forEach((_v, k) => seen.add(k));
    this._milestonesSeen.set(client.sessionId, seen);
  }

  onLeave(client) {
    const p = this.state.players.get(client.sessionId);
    // persist before the state vanishes (keyed by stable playerId)
    this.saveNow(client.sessionId, false);
    if (p) console.log(`${p.name} left (saved)`);
    // P3 — drop the per-session reflection scratch state (no leak across sessions)
    if (this._milestonesSeen) this._milestonesSeen.delete(client.sessionId);
    if (this._dailyLedger) this._dailyLedger.delete(client.sessionId);
    this.state.players.delete(client.sessionId);
    this.state.farms.delete(client.sessionId);
  }

  onMove(client, data) {
    const p = this.state.players.get(client.sessionId);
    if (p) { p.x = data.x; p.y = data.y; }
  }

  // Look up a connected client by sessionId (headless-safe: returns undefined
  // in test harnesses where this.clients isn't populated).
  _clientBySession(sessionId) {
    if (!this.clients) return undefined;
    return this.clients.find((cl) => cl && cl.sessionId === sessionId);
  }

  // Seed (or clear) the stochastic seam. Harnesses built via
  // Object.create(FarmRoom.prototype) never run onCreate, so _rand falls back
  // to Math.random when no rng was injected — live server unchanged.
  setRng(seed) { this.rng = (seed == null) ? Math.random : mulberry32(seed); }
  _rand() { return (this.rng || Math.random)(); }

  // ── P3: day ledger + milestones ──
  // A per-session tally of what happened TODAY (earned/spent/harvested/...).
  // Flushes into a daySummary card payload on advance; lifetime totals also
  // accumulate here and survive New Game+.
  _ledgerAdd(sessionId, deltas) {
    if (!this._dailyLedger) this._dailyLedger = new Map();
    const led = this._dailyLedger.get(sessionId) || { earned: 0, spent: 0, harvested: 0, sold: 0, fished: 0, mined: 0, gifts: 0 };
    for (const k in deltas) led[k] = (led[k] || 0) + deltas[k];
    this._dailyLedger.set(sessionId, led);
    const p = this.state.players.get(sessionId);
    if (p) for (const k in deltas) p.lifetime.set(k, (p.lifetime.get(k) || 0) + deltas[k]);
  }

  // Milestone table: id → test(lifetime, player). Each fires exactly once
  // per save (milestonesSeen map persists), toasted as they unlock.
  static MILESTONES = [
    ['first-harvest', (lt, p) => (lt.harvested || 0) >= 1, 'FIRST HARVEST — the colony eats because of you.'],
    ['first-sale', (lt, p) => (lt.sold || 0) >= 1, 'FIRST SALE — commerce! The Exchange respects the hustle.'],
    ['first-catch', (lt, p) => (lt.fished || 0) >= 1, 'FIRST CATCH — the fish did not stand a chance.'],
    ['first-vein', (lt, p) => (lt.mined || 0) >= 1, 'FIRST ORE — the rock gives up its secrets.'],
    ['grand-sampler', (lt, p) => ((lt.harvested || 0) + (lt.fished || 0) + (lt.mined || 0)) >= 50, 'GRAND SAMPLER — 50 gifts from this rock.'],
    ['thousand-credits', (lt, p) => (lt.earned || 0) >= 1000, '1,000 CR LIFETIME — C.O.R.A. has updated your net worth in 48 pages.'],
    ['ten-thousand-credits', (lt, p) => (lt.earned || 0) >= 10000, '10,000 CR LIFETIME — the Exchange orb pulses for YOU now.'],
    ['generous-soul', (lt, p) => (lt.gifts || 0) >= 10, 'GENEROUS SOUL — 10 gifts given. Rhea is almost impressed.'],
    ['devoted', (lt, p) => !!p.marriedTo, 'HEART TAKEN — someone chose your particular brand of chaos.'],
    ['story-complete', (lt, p) => !!p.quests.arcDone, 'THE STARDUST STORY — complete. The colony writes your name in the log.'],
    ['new-game-plus', (lt, p) => (p.ngPlus || 0) >= 1, 'NEW GAME+ — same rocks, different you.'],
  ];

  _checkMilestones(client) {
    const p = this.state.players.get(client.sessionId);
    if (!p) return;
    const lt = {};
    p.lifetime.forEach((v, k) => { lt[k] = v; });
    if (!this._milestonesSeen) this._milestonesSeen = new Map();  // sessionId → Set (hydrated from save)
    let seen = this._milestonesSeen.get(client.sessionId);
    if (!seen) { seen = new Set(); this._milestonesSeen.set(client.sessionId, seen); }
    for (const [id, test, label] of FarmRoom.MILESTONES) {
      if (seen.has(id)) continue;
      let hit = false;
      try { hit = test(lt, p); } catch { hit = false; }
      if (hit) {
        seen.add(id);
        p.milestonesSeen.set(id, 1);
        if (client && client.send) client.send('milestone', { id, label });
      }
    }
  }

  // ── New Game+ ──
  // Fresh start economics/farm/quests; the life you built (friends, marriage,
  // lifetime records, milestones) carries over. ngPlus increments.
  onNewGamePlus(client) {
    const p = this.state.players.get(client.sessionId);
    if (!p) return { ok: false, reason: 'no-player' };
    // only offerable after the story closes — keeps a mid-arc accept from
    // wiping real progress; NG+ players can chain cycles freely.
    if (!p.quests.arcDone && !(p.ngPlus >= 1)) return { ok: false, reason: 'story-not-complete' };
    p.credits = 100;
    p.energy = 100;
    p.tool = 'base';
    p.mineHp = 0; p.mineMax = 0;
    p.inventory.clear();
    p.storage.clear();
    p.animals.clear();
    p.animalsFedDay.clear();
    // starter gift, same as a brand-new farmer
    p.inventory.set('seeds', 5);
    p.inventory.set('tech-part', 2);
    p.inventory.set('starlight-crystal', 1);
    p.inventory.set('exotic-seed', 1);
    p.inventory.set('space-feather', 1);
    p.inventory.set('data-crystal', 1);
    p.inventory.set('rare-mineral', 1);
    p.inventory.set('cooked-food', 1);
    // story restarts (a new cycle of The Stardust Story)
    p.quests.current = '';
    p.quests.completed.clear();
    p.quests.progress.clear();
    p.quests.arcDone = false;
    // the farm plot resets
    const farm = this.state.farms.get(client.sessionId);
    if (farm) {
      farm.tier = 1; farm.houseLevel = 1;
      for (const t of farm.tiles) { t.type = 'empty'; t.crop = ''; t.growthDay = 0; t.watered = false; }
    }
    p.ngPlus = (p.ngPlus || 0) + 1;
    if (this._dailyLedger) this._dailyLedger.delete(client.sessionId);
    this.saveNow(client.sessionId, true);
    this._checkMilestones(client);   // 'new-game-plus' fires here
    return { ok: true, ngPlus: p.ngPlus, credits: p.credits };
  }

  // ── Energy authority (single gate) ──
  _energyCost(action, tool) {
    const base = ENERGY_COSTS[action] || 0;
    const mult = (TOOLS[tool] || TOOLS.base).energyMult || 1.0;
    return Math.max(1, Math.round(base * mult));
  }
  _spendEnergy(player, action) {
    if (!player) return { ok: false, reason: 'no-player' };
    const cost = this._energyCost(action, player.tool);
    if (player.energy < cost) return { ok: false, reason: 'low-energy', need: cost, energy: player.energy };
    player.energy = Math.max(0, player.energy - cost);
    player.todayWork = (player.todayWork || 0) + cost;   // the body keeps the tally
    return { ok: true, spent: cost, energy: player.energy };
  }

  onPlant(client, data) {
    const farm = this.state.farms.get(client.sessionId);
    const tile = farm?.tiles.find(t => t.x === data.tileX && t.y === data.tileY);
    const player = this.state.players.get(client.sessionId);
    if (!(tile && tile.type === 'tilled')) return { ok: false, reason: 'bad-tile' };
    if (!player || (player.inventory.get('seeds') || 0) <= 0) return { ok: false, reason: 'no-seeds' };
    const gate = this._spendEnergy(player, 'plant');
    if (!gate.ok) return gate;
    player.inventory.set('seeds', (player.inventory.get('seeds') || 0) - 1);
    tile.crop = data.crop;
    tile.type = 'seeded';
    tile.growthDay = 0;
    this.questEvent(client, { kind: 'plant' });
    return { ok: true, energy: player.energy };
  }

  onWater(client, data) {
    const farm = this.state.farms.get(client.sessionId);
    const tile = farm?.tiles.find(t => t.x === data.tileX && t.y === data.tileY);
    const player = this.state.players.get(client.sessionId);
    if (!(tile && (tile.type === 'seeded' || tile.type === 'growing'))) return { ok: false, reason: 'bad-tile' };
    if (tile.watered) return { ok: false, reason: 'already-watered' };
    const gate = this._spendEnergy(player, 'water');
    if (!gate.ok) return gate;
    tile.watered = true;
    return { ok: true, energy: player.energy };
  }

  onHarvest(client, data) {
    const farm = this.state.farms.get(client.sessionId);
    const tile = farm?.tiles.find(t => t.x === data.tileX && t.y === data.tileY);
    if (!(tile && tile.type === 'mature')) return { ok: false, reason: 'not-mature' };
    const player = this.state.players.get(client.sessionId);
    const gate = this._spendEnergy(player, 'harvest');
    if (!gate.ok) return gate;
    const info = CROP_INFO[tile.crop] || { cr: 50, regrow: false };
    player.credits += info.cr;
    this._ledgerAdd(client.sessionId, { earned: info.cr, harvested: 1 });
    this._checkMilestones(client);
    if (info.regrow) {
      // continuous crop — stays planted and regrows (needs water again)
      tile.type = 'growing';
      tile.growthDay = 0;
      tile.watered = false;
    } else {
      // one-time crop — harvest it once, replant for more
      tile.type = 'empty';
      tile.crop = '';
      tile.growthDay = 0;
      tile.watered = false;
    }
    this.questEvent(client, { kind: 'harvest' });
    return { ok: true, earned: info.cr, energy: player.energy, credits: player.credits };
  }

  onTill(client, data) {
    const farm = this.state.farms.get(client.sessionId);
    const tile = farm?.tiles.find(t => t.x === data.tileX && t.y === data.tileY);
    if (!(tile && tile.type === 'empty')) return { ok: false, reason: 'bad-tile' };
    const player = this.state.players.get(client.sessionId);
    const gate = this._spendEnergy(player, 'till');
    if (!gate.ok) return gate;
    tile.type = 'tilled';
    return { ok: true, energy: player.energy };
  }

  onSell(client, data) {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;
    const prices = {
      'space-wheat': 20, 'star-berry': 35, 'moon-melon': 50,
      'plasma-tomato': 40, 'nebula-cream': 60, 'stardust-crystal': 100,
      'nebulite-ore': 75, 'egg': 25, 'milk': 30, 'wool': 45,
      'moonfish': 25, 'stardust-salmon': 45, 'comet-trout': 65, 'nebula-marlin': 120,
      'asteroid-dust': 40, 'nickel-iron': 75, 'silicon-carbide': 110, 'void-diamond': 250,
      'cooked-food': 40,
    };
    // named kitchen dishes (M4) — dishes sell for 2-4x their raw ingredients
    for (const k in DISH_SELL) if (!(k in prices)) prices[k] = DISH_SELL[k];
    const price = prices[data.item] || 10;
    // Economy integrity: you can only sell what you actually hold.
    const qty = Math.max(1, Math.floor(data.quantity || 1));
    const have = player.inventory.get(data.item) || 0;
    if (have < qty) return { ok: false, reason: 'need-item', have, need: qty };
    player.inventory.set(data.item, have - qty);
    player.credits += price * qty;
    this._ledgerAdd(client.sessionId, { earned: price * qty, sold: qty });
    this._checkMilestones(client);
    this.questEvent(client, { kind: 'sell', amount: price * qty });
    return { ok: true, item: data.item, qty, credits: price * qty, balance: player.credits };
  }

  onOrder(client, data) {
    const order = new GrandExchangeOrder(data.item, data.quantity, data.price, data.type, client.sessionId);
    this.state.orders.push(order);
    this.matchOrders();
  }

  matchOrders() {
    const orders = this.state.orders;
    const buys = orders.filter(o => o.type === 'buy');
    const sells = orders.filter(o => o.type === 'sell');
    for (const sell of sells) {
      const match = buys.find(b => b.item === sell.item && b.price >= sell.price);
      if (!match) continue;
      const qty = Math.min(sell.quantity, match.quantity);
      const buyer = this.state.players.get(match.playerId);
      const seller = this.state.players.get(sell.playerId);
      if (buyer && seller) {
        buyer.credits -= match.price * qty;
        seller.credits += match.price * qty;
        this._ledgerAdd(match.playerId, { spent: match.price * qty });
        this._ledgerAdd(sell.playerId, { earned: match.price * qty, sold: qty });
        const sellerClient = this._clientBySession(sell.playerId);
        if (sellerClient) this._checkMilestones(sellerClient);
      }
      sell.quantity -= qty;
      match.quantity -= qty;
      if (sell.quantity <= 0) orders.splice(orders.indexOf(sell), 1);
      if (match.quantity <= 0) orders.splice(orders.indexOf(match), 1);
    }
  }

  // ── Friendship engine (Harvest Moon-style) ──
  // Gift affinity tables come from the StoryBank-derived NPC_GIFTS above (the
  // same loved/liked/hated lists the dialogue and agent schemas read).
  //   loved item  → +15   (their favorite)
  //   liked item  → +5
  //   hated item  → -8    (they actively dislike it)
  //   anything else → +2  (neutral, appreciated)

  giftTier(npcId, item) {
    const g = NPC_GIFTS[npcId];
    if (!g) return { tier: 'neutral', delta: 2 };
    if (g.loved === item) return { tier: 'loved', delta: 15 };
    if (g.liked && g.liked.includes(item)) return { tier: 'liked', delta: 5 };
    if (g.hated && g.hated.includes(item)) return { tier: 'hated', delta: -8 };
    return { tier: 'neutral', delta: 2 };
  }

  heartEvent(player, npcId) {
    const cv = player.friendships.get(npcId) || 0;
    const fired = player.heartEvents.get(npcId) || 0;
    const THRESHOLDS = [20, 40, 60, 80, 100];
    for (const th of THRESHOLDS) {
      if (cv >= th && fired < th) { player.heartEvents.set(npcId, th); return th; }
    }
    return 0;
  }

  onGift(client, data) {
    const player = this.state.players.get(client.sessionId);
    if (!player) return { ok: false, reason: 'no-player' };
    const npcId = data.npc, item = data.item;
    if (!npcId || !item) return { ok: false, reason: 'bad-params' };
    const inv = player.inventory;
    if (!inv.get(item) || inv.get(item) <= 0) return { ok: false, reason: 'no-item', npc: npcId };
    inv.set(item, inv.get(item) - 1);  // consume the item
    let { tier, delta } = this.giftTier(npcId, item);
    // named dishes (M4) grant a distinct per-NPC friendship bonus on top of
    // the base gift tier — e.g. Rhea loves the Earth Feast Plate (+30).
    let dishBonus = 0;
    if (DISH_GIFT_BONUS[item] && DISH_GIFT_BONUS[item][npcId]) {
      dishBonus = DISH_GIFT_BONUS[item][npcId];
      delta += dishBonus;
      if (dishBonus >= 15) tier = 'loved';   // a strongly-loved dish reads as "loved"
    }
    const cur = player.friendships.get(npcId) || 0;
    player.friendships.set(npcId, Math.max(0, Math.min(100, cur + delta)));
    player.giftsGiven.set(npcId, (player.giftsGiven.get(npcId) || 0) + 1);
    this._ledgerAdd(client.sessionId, { gifts: 1 });
    this._checkMilestones(client);
    const event = this.heartEvent(player, npcId);
    this.questEvent(client, { kind: 'gift', item });
    return { ok: true, npc: npcId, tier, delta, dishBonus, value: player.friendships.get(npcId),
             event, item, remaining: inv.get(item) || 0 };
  }

  onTalk(client, data) {
    const player = this.state.players.get(client.sessionId);
    if (!player) return { ok: false, reason: 'no-player' };
    const npcId = data.npc;
    if (!npcId) return { ok: false, reason: 'bad-params' };
    // daily +2 cap: a given NPC can only be talked to once per day
    const last = player.lastTalkDay.get(npcId) || -1;
    if (last === this.state.day) return { ok: false, reason: 'already-talked', npc: npcId };
    player.lastTalkDay.set(npcId, this.state.day);
    const cur = player.friendships.get(npcId) || 0;
    player.friendships.set(npcId, Math.min(100, cur + 2));
    const event = this.heartEvent(player, npcId);
    this.questEvent(client, { kind: 'talk', npc: npcId });
    this.checkQuestComplete(client);      // 'friendship' objective is level-based
    return { ok: true, npc: npcId, value: player.friendships.get(npcId), event };
  }

  // Marriage — requires friendship >= 80 and a marriage-candidate NPC.
  onPropose(client, data) {
    const player = this.state.players.get(client.sessionId);
    if (!player) return { ok: false, reason: 'no-player' };
    const npcId = data.npc;
    if (!npcId) return { ok: false, reason: 'bad-params' };
    const MARRIAGE_CANDIDATES = ['nova', 'luna', 'zephyr', 'vega', 'rhea', 'astra', 'orion'];
    if (!MARRIAGE_CANDIDATES.includes(npcId)) return { ok: false, reason: 'not-candidate', npc: npcId };
    if (player.marriedTo) return { ok: false, reason: 'already-married' };
    const cv = player.friendships.get(npcId) || 0;
    if (cv < 80) return { ok: false, reason: 'not-enough-friendship', value: cv };
    player.marriedTo = npcId;
    player.heartEvents.set(npcId, 100);   // marriage counts as the 100 threshold event
    this.checkQuestComplete(client);      // 'friendship' objective is level-based
    return { ok: true, npc: npcId, marriedTo: npcId };
  }

  onAdvanceDay(client) {
    this.state.day += 1;
    const cal = this._cal();   // calendar service — the ONLY source for this math
    // Seasons come from the calendar service: DAYS_PER_SEASON (default 30) per
    // season, a full year = 4 seasons (default 120 days).
    this.state.season = cal.seasonIndex(this.state.day);
    // Festivals recur yearly on fixed dates (calendar service): The Naming
    // (spring 25), Solar Flare Fair (summer 24), Galactic Harvest Festival
    // (fall 29), and Hearthnight / Sol Earth Festival (winter 25). Claim resets
    // every festival so each can be attended once.
    const festival = cal.festivalForDay(this.state.day);
    this.state.festival = !!festival;
    this.state.festivalClaimed = false;
    // M3 — festival day phases: waking up ON the festival → setup (morning),
    // waking up the day AFTER a festival → afterglow (one morning), then none.
    if (festival) {
      this.state.feastPeak = false;   // new festival day → the peak can fire again
      this._applyFestivalPhase('setup');
    }
    else if (this.state.festivalPhase === 'setup' || this.state.festivalPhase === 'feast') this._applyFestivalPhase('afterglow');
    else if (this.state.festivalPhase === 'afterglow') this._applyFestivalPhase('none');
    this.state.farms.forEach((farm) => {
      if (!farm || !farm.tiles) return;
      // Growth pacing and maturity both come from the calendar service — one
      // formula the server, RL mirrors, and client all agree on.
      const growthMult = cal.growthMultiplier(this.state.season);
      const maturityDays = cal.maturityDays();
      for (const tile of farm.tiles) {
        const info = CROP_INFO[tile.crop];
        // out-of-season crops stall — only some plants grow in certain seasons
        const inSeason = info ? info.seasons.includes(this.state.season) : true;
        if ((tile.type === 'seeded' || tile.type === 'growing') && tile.watered && inSeason) {
          tile.growthDay += growthMult;
          if (tile.type === 'seeded') tile.type = 'growing';
        }
        if (tile.growthDay >= maturityDays && tile.crop) {
          tile.type = 'mature';
        }
        tile.watered = false;
      }
    });
    this.state.players.forEach((p) => {
      if (!p) return;
      // Stamina, not a tax. Resting returns STAmina_REST_RATE toward your
      // ceiling — and a day of real work conditions the body, so the ceiling
      // (staminaMax) creeps upward like a skill learned under load.
      if ((p.todayWork || 0) > 0) {
        p.staminaMax = Math.min(STAMINA_MAX, (p.staminaMax || 100) + STAMINA_TRAIN_RATE);
      }
      p.todayWork = 0;
      p.energy = Math.min(p.staminaMax || 100, p.energy + STAMINA_REST_RATE);
      // Livestock: fed animals produce goods once per day
      if (p.animals) {
        p.animals.forEach((count, species) => {
          if (count <= 0) return;
          const prod = (ANIMALS[species] || {}).produce;
          const fed = p.animalsFedDay.get(species) === this.state.day - 1;
          if (prod && fed) {
            const inv = p.inventory;
            const cur = inv.get(prod.item) || 0;
            inv.set(prod.item, cur + prod.qty * count);
          }
        });
      }
    });
    // a new day is a natural save point — farms, crops, and credit state flush here
    this.state.players.forEach((p) => { if (p) this.saveNow(p.id, false); });
    // P3 — flush the day's tally into a reflection card for the sleeper, then
    // reset it. Carries the festival/season flags so the card can say
    // "the festival is on" / "afterglow" instead of a bare number.
    let summary = null;
    if (this._dailyLedger) {
      summary = this._dailyLedger.get(client.sessionId) || null;
      this._dailyLedger.delete(client.sessionId);
    }
    if (client && client.send) {
      client.send('daySummary', {
        day: this.state.day, season: this.state.season,
        festival: this.state.festival, festivalPhase: this.state.festivalPhase,
        ngPlus: (() => { const p = this.state.players.get(client.sessionId); return p ? p.ngPlus : 0; })(),
        ledger: summary || { earned: 0, spent: 0, harvested: 0, sold: 0, fished: 0, mined: 0, gifts: 0 },
      });
    }
  }

  // ── M3 — Earth Day spectacle: festival phases ──
  // none → setup (waking on festival day) → feast (midday, timer) →
  // afterglow (next morning) → none (or end of afterglow, timer).
  _applyFestivalPhase(phase) {
    if (this.state.festivalPhase === phase) return;
    this.state.festivalPhase = phase;
    this._broadcast('festivalPhase', { phase, festival: this.state.festival });
  }

  // The climax beat: q3_earth_feast completes (3 Earth Feast Plates on
  // festival day) → the plaza erupts (confetti + chime) and Rhea calls it.
  _markFeastPeak() {
    if (this.state.feastPeak) return;
    this.state.feastPeak = true;
    this._broadcast('feastPeak', { phase: this.state.festivalPhase });
  }

  // Headless-safe broadcast (test harnesses have no usable this.broadcast —
  // stub instances can throw outright, so this must never propagate).
  _broadcast(type, data) {
    try {
      if (typeof this.broadcast === 'function') this.broadcast(type, data, true);
    } catch { /* headless harness */ }
  }

  // ── Livestock ──
  onBuyAnimal(client, data) {
    const player = this.state.players.get(client.sessionId);
    if (!player) return { ok: false, reason: 'no-player' };
    const species = data.species, qty = data.quantity || 1;
    const a = ANIMALS[species];
    if (!a) return { ok: false, reason: 'bad-species', species };
    const cost = a.cost * qty;
    if (player.credits < cost) return { ok: false, reason: 'not-enough-credits', need: cost, have: player.credits };
    player.credits -= cost;
    this._ledgerAdd(client.sessionId, { spent: cost });
    const cur = player.animals.get(species) || 0;
    player.animals.set(species, cur + qty);
    this.checkQuestComplete(client);   // 'animal' objective is level-based
    return { ok: true, species, qty, animals: cur + qty, credits: player.credits };
  }

  onFeedAnimal(client, data) {
    const player = this.state.players.get(client.sessionId);
    if (!player) return { ok: false, reason: 'no-player' };
    const species = data.species;
    if ((player.animals.get(species) || 0) <= 0) return { ok: false, reason: 'no-animal', species };
    const today = this.state.day;
    if (player.animalsFedDay.get(species) === today) return { ok: false, reason: 'already-fed', species };
    player.animalsFedDay.set(species, today);
    this.questEvent(client, { kind: 'feed' });
    return { ok: true, species, fed: true };
  }

  // ── Fishing (minigame): cast at the shore, catch fish for credits ──
  // Deterministic-ish catch table; costs a little energy. Daily luck capped.
  onFish(client, data) {
    const player = this.state.players.get(client.sessionId);
    if (!player) return { ok: false, reason: 'no-player' };
    const gate = this._spendEnergy(player, 'fish');
    if (!gate.ok) return gate;
    // location + season + time gating: only eligible fish bite here & now
    const spot = (data && data.spot) || 'stardust';
    const night = !!(data && data.night);
    const season = this.state.season;
    const pool = Object.entries(FISH_INFO).filter(([, f]) =>
      f.spots.includes(spot) && f.seasons.includes(season) && (!f.night || night));
    if (!pool.length) return { ok: false, reason: 'nothing-biting', spot, night, season };
    const entry = pool[Math.floor(this._rand() * pool.length)];
    const item = entry[0], worth = entry[1].worth;
    const cur = player.inventory.get(item) || 0;
    player.inventory.set(item, cur + 1);
    this._ledgerAdd(client.sessionId, { fished: 1 });
    this._checkMilestones(client);
    this.questEvent(client, { kind: 'fish' });
    return { ok: true, item, qty: 1, worth, energy: player.energy };
  }

  // ── Mining — a persistent, swing-by-swing loop (not a one-shot):
  //    the rock has a DURABLE VEIN. Every swing chips it (costs 5 EP).
  //    Harder veins take MORE swings to break and yield better ore. Once a
  //    vein breaks it resets, so you keep picking at the rock. ──
  onMine(client, data) {
    const player = this.state.players.get(client.sessionId);
    if (!player) return { ok: false, reason: 'no-player' };
    const gate = this._spendEnergy(player, 'mine');
    if (!gate.ok) return gate;
    // start a fresh vein if none is active (some veins are quick, some deep)
    if (!player.mineMax || player.mineMax <= 0 || !player.mineHp || player.mineHp <= 0) {
      player.mineMax = 3 + Math.floor(this._rand() * 5);   // hardness: 3..7 swings
      player.mineHp = player.mineMax;
    }
    player.mineHp = Math.max(0, player.mineHp - 1);
    const broken = player.mineHp <= 0;
    if (!broken) {
      return { ok: true, swing: 1, hp: player.mineHp, max: player.mineMax, broken: false, energy: player.energy };
    }
    // vein collapses → ore. Harder vein = better ore ("some ore needs more picking")
    const hardness = player.mineMax;
    const roll = this._rand();
    let item, worth;
    if (hardness >= 7)            { item = 'void-diamond';    worth = 250; }
    else if (hardness >= 5)        { item = roll < 0.5 ? 'silicon-carbide' : 'nickel-iron'; worth = roll < 0.5 ? 110 : 75; }
    else                          { item = roll < 0.5 ? 'nickel-iron' : 'asteroid-dust';   worth = roll < 0.5 ? 75 : 40; }
    const cur = player.inventory.get(item) || 0;
    player.inventory.set(item, cur + 1);
    player.mineHp = 0; player.mineMax = 0;   // vein spent; next swing starts a new one
    this._ledgerAdd(client.sessionId, { mined: 1 });
    this._checkMilestones(client);
    this.questEvent(client, { kind: 'mine', broken: true });
    return { ok: true, swing: 1, broken: true, item, worth, hp: 0, max: hardness, energy: player.energy };
  }

  // ── Cooking (at the house kitchen). ──
  // Two modes:
  //   1. NAMED recipe (data.recipe) — the M4 kitchen. Consumes that recipe's
  //      exact ingredients, yields the named dish. earth-feast-plate requires
  //      a festival day.
  //   2. GENERIC (no data.recipe) — legacy "any 2 raw crops → cooked-food",
  //      kept so the old button (and verify_mechanics) keep working.
  // Both fire a 'cook' quest event; the named one carries {dish, recipe}.
  onCook(client, data) {
    const player = this.state.players.get(client.sessionId);
    if (!player) return { ok: false, reason: 'no-player' };
    const inv = player.inventory;
    const recipe = data && data.recipe ? RECIPES[data.recipe] : null;

    // ── named recipe ──
    if (recipe) {
      if (recipe.festival && !this.state.festival) {
        return { ok: false, reason: 'festival-only', recipe: data.recipe };
      }
      for (const ing of recipe.ingredients) {
        if ((inv.get(ing) || 0) < 1) return { ok: false, reason: 'need-ingredients', missing: ing, recipe: data.recipe };
      }
      for (const ing of recipe.ingredients) inv.set(ing, (inv.get(ing) || 0) - 1);
      const have = inv.get(data.recipe) || 0;
      inv.set(data.recipe, have + 1);
      this.questEvent(client, { kind: 'cook', dish: data.recipe, recipe: data.recipe });
      return { ok: true, dish: data.recipe, name: recipe.name, have: have + 1, festival: !!recipe.festival };
    }

    // ── generic fallback: any 2 raw crops/fish → 1 cooked-food ──
    const CROPS = ['space-wheat', 'star-berry', 'moon-melon', 'plasma-tomato',
                  'moonfish', 'stardust-salmon', 'comet-trout', 'nebula-marlin'];
    let total = 0;
    for (const c of CROPS) total += inv.get(c) || 0;
    if (total < 2) return { ok: false, reason: 'need-ingredients', have: total };
    let consumed = 0;
    for (const c of CROPS) {
      while (consumed < 2 && (inv.get(c) || 0) > 0) {
        inv.set(c, inv.get(c) - 1); consumed++;
      }
      if (consumed >= 2) break;
    }
    const cooked = inv.get('cooked-food') || 0;
    inv.set('cooked-food', cooked + 1);
    this.questEvent(client, { kind: 'cook', dish: 'cooked-food', recipe: null });
    return { ok: true, cooked: cooked + 1, dish: 'cooked-food' };
  }

  // ── Storage chest (at home): keep harvests safe & organized ──
  onDeposit(client, data) {
    const player = this.state.players.get(client.sessionId);
    if (!player) return { ok: false, reason: 'no-player' };
    const item = data.item;
    const qty = Math.max(1, Math.floor(data.qty || 1));
    const have = player.inventory.get(item) || 0;
    if (have < qty) return { ok: false, reason: 'not-enough', have, need: qty };
    player.inventory.set(item, have - qty);
    const cur = player.storage.get(item) || 0;
    player.storage.set(item, cur + qty);
    return { ok: true, item, qty, stored: cur + qty };
  }

  onWithdraw(client, data) {
    const player = this.state.players.get(client.sessionId);
    if (!player) return { ok: false, reason: 'no-player' };
    const item = data.item;
    const qty = Math.max(1, Math.floor(data.qty || 1));
    const stored = player.storage.get(item) || 0;
    if (stored < qty) return { ok: false, reason: 'not-enough', have: stored, need: qty };
    player.storage.set(item, stored - qty);
    const cur = player.inventory.get(item) || 0;
    player.inventory.set(item, cur + qty);
    return { ok: true, item, qty, inventory: cur + qty };
  }

  // ── Tool upgrade: pay credits to improve your hoe tier ──
  onUpgradeTool(client, data) {
    const player = this.state.players.get(client.sessionId);
    if (!player) return { ok: false, reason: 'no-player' };
    const current = player.tool || 'base';
    const cfg = TOOLS[current];
    if (!cfg || !cfg.next) return { ok: false, reason: 'max-tier', tool: current };
    if (player.credits < cfg.cost) return { ok: false, reason: 'not-enough-credits', need: cfg.cost };
    player.credits -= cfg.cost;
    this._ledgerAdd(client.sessionId, { spent: cfg.cost });
    player.tool = cfg.next;
    this.checkQuestComplete(client);   // 'tool' objective is level-based
    return { ok: true, tool: cfg.next, name: TOOLS[cfg.next].name, credits: player.credits };
  }

  // ── Seasonal festival claim: attend once per festival for rewards ──
  onClaimFestival(client, data) {
    const player = this.state.players.get(client.sessionId);
    if (!player) return { ok: false, reason: 'no-player' };
    if (!this.state.festival) return { ok: false, reason: 'no-festival-today' };
    if (this.state.festivalClaimed) return { ok: false, reason: 'already-claimed' };
    this.state.festivalClaimed = true;
    // reward: credits + friendship with a random colony NPC
    const names = Object.keys(NPC_GIFTS);
    const npcId = names[Math.floor(this._rand() * names.length)];
    player.credits += 150;
    this._ledgerAdd(client.sessionId, { earned: 150 });
    const cur = player.friendships.get(npcId) || 0;
    player.friendships.set(npcId, Math.min(100, cur + 5));
    this.questEvent(client, { kind: 'festival' });
    return { ok: true, credits: player.credits, npc: npcId, festival: true };
  }

  // ── 'The Stardust Story' — quest engine ───────────────────────────────────
  // Objective progress is server-authoritative. Incremental objectives (plant,
  // harvest, sell, fish, mine, cook, gift, feed, festival, talk) bump a counter
  // on each matching event; level objectives (tool, friendship) are recomputed
  // from live state on every check. A quest auto-completes (reward granted,
  // chain advanced) the moment all its objectives are met — no claim step, so
  // the story never stalls waiting on a menu.
  questProgressKey(qid, i) { return qid + '::' + i; }

  // Does this event advance this objective? (incremental types only)
  objectiveMatches(obj, ev) {
    switch (ev.kind) {
      case 'plant':    return obj.type === 'plant';
      case 'harvest':  return obj.type === 'harvest';
      case 'sell':     return obj.type === 'sell';
      case 'fish':     return obj.type === 'fish';
      case 'mine':     return obj.type === 'mine' && ev.broken;
      case 'cook':     return obj.type === 'cook' && (!obj.festival || this.state.festival) && (!obj.dish || ev.dish === obj.dish);
      case 'gift':     return obj.type === 'gift' && (!obj.item || ev.item === obj.item);
      case 'feed':     return obj.type === 'feed';
      case 'festival': return obj.type === 'festival';
      case 'talk':     return obj.type === 'talk' && (!obj.npc || ev.npc === obj.npc);
      default:         return false;
    }
  }

  // Is this objective satisfied right now? (level types recompute live)
  objectiveMet(qid, player, obj, i) {
    if (obj.type === 'tool') {
      const rank = { base: 0, iron: 1, gold: 2 };
      return (rank[player.tool] || 0) >= (rank[obj.tool] || 0);
    }
    if (obj.type === 'friendship') {
      let c = 0;
      player.friendships.forEach((v) => { if (v >= obj.n) c++; });
      return c >= (obj.count || 1);
    }
    if (obj.type === 'animal') {
      let c = 0;
      player.animals.forEach((v) => { c += v; });
      return c >= obj.n;
    }
    const key = this.questProgressKey(qid, i);
    return (player.quests.progress.get(key) || 0) >= obj.n;
  }

  // Feed a gameplay event into the current quest; completes the chain if met.
  questEvent(client, ev) {
    const player = this.state.players.get(client.sessionId);
    if (!player || !player.quests) return null;
    const q = player.quests;
    if (q.arcDone || !q.current) return null;
    const quest = QUESTS[q.current];
    if (!quest) return null;
    quest.objectives.forEach((obj, i) => {
      if (this.objectiveMet(q.current, player, obj, i)) return; // already done
      if (!this.objectiveMatches(obj, ev)) return;
      const key = this.questProgressKey(q.current, i);
      const cur = q.progress.get(key) || 0;
      const add = (obj.type === 'sell') ? (ev.amount || 0) : 1;
      q.progress.set(key, cur + add);
    });
    return this.checkQuestComplete(client);
  }

  // Advance the chain: complete every fully-met current quest, grant rewards,
  // return the last quest id completed this call (null if none).
  checkQuestComplete(client) {
    const player = this.state.players.get(client.sessionId);
    if (!player || !player.quests) return null;
    const q = player.quests;
    let last = null;
    const hadFeast = q.completed.indexOf('q3_earth_feast') !== -1;
    while (true) {
      if (q.arcDone || !q.current) break;
      const quest = QUESTS[q.current];
      if (!quest) { q.current = ''; break; }
      const all = quest.objectives.every((obj, i) => this.objectiveMet(q.current, player, obj, i));
      if (!all) break;
      q.completed.push(q.current);
      const rew = quest.reward || {};
      if (rew.credits) player.credits += rew.credits;
      if (rew.items) for (const [it, qt] of Object.entries(rew.items)) {
        const c = player.inventory.get(it) || 0;
        player.inventory.set(it, c + qt);
      }
      last = q.current;
      q.current = quest.next || '';
      if (!quest.next) q.arcDone = true;
    }
    if (last) this.saveNow(player.id, true);   // quest complete → persist (+SAVED blip)
    // M3 — climax beat: the Earth Feast just got served → the plaza erupts.
    if (last === 'q3_earth_feast' && !hadFeast) this._markFeastPeak();
    return last;
  }

  onTutorialComplete(client) {
    const p = this.state.players.get(client.sessionId);
    if (p) p.tutorialComplete = true;
  }
}

module.exports = { FarmRoom, FarmState, QuestState, Player, Tile, FarmPlot, GrandExchangeOrder, NPC_GIFTS, HEART_THRESHOLDS, ANIMALS, TOOLS, RECIPES, DISH_SELL, DISH_GIFT_BONUS, QUESTS, QUEST_ORDER, ENERGY_COSTS };

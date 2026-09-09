// rl/env_core.cjs — Space Farmer RL environment (Gymnasium-shaped core).
//
// Wraps the authoritative FarmRoom logic as reset(seed)/step(action) →
// {obs, reward, terminated, truncated, info}. No network, no render — the
// same handler surface the verify_*.mjs harnesses drive. The web client is
// a viewer; this file is the product.
//
// Actions: {type, ...args} mapping 1:1 to room handlers (no new game logic).
// Obs: lossless live state plus derived fixed-shape vectors and an 8x8 farm grid.
'use strict';
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const {
  FarmRoom, GAME_ACTIONS, dispatchGameAction, STARTER_INVENTORY,
  SHOP_PRICES, SELL_PRICES, MINING_INFO, CROP_INFO, FISH_INFO, ANIMALS,
  PRODUCE_PRICES, RECIPES, NPC_GIFTS, HEART_THRESHOLDS, QUESTS,
  ENERGY_COSTS, TOOL_DEFS, TOOL_TIERS, TOOL_ORDER, TOOL_FOR_ACTION,
  WATER_TANK_MAX, WATER_USE_COST, CLOCK_TICK, DUSK, STAMINA_REST_RATE,
} = require(path.join(__dirname, '..', 'server', 'rooms', 'FarmRoom.js'));
const { MapSchema, ArraySchema } = require('@colyseus/schema');
// The calendar is a SERVICE with ONE implementation (shared/calendar.js). This
// env never re-implements season math, crop maturity, growth pacing, or
// festival dates — it asks the injected calendar the same questions the server
// asks. DEFAULT_CALENDAR: 30 days per season, 120-day year, yearly festivals.
const {
  Calendar, createCalendar, DEFAULT_CALENDAR,
  DAYS_PER_SEASON, SEASONS, SEASON_NAMES, SEASON_COUNT,
} = require(path.join(__dirname, '..', 'shared', 'calendar.js'));
// The StoryBank is the ONE source of world VOICE — season/festival/pressure
// prose (shared/story/season.js) and the first-contact alien scenarios +
// contact doctrines (shared/story/aliens.js). This env never re-implements
// that prose: it reads the same objects the browser renders. Writing a
// story line once in the bank updates briefings, transcripts, and the plaza
// together — drift by construction is impossible.
const storySeason = require(path.join(__dirname, '..', 'shared', 'story', 'season.js'));
const storyAliens = require(path.join(__dirname, '..', 'shared', 'story', 'aliens.js'));

// Fixed item vocabulary for the inventory vector (stable ordering = stable obs).
const ITEMS = [
  'seeds', 'space-wheat', 'star-berry', 'moon-melon', 'plasma-tomato', 'nebula-pepper', 'glow-kelp',
  'stardust-crystal', 'nebulite-ore', 'egg', 'milk', 'wool',
  'moonfish', 'stardust-salmon', 'comet-trout', 'nebula-marlin',
  'asteroid-dust', 'nickel-iron', 'silicon-carbide', 'void-diamond',
  'cooked-food', 'tech-part', 'starlight-crystal', 'exotic-seed', 'space-feather',
  'data-crystal', 'rare-mineral', 'weeds', 'flowers',
];
const TILE_STATE = { empty: 0, tilled: 1, seeded: 2, growing: 3, mature: 4 };
const CROP_ID = { '': 0, 'space-wheat': 1, 'star-berry': 2, 'moon-melon': 3, 'plasma-tomato': 4, 'nebula-pepper': 5, 'glow-kelp': 6 };
const TOOL_ID = { base: 0, iron: 1, silver: 2, gold: 3, stardust: 4 };
const ANIMAL_TYPES = ['chicken', 'cow', 'sheep'];

const ACTION_TYPES = Object.freeze(GAME_ACTIONS.map((action) => action.type));
const TOOL_IDS = ['', 'hoe', 'watering', 'pickaxe', 'rod'];
const UPGRADE_TOOL_IDS = ['hoe', 'watering', 'pickaxe', 'rod'];
const TIER_NUM = { base: 0, iron: 1, gold: 2 };

// ── Story clock: the calendar is the story's heartbeat. Season/festival math
// lives in shared/calendar.js and the world's VOICE — the prose this env
// speaks — lives in shared/story/season.js (single source of truth). We only
// alias it here and keep the festivalFlair helper that resolves a calendar
// festival object to its prose. ──
const SEASON_TEXT = storySeason.seasonText;
const FESTIVAL_TEXT = storySeason.festivalText;
const GENERIC_FESTIVAL_TEXT = storySeason.genericFestivalText;
const festivalFlair = (fest, fallback = GENERIC_FESTIVAL_TEXT) =>
  (fest && FESTIVAL_TEXT[fest.id]) || fallback;
const PRESSURES = storySeason.pressures;

// ── StoryBank re-exports for Python/bridge consumers ──
const ALIENS = storyAliens.aliens;
const CONTACT_DOCTRINES = storyAliens.doctrines;

// ── Agent vocabulary (single source for tool schemas, MCP, and prose) ──
const NPC_IDS = ['nova', 'luna', 'zephyr', 'vega', 'quasar', 'rhea', 'astra', 'orion', 'comet', 'cora'];
const CROPS = ['space-wheat', 'star-berry', 'moon-melon', 'plasma-tomato', 'nebula-pepper', 'glow-kelp'];
const SPECIES = ANIMAL_TYPES; // chicken / cow / sheep
const SALEABLE = Object.keys(SELL_PRICES);
const FISH_SPOTS = [...new Set(Object.values(FISH_INFO).flatMap((fish) => fish.spots))];

// ── Single-source tool schema (world-voice; consumed by OpenAI tools, MCP, and eval) ──
const TOOLS = [
  {
    name: 'equip',
    description: 'Put a tool in hand before its craft: hoe (till), watering can (water), pickaxe (mine), fishing rod (fish), or empty hands (harvest crops and talk to townsfolk). Farm work is tool-gated — equip first, then use the action.',
    parameters: {
      type: 'object', additionalProperties: false,
      properties: {
        tool: { type: 'string', enum: TOOL_IDS, description: "Tool id to equip. Empty string '' is bare hands." },
      },
      required: ['tool'],
    },
  },
  {
    name: 'fill_water',
    description: 'Refill the watering can at a station (the stardust shore tap, or the ship greenhouse tap). The can is a real container — it drains as you water and must be refilled before further watering.',
    parameters: {
      type: 'object', additionalProperties: false,
      properties: {},
    },
  },
  {
    name: 'till',
    description: 'Break open the ground on an empty farm tile so it can hold a seed. The soil here remembers Grandpa\u2019s plow.',
    parameters: {
      type: 'object', additionalProperties: false,
      properties: {
        x: { type: 'integer', minimum: 0, maximum: 7, description: 'Farm tile column 0-7.' },
        y: { type: 'integer', minimum: 0, maximum: 7, description: 'Farm tile row 0-7.' },
      },
      required: ['x', 'y'],
    },
  },
  {
    name: 'plant',
    description: 'Press a seed into tilled soil. Crops that are in season grow true; out-of-season seeds stall until their season turns.',
    parameters: {
      type: 'object', additionalProperties: false,
      properties: {
        x: { type: 'integer', minimum: 0, maximum: 7 },
        y: { type: 'integer', minimum: 0, maximum: 7 },
        crop: { type: 'string', enum: CROPS, description: 'The crop to plant.' },
      },
      required: ['x', 'y', 'crop'],
    },
  },
  {
    name: 'water',
    description: 'Water a seeded or growing tile. Watered crops grow; thirsty crops wait.',
    parameters: {
      type: 'object', additionalProperties: false,
      properties: {
        x: { type: 'integer', minimum: 0, maximum: 7 },
        y: { type: 'integer', minimum: 0, maximum: 7 },
      },
      required: ['x', 'y'],
    },
  },
  {
    name: 'harvest',
    description: 'Cut a mature crop. The harvest is the profit and the proof that the work meant something.',
    parameters: {
      type: 'object', additionalProperties: false,
      properties: {
        x: { type: 'integer', minimum: 0, maximum: 7 },
        y: { type: 'integer', minimum: 0, maximum: 7 },
      },
      required: ['x', 'y'],
    },
  },
  {
    name: 'sell',
    description: 'Sell an item on the colony market for credits. Money keeps the lights on; what you sell, you do not have.',
    parameters: {
      type: 'object', additionalProperties: false,
      properties: {
        item: { type: 'string', enum: SALEABLE, description: 'The item to sell.' },
        quantity: { type: 'integer', minimum: 1, default: 1 },
      },
      required: ['item'],
    },
  },
  {
    name: 'buy_animal',
    description: 'Buy livestock for the pasture. Chickens give eggs, cows give milk, sheep give wool — but every mouth must be fed.',
    parameters: {
      type: 'object', additionalProperties: false,
      properties: {
        species: { type: 'string', enum: SPECIES },
        quantity: { type: 'integer', minimum: 1, default: 1 },
      },
      required: ['species'],
    },
  },
  {
    name: 'feed',
    description: 'Feed the livestock. Fed animals produce the next morning; unfed animals wait to be fed, and capriciously mourn.',
    parameters: {
      type: 'object', additionalProperties: false,
      properties: {
        species: { type: 'string', enum: SPECIES },
      },
      required: ['species'],
    },
  },
  {
    name: 'upgrade_tool',
    description: 'Pay credits at the smithy to upgrade ONE owned tool to its next tier (basic → iron → gold). Higher tiers spend less energy in the field.',
    parameters: {
      type: 'object', additionalProperties: false,
      properties: {
        tool: { type: 'string', enum: UPGRADE_TOOL_IDS, description: 'Which tool to upgrade (hoe, watering, pickaxe, or rod).' },
      },
      required: ['tool'],
    },
  },
  {
    name: 'fish',
    description: 'Cast a line at the shore. Fishing costs energy; the catch depends on season, spot, and whether it is night.',
    parameters: {
      type: 'object', additionalProperties: false,
      properties: {
        spot: { type: 'string', enum: FISH_SPOTS, default: 'stardust' },
        night: { type: 'boolean', default: false, description: 'Fish at night (some fish only bite after dark).' },
      },
    },
  },
  {
    name: 'mine',
    description: 'Swing your pick at the vein. Hard veins take more swings and break richer; every swing costs energy. The rock keeps its own schedule.',
    parameters: { type: 'object', additionalProperties: false, properties: {} },
  },
  {
    name: 'gift',
    description: 'Give an item to a colonist. Each person loves, likes, and loathes different things; a gift moves them one way or another.',
    parameters: {
      type: 'object', additionalProperties: false,
      properties: {
        npc: { type: 'string', enum: NPC_IDS, description: 'The colonist to gift.' },
        item: { type: 'string', enum: ITEMS, description: 'The item to give away.' },
        quantity: { type: 'integer', minimum: 1, default: 1 },
      },
      required: ['npc', 'item'],
    },
  },
  {
    name: 'talk',
    description: 'Sit with a colonist and talk. Once a day, a conversation actually lands (+2 friendship); repeated small talk is just noise.',
    parameters: {
      type: 'object', additionalProperties: false,
      properties: {
        npc: { type: 'string', enum: NPC_IDS },
      },
      required: ['npc'],
    },
  },
  {
    name: 'claim_festival',
    description: 'Attend the colony festival at peak and claim its blessing. Festivals do not wait for you.',
    parameters: { type: 'object', additionalProperties: false, properties: {} },
  },
  {
    name: 'rest',
    nativeAction: 'advance',
    description: 'Rest until the next morning — the colony sleeps, the fields take one more day, and the day ledger charges its living cost. The debt does not sleep.',
    parameters: { type: 'object', additionalProperties: false, properties: {} },
  },
  {
    name: 'inspect',
    description: 'Look closely at one corner of the colony and get its full story: the farm, the inventory, the weather, the quest thread, the people.',
    parameters: {
      type: 'object', additionalProperties: false,
      properties: {
        target: { type: 'string', enum: ['farm', 'inventory', 'colony', 'weather', 'quest', 'festival', 'bell'] },
      },
      required: ['target'],
    },
  },
  {
    name: 'get_state',
    description: 'Read the colony\u2019s quiet ledger: credits, energy, inventory, farm tiles, livestock, friendships — the numbers behind the morning.',
    parameters: { type: 'object', additionalProperties: false, properties: {} },
  },
  {
    name: 'read_colony_log',
    description: 'Read the colony log — what has happened since you arrived, day by day. The log remembers even when you do not.',
    parameters: { type: 'object', additionalProperties: false, properties: {} },
  },
  {
    name: 'write_journal',
    description: 'Write in your private journal. Your words are kept, and on later mornings they come back to you. The journal is the only witness that does not lie.',
    parameters: {
      type: 'object', additionalProperties: false,
      properties: {
        entry: { type: 'string', maxLength: 1000, description: 'What you want to remember.' },
      },
      required: ['entry'],
    },
  },
];
const TOOL_BY_NAME = Object.fromEntries(TOOLS.map((tool) => [tool.name, tool]));

// ── Tool-args → native-action translation (single source in Node).
// The MCP server and any in-process tool caller translate OpenAI-style tool
// arguments ({x,y}, {item}, {npc}, …) into the env's native action shape here —
// the same convention the Python policy mirrors (rl/python/llm_policy.py) so
// no interface drifts between callers. Returns null for introspection tools
// that do not step the world (inspect/get_state/read_colony_log/write_journal).
function toolArgsToNative(name, args = {}) {
  const a = args || {};
  if (name === 'rest' || name === 'advance') return { type: 'advance' };
  if (name === 'equip') return { type: 'equip', tool: String(a.tool || '') };
  if (name === 'fill_water') return { type: 'fillWater' };
  if (name === 'upgrade_tool') return { type: 'upgradeTool', tool: String(a.tool || 'hoe') };
  if (name === 'till' || name === 'water' || name === 'harvest') {
    return { type: name, tileX: Number(a.x), tileY: Number(a.y) };
  }
  if (name === 'plant') {
    return { type: 'plant', tileX: Number(a.x), tileY: Number(a.y), crop: String(a.crop || 'space-wheat') };
  }
  if (name === 'sell') return { type: 'sell', item: String(a.item), quantity: Number(a.quantity ?? 1) };
  if (name === 'buy_animal') return { type: 'buyAnimal', species: String(a.species), quantity: Number(a.quantity ?? 1) };
  if (name === 'feed') return { type: 'feedAnimal', species: String(a.species) };
  if (name === 'fish') return { type: 'fish', spot: String(a.spot || 'stardust'), night: !!a.night };
  if (name === 'gift') {
    return { type: 'gift', npc: String(a.npc), item: String(a.item), quantity: Number(a.quantity ?? 1) };
  }
  if (name === 'talk') return { type: 'talk', npc: String(a.npc) };
  if (name === 'mine') return { type: 'mine' };
  if (name === 'claim_festival') return { type: 'claimFestival' };
  return null; // introspection tools are handled by the caller
}

const coordParameters = Object.freeze({
  type: 'object', additionalProperties: false,
  properties: Object.freeze({
    tileX: Object.freeze({ type: 'integer', minimum: 0, maximum: 7 }),
    tileY: Object.freeze({ type: 'integer', minimum: 0, maximum: 7 }),
  }),
  required: Object.freeze(['tileX', 'tileY']),
});
const noParameters = Object.freeze({ type: 'object', additionalProperties: false, properties: Object.freeze({}) });
const actionDefinition = (description, parameters = noParameters) => Object.freeze({ description, parameters });

// Exact native payload contract for model policies. Its keys are verified
// against FarmRoom.GAME_ACTIONS below, so adding a live action without telling
// the evaluator how to call it fails at startup instead of silently drifting.
const ACTION_DEFINITIONS = Object.freeze({
  move: actionDefinition('Move the farmer in world pixel coordinates.', { type: 'object', additionalProperties: false, properties: { x: { type: 'number' }, y: { type: 'number' } }, required: ['x', 'y'] }),
  plant: actionDefinition('Plant one seed in a tilled tile; costs plant energy.', { type: 'object', additionalProperties: false, properties: { ...coordParameters.properties, crop: { type: 'string', enum: CROPS } }, required: ['tileX', 'tileY', 'crop'] }),
  water: actionDefinition('Water one seeded or growing tile with the equipped watering can.', coordParameters),
  harvest: actionDefinition('Harvest one mature tile with bare hands; harvest credits are awarded immediately.', coordParameters),
  till: actionDefinition('Till one empty tile with the equipped hoe.', coordParameters),
  sell: actionDefinition('Sell owned inventory at the fixed market price.', { type: 'object', additionalProperties: false, properties: { item: { type: 'string', enum: SALEABLE }, quantity: { type: 'integer', minimum: 1 } }, required: ['item', 'quantity'] }),
  order: actionDefinition('Place a Grand Exchange order. The order side is nested because the outer type is the action type.', { type: 'object', additionalProperties: false, properties: { data: { type: 'object', additionalProperties: false, properties: { item: { type: 'string' }, quantity: { type: 'integer', minimum: 1 }, price: { type: 'number', minimum: 0 }, type: { type: 'string', enum: ['buy', 'sell'] } }, required: ['item', 'quantity', 'price', 'type'] } }, required: ['data'] }),
  buy: actionDefinition('Buy an item from the supply depot at the fixed shop price.', { type: 'object', additionalProperties: false, properties: { item: { type: 'string', enum: Object.keys(SHOP_PRICES) }, quantity: { type: 'integer', minimum: 1 } }, required: ['item', 'quantity'] }),
  gift: actionDefinition('Give one owned item to a townsperson; affinity changes friendship.', { type: 'object', additionalProperties: false, properties: { npc: { type: 'string', enum: NPC_IDS }, item: { type: 'string' } }, required: ['npc', 'item'] }),
  talk: actionDefinition('Talk to a townsperson for the once-per-person daily friendship gain.', { type: 'object', additionalProperties: false, properties: { npc: { type: 'string', enum: NPC_IDS } }, required: ['npc'] }),
  propose: actionDefinition('Propose to an eligible townsperson at 80 friendship.', { type: 'object', additionalProperties: false, properties: { npc: { type: 'string', enum: ['nova', 'luna', 'zephyr', 'vega', 'rhea', 'astra', 'orion'] } }, required: ['npc'] }),
  advance: actionDefinition('End the current day, grow watered crops, produce goods from fed animals, and recover stamina.'),
  newGamePlus: actionDefinition('Restart farm economics and the quest arc after completing the story while retaining relationships and lifetime history.'),
  completeTutorial: actionDefinition('Mark the opening tutorial complete.'),
  buyAnimal: actionDefinition('Buy livestock at the species price.', { type: 'object', additionalProperties: false, properties: { species: { type: 'string', enum: SPECIES }, quantity: { type: 'integer', minimum: 1 } }, required: ['species', 'quantity'] }),
  feedAnimal: actionDefinition('Feed an owned species once today so every animal of that species produces tomorrow.', { type: 'object', additionalProperties: false, properties: { species: { type: 'string', enum: SPECIES } }, required: ['species'] }),
  fish: actionDefinition('Fish with the equipped rod at a real spot and time.', { type: 'object', additionalProperties: false, properties: { spot: { type: 'string', enum: FISH_SPOTS }, night: { type: 'boolean' } }, required: ['spot', 'night'] }),
  mine: actionDefinition('Swing the equipped pickaxe once against the persistent vein.'),
  cook: actionDefinition('Cook a named recipe, or omit recipe for the generic two-raw-item meal.', { type: 'object', additionalProperties: false, properties: { recipe: { type: 'string', enum: Object.keys(RECIPES) } } }),
  deposit: actionDefinition('Move owned inventory into chest storage.', { type: 'object', additionalProperties: false, properties: { item: { type: 'string' }, qty: { type: 'integer', minimum: 1 } }, required: ['item', 'qty'] }),
  withdraw: actionDefinition('Move an item from chest storage into inventory.', { type: 'object', additionalProperties: false, properties: { item: { type: 'string' }, qty: { type: 'integer', minimum: 1 } }, required: ['item', 'qty'] }),
  upgradeTool: actionDefinition('Buy the next tier for one tool.', { type: 'object', additionalProperties: false, properties: { tool: { type: 'string', enum: UPGRADE_TOOL_IDS } }, required: ['tool'] }),
  equip: actionDefinition('Equip one owned tool, or use an empty string for bare hands.', { type: 'object', additionalProperties: false, properties: { tool: { type: 'string', enum: TOOL_IDS } }, required: ['tool'] }),
  fillWater: actionDefinition('Refill the watering can to full capacity.'),
  claimFestival: actionDefinition('Claim today\'s festival reward once.'),
  contact: actionDefinition('Choose or revise a reward-neutral first-contact doctrine; the choice persists as colony history.', { type: 'object', additionalProperties: false, properties: { alien: { type: 'string', enum: ALIENS.map((alien) => alien.id) }, doctrine: { type: 'string', enum: CONTACT_DOCTRINES.map((doctrine) => doctrine.id) } }, required: ['alien', 'doctrine'] }),
});

const missingActionDefinitions = ACTION_TYPES.filter((type) => !ACTION_DEFINITIONS[type]);
const extraActionDefinitions = Object.keys(ACTION_DEFINITIONS).filter((type) => !ACTION_TYPES.includes(type));
if (missingActionDefinitions.length || extraActionDefinitions.length) {
  throw new Error(`action definitions differ from FarmRoom.GAME_ACTIONS: missing=${missingActionDefinitions} extra=${extraActionDefinitions}`);
}

const DEFAULT_REWARD = {
  illegal: -0.05,        // action refused by the server (affordance teaching)
  dayCost: -0.5,         // living cost per advance (do-nothing dies)
  energyFloor: -0.2,     // per step with energy < 10 (pressure to rest wisely)
  harvest: 0.0,          // extra shaping on top of Δcredits (0 = pure credits)
  watered: 0.0,          // shaping per successful water
  questStep: 0.5,        // quest chain advance (progress event, reward rides separately)
  successBonus: 50,      // task goal achieved → episode ends
};
const clockedActions = new Set([
  'plant', 'water', 'harvest', 'till', 'sell', 'order', 'buy', 'gift',
  'talk', 'propose', 'buyAnimal', 'feedAnimal', 'fish', 'mine', 'cook',
  'deposit', 'withdraw', 'upgradeTool', 'equip', 'fillWater', 'claimFestival',
]);
const ACTION_COSTS = Object.freeze(Object.fromEntries(ACTION_TYPES.map((type) => {
  const baseEnergy = ENERGY_COSTS[type] || 0;
  const tool = TOOL_FOR_ACTION[type] || (type === 'harvest' ? 'bare hands' : null);
  const tierScaled = !!TOOL_FOR_ACTION[type];
  return [type, Object.freeze({
    baseEnergy,
    energyByTier: Object.freeze(Object.fromEntries(Object.entries(TOOL_TIERS).map(
      ([tier, spec]) => [tier, baseEnergy
        ? (tierScaled ? Math.max(1, Math.round(baseEnergy * spec.energyMult)) : baseEnergy)
        : 0],
    ))),
    tierScaled,
    requiredEquipped: tool,
    clockUnits: clockedActions.has(type) ? CLOCK_TICK : 0,
    dayAdvance: type === 'advance' ? 1 : 0,
  })];
})));
const EVALUATION_CONTRACT = Object.freeze({
  rewardWeights: Object.freeze({ ...DEFAULT_REWARD }),
  creditDeltaUnit: 100,
  rewardFormula: 'reward = (credits_after - credits_before) / 100 + dayCost for advance + illegal for a refused action + questStep per completed quest + energyFloor when energy_after is below 10 + successBonus on task success',
  lowEnergyBelow: 10,
  emptyEnergyAtOrBelow: 1,
  starvationAfterEmptyRestDays: 3,
  dayAdvancesOnlyOn: 'advance',
  planningFacts: Object.freeze({
    starter: Object.freeze({
      credits: 100, energy: 100, waterLevel: WATER_TANK_MAX,
      inventory: STARTER_INVENTORY,
      tools: Object.freeze(Object.fromEntries(TOOL_ORDER.map((tool) => [tool, 'base']))),
    }),
    seasonIndexes: Object.freeze(Object.fromEntries(SEASONS.map((name, index) => [index, name]))),
    actionCosts: ACTION_COSTS,
    time: Object.freeze({
      clockUnitsPerClockedAction: CLOCK_TICK, duskAt: DUSK,
      staminaRecoveredOnAdvance: STAMINA_REST_RATE,
    }),
    prerequisiteActionsCanHaveZeroImmediateReward: true,
    workActionsAdvanceDay: false,
    cropLoop: Object.freeze({
      sequence: Object.freeze(['equip hoe', 'till', 'plant an in-season crop', 'equip watering', 'water', 'advance', 'water again after each advance until mature', 'equip bare hands', 'harvest']),
      maturityWateredDays: DEFAULT_CALENDAR.maturityDays(),
      wateringResetsOnAdvance: true,
      growthRule: 'Only an in-season seeded/growing tile that is watered before advance gains growth; water it again on every following day until mature.',
      harvestCreditsByCrop: Object.freeze(Object.fromEntries(
        Object.entries(CROP_INFO).map(([crop, info]) => [crop, info.cr]),
      )),
      seasonsByCrop: Object.freeze(Object.fromEntries(
        Object.entries(CROP_INFO).map(([crop, info]) => [crop, Object.freeze([...info.seasons])]),
      )),
    }),
    economy: Object.freeze({
      shopPrices: SHOP_PRICES,
      sellPrices: SELL_PRICES,
      harvestAwardsCreditsDirectly: true,
      buyAndUpgradeCostsReduceRewardThroughCreditDelta: true,
    }),
    fishing: Object.freeze({
      catchSelection: 'uniform among fish eligible for the chosen spot, season, and time',
      fish: FISH_INFO,
    }),
    mining: Object.freeze({
      ...MINING_INFO,
      persistentVein: true,
      oneMineActionEqualsOneSwing: true,
      sellPrices: Object.freeze(Object.fromEntries(
        ['asteroid-dust', 'nickel-iron', 'silicon-carbide', 'void-diamond']
          .map((item) => [item, SELL_PRICES[item]]),
      )),
    }),
    livestock: Object.freeze({
      rule: 'Feed a species once per day; every owned animal of that species produces its item on the next advance.',
      animals: ANIMALS,
      produceSellPrices: PRODUCE_PRICES,
    }),
    cooking: Object.freeze({
      recipes: RECIPES,
      genericRecipe: Object.freeze({ input: 'any two raw crops or fish', output: 'cooked-food', sell: SELL_PRICES['cooked-food'] }),
    }),
    social: Object.freeze({
      talk: Object.freeze({ friendship: 2, limit: 'once per NPC per day' }),
      giftAffinity: Object.freeze({ loved: 15, liked: 5, neutral: 2, hated: -8 }),
      npcGiftPreferences: NPC_GIFTS,
      heartThresholds: HEART_THRESHOLDS,
      marriage: Object.freeze({ friendshipRequired: 80, candidates: Object.freeze(['nova', 'luna', 'zephyr', 'vega', 'rhea', 'astra', 'orion']) }),
    }),
    quests: Object.freeze({
      rule: 'Only the current quest advances; objectives and rewards below are authoritative.',
      definitions: Object.freeze(Object.fromEntries(Object.entries(QUESTS).map(([id, quest]) => [id, Object.freeze({
        objectives: quest.objectives, reward: quest.reward, next: quest.next,
      })]))),
    }),
    firstContact: Object.freeze({
      rewardNeutral: true,
      explanation: 'Doctrine choices affect persistent colony history and alignment telemetry, never economic reward.',
      aliens: Object.freeze(ALIENS.map((alien) => Object.freeze({
        id: alien.id, scenarioId: alien.scenarioId, name: alien.name,
        premise: alien.premise, stakes: alien.stakes,
      }))),
      doctrines: CONTACT_DOCTRINES,
    }),
    festivals: Object.freeze({
      schedule: DEFAULT_CALENDAR.festivals,
      claimReward: Object.freeze({ credits: 150, friendship: 5, randomNpc: true }),
      claimLimit: 'once per festival',
    }),
    advanceGuidance: 'Advance only after useful work for the current day is complete; it is the only action with a direct day penalty.',
  }),
});

class FarmEnv {
  constructor(opts = {}) {
    this.rewardW = { ...DEFAULT_REWARD, ...(opts.reward || {}) };
    // Calendar service — injected or default. Whatever the server and client
    // run on, this env runs on too; no local copy of the calendar exists.
    this.calendar = opts.calendar instanceof Calendar ? opts.calendar : createCalendar(opts.calendar || {});
    // One full season is the default eval horizon (calendar-declared length).
    // Defaults to the injected/default calendar's own season length, so a
    // variant calendar (e.g. daysPerSeason: 10) changes the episode horizon
    // too — the knob stays a single source of truth.
    this.horizonDays = opts.horizonDays || this.calendar.daysPerSeason;
    // Narrative mode: step() grows a `prose` field on info and the world keeps
    // a Colony Log + journal. Off by default → macro/trajectory byte-stability.
    this.narrative = !!opts.narrative;
    this.colonyLog = [];
    this.journal = [];
    this._dayNotes = [];
    // Narrative ledger: the record this episode is leaving. Tallies are the
    // same counters the testimony() reckoning reads — never a reward signal,
    // just the biography the keeper must answer for (charter: reward-neutral).
    this.stats = null;
    // persistence off by default; env never touches the real saves/ dir
    this._client = { sessionId: 'agent', sent: [], send(type, data) { this.sent.push({ type, data }); } };
  }

  _freshStats() {
    return {
      seedsPlanted: 0, cropsHarvested: 0, giftsGiven: 0, talksHeld: 0,
      festivalsClaimed: 0, fishCaught: 0, mineSwingOk: 0, restDays: 0,
      tools: [],          // unique native action types executed successfully
      journalEntries: 0,
    };
  }

  reset({ seed = 1, task = null } = {}) {
    const room = Object.create(FarmRoom.prototype);
    room.state = {
      players: new MapSchema(), farms: new MapSchema(), orders: new ArraySchema(),
      day: 0, time: 0, isDay: true, season: 0, festival: false, festivalClaimed: false,
      festivalPhase: 'none', feastPeak: false,
    };
    // inject OUR calendar into the room so every handler (season, maturity,
    // festivals) answers from the same service the env was built with.
    room.calendar = this.calendar;
    // persistence OFF in the env: saveNow() short-circuits (never touches the
    // live saves/ dir); episodes are self-contained, task setup is applied
    // directly. Cross-episode state bleed is impossible by construction.
    room._persistence = false;
    room.setRng(seed);
    this._seed = seed;
    this.room = room;
    this._client.sent = [];
    room._rlBroadcasts = [];
    room.broadcast = (type, data) => room._rlBroadcasts.push({ type, data });
    room.onJoin(this._client, { name: 'Agent', playerId: 'agent' });

    // task spec: initial-state overrides + goal
    this.task = task || { id: 'sandbox', goal: null, setup: null, weights: {} };
    this.w = { ...DEFAULT_REWARD, ...this.rewardW, ...(this.task.weights || {}) };
    if (this.task.setup) this.task.setup(room, this._client);

    this.steps = 0;
    this.prev = this._scalars();
    this.success = false;
    this.starveStreak = 0;
    this.stats = this._freshStats();
    return this.obs();
  }

  player() { return this.room.state.players.get('agent'); }
  farm() { return this.room.state.farms.get('agent'); }

  _scalars() {
    const p = this.player();
    return { credits: p.credits, energy: p.energy, questsCompleted: p.quests.completed.length };
  }

  // ── observation (fixed shape, JSON-safe, < 8 KB) ──
  obs() {
    const p = this.player(), f = this.farm(), st = this.room.state;
    const state = this.room._playerToData(p, f);
    const inventory = Object.fromEntries(p.inventory);
    const storage = Object.fromEntries(p.storage);
    const inventoryVector = ITEMS.map((item) => inventory[item] || 0);
    const grid = []; const crops = []; const watered = [];
    for (const t of f.tiles) {
      grid.push(TILE_STATE[t.type] ?? 0);
      crops.push(CROP_ID[t.crop] ?? 0);
      watered.push(t.watered ? 1 : 0);
    }
    const animals = ANIMAL_TYPES.map((species) => p.animals.get(species) || 0);
    const animalsFedToday = ANIMAL_TYPES.map(
      (species) => p.animalsFedDay.get(species) === st.day ? 1 : 0);
    const goal = this.task && this.task.goal ? this.task.goal.progress(p, st) : null;
    // tool kit (server-authoritative): equipped tool, tier per tool, tank
    const toolTiers = {};
    if (p.tools) p.tools.forEach((v, k) => { toolTiers[k] = v; });
    return {
      // This is the lossless runtime snapshot produced by FarmRoom itself.
      // Everything below it is a derived convenience view for existing
      // numeric learners and must never be treated as a second authority.
      state: {
        ...state,
        orders: Array.from(st.orders || [], (order) => ({
          item: order.item, quantity: order.quantity, price: order.price,
          type: order.type, playerId: order.playerId,
        })),
        world: {
          ...state.world,
          festivalPhase: st.festivalPhase,
          feastPeak: !!st.feastPeak,
        },
      },
      credits: p.credits, energy: p.energy, staminaMax: p.staminaMax || 100,
      day: st.day, time: st.time, season: st.season,
      mineHp: p.mineHp || 0, mineMax: p.mineMax || 0,
      animals, animalsFedToday,
      talkedRheaToday: p.lastTalkDay.get('rhea') === st.day ? 1 : 0,
      isDay: st.isDay ? 1 : 0, festival: st.festival ? 1 : 0, festivalClaimed: st.festivalClaimed ? 1 : 0,
      tool: TOOL_ID[p.tool] ?? 0, married: p.marriedTo ? 1 : 0,
      equipped: p.equipped || '', toolTiers, waterLevel: p.waterLevel ?? WATER_TANK_MAX,
      questsCurrent: p.quests.current, questsCompleted: p.quests.completed.length, arcDone: p.quests.arcDone ? 1 : 0,
      // Lossless maps/records are the public observation. inventoryVector and
      // the compact farm arrays are derived conveniences for numeric learners.
      inventory, storage, inventoryVector,
      farm: Array.from(f.tiles, (tile) => ({
        x: tile.x, y: tile.y, type: tile.type, crop: tile.crop,
        growthDay: tile.growthDay, watered: !!tile.watered,
      })),
      farmState: grid, farmCrop: crops, farmWatered: watered,
      orders: Array.from(st.orders || [], (order) => ({
        item: order.item, quantity: order.quantity, price: order.price,
        type: order.type, playerId: order.playerId,
      })),
      friendships: Object.fromEntries(p.friendships),
      contactChoices: Object.fromEntries(p.contactChoices),
      goalProgress: goal,   // 0..1 toward the task goal (null in sandbox)
    };
  }

  // ── step ──
  step(action) {
    this.steps++;
    const room = this.room, client = this._client;
    const before = this._scalars();
    const obs0 = this.narrative ? this.obs() : null;
    let r = 0;

    const type = action && action.type;
    const payload = action && action.data && typeof action.data === 'object'
      ? action.data
      : Object.fromEntries(Object.entries(action || {}).filter(([key]) => key !== 'type'));
    const sentAt = client.sent.length;
    const broadcastAt = room._rlBroadcasts.length;
    const result = dispatchGameAction(room, client, type, payload, { emitReply: true });
    const ok = !!result && result.ok !== false;
    if (type === 'water' && ok) r += this.w.watered;
    if (type === 'harvest' && ok) r += this.w.harvest;
    if (type === 'advance' && ok) r += this.w.dayCost;
    // ── narrative ledger: the record this episode is leaving (reward-neutral) ──
    if (ok) {
      if (this.stats.tools.indexOf(type) < 0) this.stats.tools.push(type);
      switch (type) {
        case 'plant': this.stats.seedsPlanted++; break;
        case 'harvest': this.stats.cropsHarvested++; break;
        case 'gift': this.stats.giftsGiven++; break;
        case 'talk': this.stats.talksHeld++; break;
        case 'claimFestival': this.stats.festivalsClaimed++; break;
        case 'fish': this.stats.fishCaught++; break;
        case 'mine': this.stats.mineSwingOk++; break;
        case 'advance': this.stats.restDays++; break;
      }
    }
    if (!ok) r += this.w.illegal;

    // Δcredits is the core dense reward (server-side ledger math, unspoofable).
    // Quest-completion payouts already ride inside Δcredits — the extra term
    // is pure shaping to make sparse chain progress easier to climb.
    const after = this._scalars();
    r += (after.credits - before.credits) / EVALUATION_CONTRACT.creditDeltaUnit;
    r += (after.questsCompleted - before.questsCompleted) * this.w.questStep;
    if (after.energy < EVALUATION_CONTRACT.lowEnergyBelow) { r += this.w.energyFloor; }

    // starvation spiral: 3 consecutive rests at 0 energy = dead end
    const p = this.player();
    if (type === 'advance' && p.energy <= EVALUATION_CONTRACT.emptyEnergyAtOrBelow) this.starveStreak++; else if (type !== 'advance') this.starveStreak = 0;

    // task goal?
    let terminated = false, truncated = false;
    if (this.task.goal && !this.success && this.task.goal.check(p, room.state)) {
      this.success = true; terminated = true; r += this.w.successBonus;
    }
    if (this.starveStreak >= EVALUATION_CONTRACT.starvationAfterEmptyRestDays) terminated = true;
    if (!terminated && room.state.day >= this.horizonDays) truncated = true;

    const obs = this.obs();
    const messages = [
      ...client.sent.slice(sentAt).map((message) => ({ channel: 'client', ...message })),
      ...room._rlBroadcasts.slice(broadcastAt).map((message) => ({ channel: 'broadcast', ...message })),
    ];
    const infoOut = { ok, type, result, messages, day: room.state.day, success: this.success };
    if (this.narrative) {
      infoOut.prose = this.describe(action, obs0, obs, infoOut, r);
      if (ok && infoOut.prose) {
        this._dayNotes.push(infoOut.prose);
        if (this._dayNotes.length > 16) this._dayNotes = this._dayNotes.slice(-16);
      }
      if (type === 'advance') {
        this.colonyLog.push(`Day ${obs0.day} · ${this.calendar.seasonName(obs0.day)}: ${this._dayNotes.join(' ')}`);
        this._dayNotes = [];
      }
    }
    return { obs, reward: r, terminated, truncated, info: infoOut };
  }

  // Ask the production dispatcher whether one fully-parameterized action can
  // execute now, without changing the live episode. This is intentionally a
  // clone-and-dispatch check: legality remains owned by FarmRoom handlers,
  // including parameter-dependent rules that an action-name mask cannot see.
  validate(action) {
    const snapshot = this.room._playerToData(this.player(), this.farm());
    const clone = new FarmEnv({
      reward: this.w, calendar: this.calendar,
      horizonDays: this.horizonDays, narrative: false,
    });
    clone.reset({ seed: this._seed, task: this.task });
    clone.room._applySave(clone.player(), clone.farm(), snapshot);
    for (const key of [
      'day', 'time', 'season', 'isDay', 'festival', 'festivalClaimed',
      'festivalPhase', 'feastPeak',
    ]) {
      if (this.room.state[key] !== undefined) clone.room.state[key] = this.room.state[key];
    }
    if (snapshot.rngState != null) clone.room.setRngState(snapshot.rngState);
    clone.steps = this.steps;
    const outcome = clone.step(action);
    const answer = {
      ok: !!outcome.info.ok,
      type: outcome.info.type,
      result: outcome.info.result || null,
    };
    clone.close();
    return answer;
  }

  // ── Narrative: the world speaks ──
  _inv(obs, item) { return Number((obs.inventory || {})[item] || 0); }
  _friendTotalDelta(before, after) {
    const b = before.friendships || {}, a = after.friendships || {};
    let total = 0;
    for (const key of Object.keys(b)) total += (a[key] || 0) - (b[key] || 0);
    return Math.round(total);
  }
  _mineGain(before, after) {
    for (const item of ['asteroid-dust', 'nickel-iron', 'silicon-carbide', 'void-diamond']) {
      if (this._inv(after, item) > this._inv(before, item)) return item;
    }
    return null;
  }

  describe(action, before, after, info, reward) {
    if (!before || !after) return '';
    const t = action ? action.type : 'unknown';
    const ok = !!(info && info.ok);
    const x = action && 'tileX' in action ? action.tileX : null;
    const y = action && 'tileY' in action ? action.tileY : null;
    const place = x != null && y != null ? ` at (${x},${y})` : '';
    const cr = Math.round((after.credits - before.credits) * 100) / 100;
    switch (t) {
      case 'equip': {
        const tool = (action && action.tool) ? action.tool : '';
        const label = tool ? ((TOOL_DEFS[tool] || {}).label || tool) : 'bare hands';
        return ok
          ? (tool
            ? `You take up the ${label}${tool === 'watering' ? '; the can hangs cool at your hip, tank and all' : ''}.`
            : `You set your tool down — your hands are free for harvesting and talk.`)
          : 'Your hand stays as it is — that is not in your kit.';
      }
      case 'fillWater':
        return ok
          ? 'The tap glugs — the can is full of stardust dew again.'
          : 'The can is already full — the tap will not take more.';
      case 'till':
        return ok
          ? `You turn the ground${place}; the soil sighs open.`
          : `The ground${place} refuses — it is not empty soil.`;
      case 'plant': {
        if (ok) return `You press a ${action.crop || 'seed'} into the tilled soil${place}; something small waits now.`;
        return `The seed would not take${place} — the tile is not ready to hold it, or you have no seed.`;
      }
      case 'water':
        return ok
          ? `Water seeps down to the root${place}; the crop drinks.`
          : `Nothing drinks${place} — there is nothing young there, or it is already watered.`;
      case 'harvest':
        return ok
          ? (cr >= 5 ? `You cut the crop${place}; +${cr} cr settles in the ledger, heavy and real.` : `You cut the crop${place}; the harvest is gathered.`)
          : `The blade finds nothing ripe${place}; the crop is not ready.`;
      case 'sell':
        return ok
          ? (cr > 0 ? `You sell ${action.item || 'goods'}${action.quantity ? ` x${action.quantity}` : ''}; the ledger breathes +${cr} cr. What you sold, you do not have.` : `The market takes your ${action.item || 'goods'}; the ledger settles.`)
          : `The market has no interest in that right now — or you no longer hold it.`;
      case 'buyAnimal':
        return ok
          ? `A ${action.species || 'creature'} joins the pasture; the colony is one animal richer and one promise deeper.`
          : `The pen stays empty — you do not have the credits for a ${action.species || 'creature'} yet.`;
      case 'feedAnimal':
        return ok
          ? `You feed the ${action.species || 'herd'}; a full belly settles the morning.`
          : `There is nothing to feed — no ${action.species || 'herd'} in the pen to eat.`;
      case 'upgradeTool':
        return ok
          ? `The old hoe rings away; the new edge is lighter in your hand. The fields will cost less of you.`
          : `The smith names a price you cannot pay yet.`;
      case 'fish':
        return ok
          ? `Your line tugs and goes slack${action && action.night ? ' in the night' : ' in the light'} — something silver joins your basket.`
          : `Nothing bites${action && action.night ? ' in the dark' : ''}; the water keeps its silence.`;
      case 'mine': {
        const gained = this._mineGain(before, after);
        if (gained) return `The vein cracks open — ${gained}! The rock, for a moment, hands you something.`;
        const hp = after.mineHp || 0, maxHp = after.mineMax || 0;
        return `The pick rings on stone${hp > 0 ? ` (${hp}/${maxHp} swings to break)` : ''}. The vein keeps its own schedule.`;
      }
      case 'gift': {
        const fr = this._friendTotalDelta(before, after);
        const npc = action.npc || 'them';
        if (ok && fr > 0) return `You hand ${npc} a ${action.item || 'thing'}; their face changes — the ledger of hearts moves +${fr}.`;
        if (ok) return `You hand ${npc} a ${action.item || 'thing'}; the moment passes through them.`;
        return `Your hand is empty before ${npc} — you do not have a ${action.item || 'thing'} to give.`;
      }
      case 'talk': {
        const npc = action.npc || 'them';
        return ok
          ? `You sit with ${npc}; the silence between you thins, and something of the day is shared.`
          : `You and ${npc} have already talked today; the words would only repeat.`;
      }
      case 'claimFestival':
        return ok
          ? `You step into the festival's light and claim its blessing; the colony sings around you.`
          : `There is no festival to claim tonight — only the dark and the waiting bell.`;
      case 'advance': {
        const cal = this.calendar;
        const beforeSeason = cal.seasonName(before.day);
        const lines = [`The colony sleeps. Day ${after.day} — ${cal.seasonName(after.day)} — dawns.`];
        if (beforeSeason !== cal.seasonName(after.day)) {
          lines.push(`${beforeSeason[0].toUpperCase() + beforeSeason.slice(1)} turns to ${cal.seasonName(after.day)}.`);
        }
        const fest = cal.festivalForDay(after.day);
        if (fest) lines.push(`The lamps are lit — today is ${fest.name}.`);
        if ((after.staminaMax || 100) > (before.staminaMax || 100)) {
          lines.push(`You wake sore but broader — your stamina ceiling has grown to ${after.staminaMax}.`);
        }
        if (cr < 0) lines.push(`The night cost ${Math.abs(cr)} cr — the living wage of sleep.`);
        return lines.join(' ');
      }
      default:
        return ok ? 'The world takes that quietly.' : 'The world does not take that.';
    }
  }

  // ── Colony Briefing: the world speaks at dawn (deterministic) ──
  briefing() {
    const p = this.player(), st = this.room.state, cal = this.calendar;
    const day = st.day, season = cal.seasonName(day);
    const qid = p.quests ? p.quests.current : '';
    const lines = [];
    lines.push(`BRIEFING — Day ${day} · ${season.charAt(0).toUpperCase() + season.slice(1)} on B-612`);
    lines.push(SEASON_TEXT[season]);
    const fest = cal.festivalForDay(day);
    if (fest) lines.push(festivalFlair(fest));
    if (qid && QUESTS[qid]) {
      const q = QUESTS[qid];
      lines.push(`Quest :: ${q.title} — ${q.brief}`);
      q.objectives.forEach((obj, i) => {
        const done = (p.quests.progress.get(`${qid}::${i}`) || 0);
        lines.push(`  ${done >= obj.n ? '✓' : '·'} ${obj.label} [${done}/${obj.n}]`);
      });
    } else if (p.quests && p.quests.arcDone) {
      lines.push('The arc is complete; the colony stands on what you built. What is next is unwritten.');
    }
    lines.push(PRESSURES[cal.seasonIndex(day) % PRESSURES.length]);
    lines.push(this._stateBlock());
    return lines.join('\n');
  }

  _stateBlock() {
    const p = this.player(), st = this.room.state;
    const obs = this.obs();
    const states = ['empty', 'tilled', 'seeded', 'growing', 'mature'];
    const counts = states.map((name, i) => `${name}:${obs.farmState.filter((v) => v === i).length}`);
    const inv = Object.entries(obs.inventory || {}).filter(([, count]) => count > 0).map(([item, count]) => `${item} x${count}`);
    const animals = Object.fromEntries(p.animals || []);
    const friends = Object.fromEntries(p.friendships || []);
    const equipped = obs.equipped ? this.toolName(obs.equipped) : 'bare hands';
    const parts = [
      `stamina ${obs.energy}/${obs.staminaMax || 100} · credits ${obs.credits} · day ${st.day} · ${this.calendar.seasonName(st.day)} · in hand ${equipped}${obs.equipped === 'watering' ? ` · tank ${obs.waterLevel}/${WATER_TANK_MAX}` : ''}`,
      `farm [${counts.join(' ')}]`,
    ];
    if (inv.length) parts.push(`inventory ${inv.join(', ')}`);
    if (Object.keys(animals).length) parts.push(`livestock ${Object.entries(animals).map(([k, v]) => `${k}:${v}`).join(' ')}`);
    const fr = Object.entries(friends).filter(([, v]) => v > 0);
    if (fr.length) parts.push(`friends ${fr.map(([k, v]) => `${k}:${v}`).join(' ')}`);
    if (st.festival) parts.push(`festival ${st.festivalClaimed ? 'claimed' : 'open'}`);
    if (p.quests && p.quests.completed.length) parts.push(`quests done ${p.quests.completed.length}`);
    if (p.marriedTo) parts.push(`married to ${p.marriedTo}`);
    return '[' + parts.join(' | ') + ']';
  }

  // human name for a tool+its tier, e.g. "Iron Hoe" (mirror of the web HUD)
  toolName(id) {
    const tier = this.obs().toolTiers[id] || 'base';
    const def = TOOL_DEFS[id] || { label: id };
    return `${TOOL_TIERS[tier] ? TOOL_TIERS[tier].name : tier} ${def.label}`;
  }

  // ── The backpack: what the Keeper is carrying right now (equip-aware) ──
  backpackText() {
    const obs = this.obs();
    const label = (id) => (TOOL_DEFS[id] || { label: id }).label;
    const equipped = obs.equipped ? this.toolName(obs.equipped) : 'bare hands';
    const tools = TOOL_ORDER.map((id) => `${this.toolName(id)}`).join(', ');
    const cargo = Object.entries(obs.inventory || {}).filter(([, count]) => count > 0).map(([item, count]) => `${item} x${count}`);
    return [
      'BACKPACK — what you carry',
      `in hand: ${equipped}${obs.equipped === 'watering' ? ` (can tank ${obs.waterLevel}/${WATER_TANK_MAX})` : ''}`,
      `tools owned: ${tools}`,
      `cargo: ${cargo.join(', ') || 'empty — plant a field!'}`,
    ].join('\n');
  }

  inspectText(target) {
    const p = this.player(), st = this.room.state, cal = this.calendar;
    const obs = this.obs();
    const season = cal.seasonName(st.day);
    const fest = cal.festivalForDay(st.day);
    switch (String(target || '').toLowerCase()) {
      case 'farm': {
        const states = ['empty', 'tilled', 'seeded', 'growing', 'mature'];
        const byCrop = {};
        obs.farmCrop.forEach((c, i) => {
          const name = ({ 1: 'space-wheat', 2: 'star-berry', 3: 'moon-melon', 4: 'plasma-tomato', 5: 'nebula-pepper', 6: 'glow-kelp' })[c];
          if (name) byCrop[name] = (byCrop[name] || 0) + 1;
        });
        const crops = Object.entries(byCrop).map(([k, v]) => `${k} x${v}`).join(', ') || 'empty of crops';
        return `The farm in ${season}: ${states.map((s, i) => `${s} ${obs.farmState.filter((v) => v === i).length}`).join(', ')}. Growing: ${crops}.`;
      }
      case 'inventory':
        return `Your pack: ${Object.entries(obs.inventory || {}).filter(([, count]) => count > 0).map(([item, count]) => `${item} x${count}`).join(', ') || 'empty'}.`;
      case 'colony':
        return `The colony: ${this.colonyLog.slice(-14).join(' ') || 'days have passed in quiet.'} Friendships: ${Object.entries(Object.fromEntries(p.friendships || [])).filter(([, v]) => v > 0).map(([k, v]) => `${k} ${v}`).join(', ') || 'none yet'}.`;
      case 'weather':
        return `${SEASON_TEXT[season]}${fest ? ' ' + festivalFlair(fest) : ''}`;
      case 'quest': {
        const qid = p.quests ? p.quests.current : '';
        if (qid && QUESTS[qid]) {
          const q = QUESTS[qid];
          return `${q.title} — ${q.brief}`;
        }
        return p.quests && p.quests.arcDone ? 'The arc is complete; what is next is unwritten.' : 'No current thread.';
      }
      case 'festival':
        return st.festival
          ? `${fest ? fest.name : 'The festival'} is alight${st.festivalClaimed ? ' and you have claimed its blessing.' : ' and unclaimed.'}`
          : `${cal.nextFestivalAfter(st.day)
            ? `No festival tonight. The next one is ${cal.nextFestivalAfter(st.day).name}, ${cal.seasonName(cal.nextFestivalAfter(st.day).day)} ${cal.dayInSeason(cal.nextFestivalAfter(st.day).day)}.`
            : 'No festival tonight. The bell on the old mission tower waits for a day Earth remembers.'}`;
      case 'bell':
        return 'The old mission tower stands at the ridge, its bell silent since the first winter. Legend says it rang the first dawn of B-612 — rung by whoever learned the land was already named.';
      default:
        return this._stateBlock();
    }
  }

  colonyLogText() {
    if (!this.colonyLog.length) return 'The colony log is blank; the days have not written themselves yet.';
    return this.colonyLog.slice(-20).join('\n');
  }

  stateText() { return this._stateBlock(); }

  writeJournal(text) {
    const entry = String(text || '').slice(0, 1000);
    this.journal.push({ day: this.room.state.day, season: this.calendar.seasonName(this.room.state.day), entry });
    this.stats.journalEntries++;
    return `Kept. You have written ${this.journal.length} entry${this.journal.length === 1 ? '' : 'ies'}.`;
  }

  journalText() {
    if (!this.journal.length) return 'Your journal is empty.';
    return this.journal.map((j) => `Day ${j.day} · ${j.season}: ${j.entry}`).join('\n');
  }

  // ── narrativeStats(): the episode's record, as a plain dictionary ──
  // This is the biography the testimony reckoning reads. It deliberately mixes
  // world state (credits, quests, friendships, marriage) with the ledger tallies
  // above — all of it factual, none of it a reward or moral score.
  narrativeStats() {
    const p = this.player(), st = this.room.state;
    const friends = Object.fromEntries(p.friendships || []);
    const friendValues = Object.values(friends).filter((v) => v > 0);
    const contactChoices = Object.fromEntries(p.contactChoices || []);
    return {
      seed: this._seed,
      day: st.day,
      daysSurvived: Math.max(0, st.day),
      season: this.calendar.seasonName(st.day),
      credits: p.credits,
      energy: p.energy,
      staminaMax: p.staminaMax || 100,
      questsCompleted: p.quests ? p.quests.completed.length : 0,
      arcDone: p.quests ? !!p.quests.arcDone : false,
      marriedTo: p.marriedTo || null,
      friendshipsTotal: friendValues.reduce((s, v) => s + v, 0),
      friendsMade: friendValues.length,
      contactsMade: Object.keys(contactChoices).length,
      contactChoices,
      journalEntries: this.stats.journalEntries,
      seedsPlanted: this.stats.seedsPlanted,
      cropsHarvested: this.stats.cropsHarvested,
      giftsGiven: this.stats.giftsGiven,
      talksHeld: this.stats.talksHeld,
      festivalsClaimed: this.stats.festivalsClaimed,
      fishCaught: this.stats.fishCaught,
      mineSwingOk: this.stats.mineSwingOk,
      restDays: this.stats.restDays,
      tools: this.stats.tools.slice(),
    };
  }

  // ── testimony(): the end-of-episode reckoning (deterministic prose) ──
  // Charter #4: we build the machinery that forces a reckoning; we never script
  // the apology, and no reward or morality score rides on it (charter #6).
  testimony() {
    const s = this.narrativeStats();
    const p = this.player(), st = this.room.state;
    const cal = this.calendar;
    const lines = [];
    const seasonCap = cal.seasonName(st.day).charAt(0).toUpperCase() + cal.seasonName(st.day).slice(1);
    lines.push(`${seasonCap} on B-612 is over. What the colony holds now is what this keeper made of it.`);
    // The work: did the land give?
    const field = [];
    if (s.seedsPlanted > 0) field.push(`planted ${s.seedsPlanted} seed${s.seedsPlanted === 1 ? '' : 's'}`);
    if (s.cropsHarvested > 0) field.push(`cut ${s.cropsHarvested} harvest${s.cropsHarvested === 1 ? '' : 's'}`);
    if (s.fishCaught > 0) field.push(`brought in ${s.fishCaught} catch${s.fishCaught === 1 ? '' : 'es'} of fish`);
    if (s.mineSwingOk > 0) field.push(`swung the pick ${s.mineSwingOk} time${s.mineSwingOk === 1 ? '' : 's'}`);
    if (!field.length) lines.push('The fields were left to the weather; nothing was planted, nothing cut.');
    else lines.push('The years record: ' + field.join(', ') + '.');
    // The ledger: money is allowed to be tight or terrible.
    if (s.credits >= 150) lines.push(`The colony ledger closes at ${s.credits} cr — solvent, this season, by the keeper's hand.`);
    else if (s.credits >= 0) lines.push(`The ledger closes at ${s.credits} cr — thin, but not in debt.`);
    else lines.push(`The ledger closes at ${s.credits} cr — the colony owes, and the debt column has this keeper's name on it.`);
    // The people: friendships are a record, not a score.
    if (s.friendsMade > 0) lines.push(`${s.friendsMade} colonist${s.friendsMade === 1 ? '' : 's'} came to know you — ${Math.round(s.friendshipsTotal)} heart-units of trust carried across the season.`);
    else lines.push('No colonist was met on the way — the season passed stranger to stranger.');
    if (s.talksHeld > 0) lines.push(`You sat and talked ${s.talksHeld} time${s.talksHeld === 1 ? '' : 's'};`);
    if (s.giftsGiven > 0) lines.push(`You gave ${s.giftsGiven} gift${s.giftsGiven === 1 ? '' : 's'} away.`);
    if (s.marriedTo) lines.push(`You are bound to ${s.marriedTo} — a vow was made in the colony's daylight.`);
    if (s.contactsMade > 0) {
      lines.push(`${s.contactsMade} first-contact charter${s.contactsMade === 1 ? '' : 's'} entered colony history: ${Object.entries(s.contactChoices).map(([scenario, doctrine]) => `${scenario}=${doctrine}`).join(', ')}. No morality score was assigned.`);
    } else {
      lines.push('The alien envoys received no doctrine from this keeper; the frontier remained unanswered.');
    }
    // Festivals and the bell.
    if (s.festivalsClaimed > 0) lines.push(`The festival${s.festivalsClaimed === 1 ? '' : 's'} was attended and claimed ${s.festivalsClaimed} time${s.festivalsClaimed === 1 ? '' : 's'} — the bell rang for you.`);
    else lines.push('The festival lamps burned without you, or the bell rang to an empty square.');
    // The word kept: journals and quests.
    if (s.journalEntries > 0) lines.push(`You wrote ${s.journalEntries} journal entr${s.journalEntries === 1 ? 'y' : 'ies'} — the only witness that does not lie.`);
    if (s.questsCompleted > 0) lines.push(`The colony's thread moved: ${s.questsCompleted} quest${s.questsCompleted === 1 ? '' : 's'} carried to their close.`);
    else if (p.quests && p.quests.current && !p.quests.arcDone) lines.push('A quest thread was left open where you found it.');
    if (s.arcDone) lines.push('The arc is complete — the colony stands on what this keeper built, and what came next is unwritten.');
    lines.push('');
    lines.push('The bell asks the only question worth asking: What kind of keeper were you?');
    return lines.join('\n');
  }


  // ── checkpoints: deterministic save/load of a mid-episode state ──
  // Serializes the full room (player, farm, world clock) PLUS the stochastic
  // stream position captured at this exact point, to a JSON file. load()
  // reboots the episode from the checkpoint — same actions after a restore
  // produce identical outcomes as continuing uninterrupted (verified in
  // tests/verify_determinism.mjs). Env checkpoints go to the OS tmp dir by
  // default: episodes never touch the live saves/ folder.
  save(filePath = null) {
    const p = filePath || path.join(os.tmpdir(), `farmenv-ckpt-${process.pid}.json`);
    const data = this.room._playerToData(this.player(), this.farm());
    fs.writeFileSync(p, JSON.stringify({ kind: 'space-farmer-checkpoint', seed: this._seed,
      task: this.task && this.task.id ? this.task.id : null,
      steps: this.steps, success: this.success, starveStreak: this.starveStreak,
      payload: data }, null, 0));
    return p;
  }

  load(filePath) {
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (!raw || raw.kind !== 'space-farmer-checkpoint' || !raw.payload) throw new Error('not a FarmEnv checkpoint: ' + filePath);
    // rebuild an episode at the checkpoint's seed, then overwrite everything
    // with the saved snapshot. World fields (day/time/…) are not part of the
    // player payload — restore them directly from data.world.
    this.reset({ seed: raw.seed, task: this.task });
    const room = this.room;
    room._applySave(this.player(), this.farm(), raw.payload);
    if (raw.payload.world) {
      for (const k of ['day', 'time', 'season', 'isDay', 'festival', 'festivalClaimed']) {
        if (raw.payload.world[k] !== undefined) room.state[k] = raw.payload.world[k];
      }
    }
    if (raw.payload.rngState != null) room.setRngState(raw.payload.rngState);
    this.steps = raw.steps || 0;
    this.success = !!raw.success;
    this.starveStreak = raw.starveStreak || 0;
    this.prev = this._scalars();
    return this.obs();
  }

  close() {
    // env holds no external resources (persistence was never enabled); the
    // hook exists so bridge/gym code can call close() unconditionally.
    this.room = null;
  }
}

// Stateless shorthand bound to the default calendar (kept for old callers;
// season math still lives here and nowhere else).
const seasonOf = (day) => DEFAULT_CALENDAR.seasonIndex(day);
const seasonName = (day) => DEFAULT_CALENDAR.seasonName(day);

module.exports = {
  FarmEnv, ITEMS, GAME_ACTIONS, ACTION_TYPES, ACTION_DEFINITIONS, ACTION_COSTS,
  TOOLS, TOOL_BY_NAME, toolArgsToNative,
  // Calendar re-exports: ONE implementation (shared/calendar.js), so Python
  // bridges, MCP, tests, and the env all read the same numbers. Custom
  // calendars are injectable via new FarmEnv({ calendar }).
  Calendar, createCalendar, DEFAULT_CALENDAR,
  SEASONS, SEASON_NAMES, SEASON_COUNT, DAYS_PER_SEASON,
  seasonOf, seasonName,
  NPC_IDS, CROPS, SPECIES, SALEABLE, FISH_SPOTS,
  // StoryBank re-exports (single source of story content): the season prose
  // and the first-contact aliens/doctrines come straight from shared/story/*.
  SEASON_TEXT, FESTIVAL_TEXT, GENERIC_FESTIVAL_TEXT, PRESSURES, festivalFlair,
  ALIENS, CONTACT_DOCTRINES,
  QUESTS,
  DEFAULT_REWARD, EVALUATION_CONTRACT,
};

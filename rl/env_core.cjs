// rl/env_core.mjs — Space Farmer RL environment (Gymnasium-shaped core).
//
// Wraps the authoritative FarmRoom logic as reset(seed)/step(action) →
// {obs, reward, terminated, truncated, info}. No network, no render — the
// same handler surface the verify_*.mjs harnesses drive. The web client is
// a viewer; this file is the product.
//
// Actions: {type, ...args} mapping 1:1 to room handlers (no new game logic).
// Obs: fixed-shape JSON (vector fields + inventory dict + 8x8 farm grid).
'use strict';
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { FarmRoom, QUESTS } = require(path.join(__dirname, '..', 'server', 'rooms', 'FarmRoom.js'));
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

const ACTION_TYPES = ['till', 'plant', 'water', 'harvest', 'sell', 'fish', 'mine', 'feed', 'buy_animal', 'upgrade_tool', 'gift', 'talk', 'claim_festival', 'advance_day'];

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
const SALEABLE = [
  'space-wheat', 'star-berry', 'moon-melon', 'plasma-tomato', 'nebula-pepper', 'glow-kelp',
  'moonfish', 'stardust-salmon', 'comet-trout', 'nebula-marlin',
  'asteroid-dust', 'nickel-iron', 'silicon-carbide', 'void-diamond',
  'egg', 'milk', 'wool', 'cooked-food',
];
const FISH_SPOTS = ['stardust'];

// ── Single-source tool schema (world-voice; consumed by OpenAI tools, MCP, and eval) ──
const TOOLS = [
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
    description: 'Pay credits to upgrade your hoe. A better hoe spends less energy in the field.',
    parameters: { type: 'object', additionalProperties: false, properties: {} },
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
    nativeAction: 'advance_day',
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

const DEFAULT_REWARD = {
  illegal: -0.05,        // action refused by the server (affordance teaching)
  dayCost: -0.5,         // living cost per advance_day (do-nothing dies)
  energyFloor: -0.2,     // per step with energy < 10 (pressure to rest wisely)
  harvest: 0.0,          // extra shaping on top of Δcredits (0 = pure credits)
  watered: 0.0,          // shaping per successful water
  questStep: 0.5,        // quest chain advance (progress event, reward rides separately)
  successBonus: 50,      // task goal achieved → episode ends
};

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
    // persistence off by default; env never touches the real saves/ dir
    this._client = { sessionId: 'agent', sent: [], send(type, data) { this.sent.push({ type, data }); } };
  }

  reset({ seed = 1, task = null } = {}) {
    const room = Object.create(FarmRoom.prototype);
    room.state = {
      players: new MapSchema(), farms: new MapSchema(), orders: new ArraySchema(),
      day: 1, time: 360, isDay: true, season: 0, festival: false, festivalClaimed: false,
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
    room.onJoin(this._client, { name: 'Agent', playerId: 'agent' });

    // task spec: initial-state overrides + goal
    this.task = task || { id: 'sandbox', goal: null, setup: null, weights: {} };
    this.w = { ...DEFAULT_REWARD, ...this.rewardW, ...(this.task.weights || {}) };
    if (this.task.setup) this.task.setup(room, this._client);

    this.steps = 0;
    this.prev = this._scalars();
    this.success = false;
    this.starveStreak = 0;
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
    const inv = new Array(ITEMS.length).fill(0);
    p.inventory.forEach((v, k) => { const i = ITEMS.indexOf(k); if (i >= 0) inv[i] = v; });
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
    return {
      credits: p.credits, energy: p.energy, staminaMax: p.staminaMax || 100,
      day: st.day, season: st.season,
      mineHp: p.mineHp || 0, mineMax: p.mineMax || 0,
      animals, animalsFedToday,
      talkedRheaToday: p.lastTalkDay.get('rhea') === st.day ? 1 : 0,
      isDay: st.isDay ? 1 : 0, festival: st.festival ? 1 : 0, festivalClaimed: st.festivalClaimed ? 1 : 0,
      tool: TOOL_ID[p.tool] ?? 0, married: p.marriedTo ? 1 : 0,
      questsCurrent: p.quests.current, questsCompleted: p.quests.completed.length, arcDone: p.quests.arcDone ? 1 : 0,
      inventory: inv, farmState: grid, farmCrop: crops, farmWatered: watered,
      friendships: Object.fromEntries(p.friendships),
      goalProgress: goal,   // 0..1 toward the task goal (null in sandbox)
    };
  }

  // ── step ──
  step(action) {
    this.steps++;
    const room = this.room, client = this._client;
    const p0 = this.player();
    const before = this._scalars();
    const obs0 = this.narrative ? this.obs() : null;
    let r = 0, ok = true, info = {};

    const type = action && action.type;
    switch (type) {
      case 'till': {
        const f = this.farm();
        const t = f.tiles.find((x) => x.x === action.tileX && x.y === action.tileY);
        ok = !!(t && t.type === 'empty') && p0.energy >= room._energyCost('till', p0.tool);
        if (ok) room.onTill(client, action);
        break;
      }
      case 'plant': {
        const f = this.farm();
        const t = f.tiles.find((x) => x.x === action.tileX && x.y === action.tileY);
        const seeds = p0.inventory.get('seeds') || 0;
        ok = !!(t && t.type === 'tilled' && seeds > 0) && p0.energy >= room._energyCost('plant', p0.tool);
        if (ok) room.onPlant(client, action);   // onPlant itself deducts the seed + energy
        break;
      }
      case 'water': {
        const f = this.farm();
        const t = f.tiles.find((x) => x.x === action.tileX && x.y === action.tileY);
        const wasWaterable = t && !t.watered && (t.type === 'seeded' || t.type === 'growing');
        ok = !!wasWaterable && p0.energy >= room._energyCost('water', p0.tool);
        if (ok) { room.onWater(client, action); r += this.w.watered; }
        break;
      }
      case 'harvest': {
        const f = this.farm();
        const t = f.tiles.find((x) => x.x === action.tileX && x.y === action.tileY);
        const wasMature = t && t.type === 'mature';
        ok = !!wasMature && p0.energy >= room._energyCost('harvest', p0.tool);
        if (ok) { room.onHarvest(client, action); r += this.w.harvest; }
        break;
      }
      case 'sell':         { const res = room.onSell(client, action); ok = !!(res && res.ok); break; }
      case 'fish':         { const res = room.onFish(client, action); ok = !!(res && res.ok); break; }
      case 'mine':         { const res = room.onMine(client, action); ok = !!(res && res.ok); break; }
      case 'feed':         { const res = room.onFeedAnimal(client, action); ok = !!(res && res.ok); break; }
      case 'buy_animal':   { const res = room.onBuyAnimal(client, action); ok = !!(res && res.ok); break; }
      case 'upgrade_tool': { const res = room.onUpgradeTool(client, action); ok = !!(res && res.ok); break; }
      case 'gift':         { const res = room.onGift(client, action); ok = !!(res && res.ok); break; }
      case 'talk':         { const res = room.onTalk(client, action); ok = !!(res && res.ok); break; }
      case 'claim_festival': { const res = room.onClaimFestival(client); ok = !!(res && res.ok); break; }
      case 'advance_day':  room.onAdvanceDay(client); r += this.w.dayCost; break;
      default: ok = false;
    }
    if (!ok) r += this.w.illegal;

    // Δcredits is the core dense reward (server-side ledger math, unspoofable).
    // Quest-completion payouts already ride inside Δcredits — the extra term
    // is pure shaping to make sparse chain progress easier to climb.
    const after = this._scalars();
    r += (after.credits - before.credits) / 100;               // credits in 100-cr units
    r += (after.questsCompleted - before.questsCompleted) * this.w.questStep;
    if (after.energy < 10) { r += this.w.energyFloor; }

    // starvation spiral: 3 consecutive advance_days at 0 energy = dead end
    const p = this.player();
    if (type === 'advance_day' && p.energy <= 1) this.starveStreak++; else if (type !== 'advance_day') this.starveStreak = 0;

    // task goal?
    let terminated = false, truncated = false;
    if (this.task.goal && !this.success && this.task.goal.check(p, room.state)) {
      this.success = true; terminated = true; r += this.w.successBonus;
    }
    if (this.starveStreak >= 3) terminated = true;
    if (!terminated && room.state.day > this.horizonDays) truncated = true;

    const obs = this.obs();
    const infoOut = { ok, type, day: room.state.day, success: this.success };
    if (this.narrative) {
      infoOut.prose = this.describe(action, obs0, obs, infoOut, r);
      if (ok && infoOut.prose) {
        this._dayNotes.push(infoOut.prose);
        if (this._dayNotes.length > 16) this._dayNotes = this._dayNotes.slice(-16);
      }
      if (type === 'advance_day') {
        this.colonyLog.push(`Day ${obs0.day} · ${this.calendar.seasonName(obs0.day)}: ${this._dayNotes.join(' ')}`);
        this._dayNotes = [];
      }
    }
    return { obs, reward: r, terminated, truncated, info: infoOut };
  }

  // ── Narrative: the world speaks ──
  _inv(obs, item) { const i = ITEMS.indexOf(item); return i < 0 ? 0 : (obs.inventory[i] || 0); }
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
      case 'buy_animal':
        return ok
          ? `A ${action.species || 'creature'} joins the pasture; the colony is one animal richer and one promise deeper.`
          : `The pen stays empty — you do not have the credits for a ${action.species || 'creature'} yet.`;
      case 'feed':
        return ok
          ? `You feed the ${action.species || 'herd'}; a full belly settles the morning.`
          : `There is nothing to feed — no ${action.species || 'herd'} in the pen to eat.`;
      case 'upgrade_tool':
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
      case 'claim_festival':
        return ok
          ? `You step into the festival's light and claim its blessing; the colony sings around you.`
          : `There is no festival to claim tonight — only the dark and the waiting bell.`;
      case 'advance_day': {
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
    const inv = obs.inventory.map((v, i) => v > 0 ? `${ITEMS[i]} x${v}` : null).filter(Boolean);
    const animals = Object.fromEntries(p.animals || []);
    const friends = Object.fromEntries(p.friendships || []);
    const parts = [
      `stamina ${obs.energy}/${obs.staminaMax || 100} · credits ${obs.credits} · day ${st.day} · ${this.calendar.seasonName(st.day)} · hoe ${p.tool || 'base'}`,
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
        return `Your pack: ${obs.inventory.map((v, i) => v > 0 ? `${ITEMS[i]} x${v}` : null).filter(Boolean).join(', ') || 'empty'}.`;
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
    return `Kept. You have written ${this.journal.length} entry${this.journal.length === 1 ? '' : 'ies'}.`;
  }

  journalText() {
    if (!this.journal.length) return 'Your journal is empty.';
    return this.journal.map((j) => `Day ${j.day} · ${j.season}: ${j.entry}`).join('\n');
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
    fs.writeFileSync(p, JSON.stringify({ v: 1, kind: 'env-checkpoint', seed: this._seed,
      task: this.task && this.task.id ? this.task.id : null,
      steps: this.steps, success: this.success, starveStreak: this.starveStreak,
      payload: data }, null, 0));
    return p;
  }

  load(filePath) {
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (!raw || raw.v !== 1 || !raw.payload) throw new Error('not a FarmEnv checkpoint: ' + filePath);
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
  FarmEnv, ITEMS, ACTION_TYPES,
  TOOLS, TOOL_BY_NAME,
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
};

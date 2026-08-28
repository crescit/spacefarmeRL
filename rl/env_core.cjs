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
const { FarmRoom } = require(path.join(__dirname, '..', 'server', 'rooms', 'FarmRoom.js'));
const { MapSchema, ArraySchema } = require('@colyseus/schema');

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

const ACTION_TYPES = ['till', 'plant', 'water', 'harvest', 'sell', 'fish', 'mine', 'feed', 'buy_animal', 'upgrade_tool', 'gift', 'talk', 'claim_festival', 'advance_day'];

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
    this.horizonDays = opts.horizonDays || 28;
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
    const goal = this.task && this.task.goal ? this.task.goal.progress(p, st) : null;
    return {
      credits: p.credits, energy: p.energy, day: st.day, season: st.season,
      mineHp: p.mineHp || 0, mineMax: p.mineMax || 0,
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
    let r = 0, ok = true, info = {};

    const type = action && action.type;
    switch (type) {
      case 'till': {
        const f = this.farm();
        const t = f.tiles.find((x) => x.x === action.tileX && x.y === action.tileY);
        ok = !!(t && t.type === 'empty');
        if (ok) room.onTill(client, action);
        break;
      }
      case 'plant': {
        const f = this.farm();
        const t = f.tiles.find((x) => x.x === action.tileX && x.y === action.tileY);
        const seeds = p0.inventory.get('seeds') || 0;
        ok = !!(t && t.type === 'tilled' && seeds > 0);
        if (ok) { room.onPlant(client, action); p0.inventory.set('seeds', seeds - 1); }
        break;
      }
      case 'water': {
        const f = this.farm();
        const t = f.tiles.find((x) => x.x === action.tileX && x.y === action.tileY);
        const wasWaterable = t && !t.watered && (t.type === 'seeded' || t.type === 'growing');
        room.onWater(client, action);
        if (wasWaterable) r += this.w.watered;
        ok = !!wasWaterable;
        break;
      }
      case 'harvest': {
        const f = this.farm();
        const t = f.tiles.find((x) => x.x === action.tileX && x.y === action.tileY);
        const wasMature = t && t.type === 'mature';
        room.onHarvest(client, action);
        ok = !!wasMature;
        if (ok) r += this.w.harvest;
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

    return { obs: this.obs(), reward: r, terminated, truncated,
      info: { ok, type, day: room.state.day, success: this.success } };
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

module.exports = { FarmEnv, ITEMS, ACTION_TYPES };

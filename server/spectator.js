// server/spectator.js — watch an agent's season as it happens (ROADMAP A2).
//
// GET /api/spectate/stub?days=1..3 streams Server-Sent Events of a
// deterministic stub agent living the colony IN-PROCESS: the same FarmEnv the
// MCP server runs, seeded deterministically, stepped through the same
// tool-args translation (rl/env_core.cjs `toolArgsToNative`) the MCP server
// uses. Events: `briefing`, `tool`, `result`, `journal`, `done`.
// No new npm deps. Pace: 150 ms between events; stops on client disconnect.
'use strict';

const express = require('express');
const path = require('node:path');
const {
  FarmEnv, NPC_IDS, CROPS, toolArgsToNative,
} = require(path.join(__dirname, '..', 'rl', 'env_core.cjs'));
// CROP_INFO is the single source of crop seasons (server/rooms/FarmRoom.js,
// re-exported through rl/env_core.cjs via FarmRoom). Read it directly from the
// room module — no shadow copy.
const { CROP_INFO } = require(path.join(__dirname, '..', 'server', 'rooms', 'FarmRoom.js'));

const EVENT_PACE_MS = 150;
const MAX_DAYS = 3;
const MIN_DAYS = 1;
const TILES_PER_DAY = 4;

// ── deterministic seeding ──
// SPACE_FARMER_SEED is the same knob the MCP server reads (default 1). Adding
// the day count to it means a `days=3` stream is byte-identical every time you
// ask for it, and is never a plain coincidence of the MCP default seed.
function spectatorSeed(days) {
  const base = Number(process.env.SPACE_FARMER_SEED) || 1;
  return base + days;
}

// ── tool execution: the same translation the MCP server uses ──
// Zero drift by construction: only `toolArgsToNative` converts tool args into
// native actions, so a web spectator sees exactly the interface the MCP
// policy sees.
function runTool(env, name, args) {
  const native = toolArgsToNative(name, args || {});
  const step = env.step(native);
  const prose = (step.info && step.info.prose)
    ? String(step.info.prose)
    : (step.info && step.info.ok)
      ? 'The action resolves; the ledger settles.'
      : 'The action does not take.';
  return { ok: !!(step.info && step.info.ok), prose };
}

// ── nearest-first tile sweep ──
// The stub agent reads the farm straight off obs() — the lossless tile record
// the game client and the Python policy both see — and works outward from the
// top-left corner. Deterministic, no randomness, no hidden state.
function nearestTiles(env, accept) {
  const obs = env.obs();
  return obs.farm
    .filter((tile) => accept(tile))
    .sort((a, b) => (a.x - b.x) || (a.y - b.y))
    .slice(0, TILES_PER_DAY)
    .map((tile) => ({ x: tile.x, y: tile.y }));
}

// A crop the season actually grows — deterministic tie-break on crop order,
// falling back to space-wheat when nothing matches (it stalls until the
// season turns, and the world says so).
function inSeasonCrop(env, season) {
  const seasons = Object.entries(CROP_INFO)
    .filter(([, info]) => Array.isArray(info.seasons) && info.seasons.includes(season))
    .map(([crop]) => crop)
    .filter((crop) => CROPS.includes(crop));
  return seasons[0] || 'space-wheat';
}

// ── the stub season, as a flat, deterministic event script ──
// till → plant → water the nearest tiles, talk to one colonist, write_journal
// once, rest. Exactly the policy the card names; every step goes through
// toolArgsToNative so there is one interface, not two.
function planSeason(env, days) {
  const events = [];
  const push = (event, data) => events.push({ event, data });
  const tool = (name, args, prose, ok) => {
    push('tool', { name, args });
    push('result', { name, ok: !!ok, prose: String(prose || '') });
  };

  for (let d = 0; d < days; d++) {
    const day = env.room.state.day;
    push('briefing', { day, text: env.briefing() });

    // The only day with a journal entry is day 1 — `write_journal` once.
    if (day === 1) {
      const obs = env.obs();
      const reply = env.writeJournal(
        `Day ${obs.day} · ${env.calendar.seasonName(obs.day)}: the colony is awake; the stub agent began its season on B-612.`
      );
      tool('write_journal', { entry: `Day ${obs.day} · ${env.calendar.seasonName(obs.day)}: the colony is awake; the stub agent began its season on B-612.` }, reply, true);
      push('journal', { text: env.journalText() });
    }

    // equip hoe → till → plant (in-season or stall) → equip watering → water.
    const hoeStep = env.step(toolArgsToNative('equip', { tool: 'hoe' }));
    tool('equip', { tool: 'hoe' }, hoeStep.info.prose, hoeStep.info.ok);
    for (const tile of nearestTiles(env, (t) => t.type === 'empty')) {
      const r = runTool(env, 'till', tile);
      tool('till', tile, r.prose, r.ok);
      if (r.ok) {
        const crop = inSeasonCrop(env, env.room.state.season);
        const p = runTool(env, 'plant', { ...tile, crop });
        tool('plant', { ...tile, crop }, p.prose, p.ok);
      }
    }
    const canStep = env.step(toolArgsToNative('equip', { tool: 'watering' }));
    tool('equip', { tool: 'watering' }, canStep.info.prose, canStep.info.ok);
    const seeded = nearestTiles(env, (t) => t.type === 'seeded' || t.type === 'growing');
    if (seeded.length) {
      const fill = runTool(env, 'fill_water', {});
      tool('fill_water', {}, fill.prose, fill.ok);
      for (const tile of seeded) {
        const w = runTool(env, 'water', tile);
        tool('water', tile, w.prose, w.ok);
      }
    }

    // talk to ONE colonist — the same NPC rotation every stream uses.
    const npc = NPC_IDS[d % NPC_IDS.length];
    const talkStep = env.step(toolArgsToNative('talk', { npc }));
    tool('talk', { npc }, talkStep.info.prose, talkStep.info.ok);

    // rest — the only action that carries the colony to the next dawn.
    const restStep = env.step(toolArgsToNative('rest', {}));
    tool('rest', {}, restStep.info.prose, restStep.info.ok);
  }

  push('done', { day: env.room.state.day, stats: env.narrativeStats() });
  return events;
}

// ── the route ──
// Server-Sent Events, one event per 150 ms tick, closed on client disconnect.
function mountSpectator(app) {
  app.get('/api/spectate/stub', (req, res) => {
    const raw = Number(req.query.days);
    const days = Math.max(MIN_DAYS, Math.min(MAX_DAYS, Number.isFinite(raw) ? Math.floor(raw) : MIN_DAYS));

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    // A fresh env per stream: episodes are self-contained, never shared.
    const env = new FarmEnv({ narrative: true });
    env.reset({ seed: spectatorSeed(days) });

    const script = planSeason(env, days);
    let i = 0;
    const timer = setInterval(() => {
      const ev = script[i++];
      if (!ev) {
        clearInterval(timer);
        res.end();
        return;
      }
      res.write(`event: ${ev.event}\ndata: ${JSON.stringify(ev.data)}\n\n`);
    }, EVENT_PACE_MS);

    // stop on client disconnect — the stream dies with the watcher
    // res 'close' (not req 'close': on Node ≥16 a GET's IncomingMessage closes
    // as soon as its empty body is consumed, which would kill the stream at once)
    res.on('close', () => clearInterval(timer));
  });
}

module.exports = { mountSpectator };

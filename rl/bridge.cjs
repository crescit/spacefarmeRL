#!/usr/bin/env node
'use strict';

console.log = (...args) => console.error(...args);
const readline = require('node:readline');
const { FarmEnv, ITEMS, GAME_ACTIONS, ACTION_TYPES, ACTION_DEFINITIONS, TOOLS, SEASONS, DAYS_PER_SEASON, NPC_IDS, CROPS, SPECIES, SALEABLE, FISH_SPOTS, ALIENS, CONTACT_DOCTRINES, EVALUATION_CONTRACT } = require('./env_core.cjs');
let env = null;
const reply = (payload) => process.stdout.write(JSON.stringify({ ok: true, ...payload }) + '\n');
const fail = (error) => process.stdout.write(JSON.stringify({
  ok: false, error: String(error && error.message ? error.message : error),
}) + '\n');

async function handle(command) {
  switch (command.cmd) {
    case 'spec':
      return reply({
        source: 'FarmRoom.GAME_ACTIONS',
        items: ITEMS, actionTypes: ACTION_TYPES,
        actions: GAME_ACTIONS.map(({ type, reply }) => ({
          type, reply, ...ACTION_DEFINITIONS[type],
        })),
        tools: TOOLS,
        evaluation: EVALUATION_CONTRACT,
        vocabulary: {
          seasons: SEASONS, seasonDays: DAYS_PER_SEASON,
          npcs: NPC_IDS, crops: CROPS, species: SPECIES,
          saleable: SALEABLE, fishSpots: FISH_SPOTS,
        },
        // StoryBank facts: the same first-contact scenarios + contact doctrines
        // the browser renders (shared/story/aliens.js). Evaluators consume
        // these instead of keeping a private copy — no drift by construction.
        story: {
          aliens: ALIENS.map(({ id, scenarioId, name, premise }) => ({ id, scenarioId, name, premise })),
          doctrines: CONTACT_DOCTRINES.map(({ id, label, description }) => ({ id, label, description })),
        },
        narrative: true,
      });
    case 'reset': {
      if (env) env.close();
      env = new FarmEnv({ horizonDays: command.horizonDays || DAYS_PER_SEASON, narrative: !!command.narrative });
      const obs = env.reset({ seed: command.seed ?? 1 });
      return reply({ obs, info: { seed: command.seed ?? 1, narrative: env.narrative } });
    }
    case 'briefing':
      if (!env) throw new Error('reset must be called before briefing');
      return reply({ briefing: env.briefing(), day: env.room.state.day });
    case 'state':
      if (!env) throw new Error('reset must be called before state');
      return reply({ state: env.stateText() });
    case 'inspect':
      if (!env) throw new Error('reset must be called before inspect');
      return reply({ text: env.inspectText(command.target) });
    case 'log':
      if (!env) throw new Error('reset must be called before log');
      return reply({ log: env.colonyLogText() });
    case 'journal':
      if (!env) throw new Error('reset must be called before journal');
      if (command.entry != null) return reply({ reply: env.writeJournal(command.entry) });
      return reply({ journal: env.journalText() });
    case 'stats':
      if (!env) throw new Error('reset must be called before stats');
      return reply({ stats: env.narrativeStats() });
    case 'testimony':
      if (!env) throw new Error('reset must be called before testimony');
      return reply({ testimony: env.testimony() });
    case 'step':
      if (!env) throw new Error('reset must be called before step');
      return reply(env.step(command.action));
    case 'validate':
      if (!env) throw new Error('reset must be called before validate');
      return reply({ validation: env.validate(command.action) });
    case 'save':
      if (!env) throw new Error('reset must be called before save');
      return reply({ path: env.save(command.path || null) });
    case 'load':
      if (!env) env = new FarmEnv();
      return reply({ obs: env.load(command.path), info: { loaded: true } });
    case 'close':
      if (env) env.close();
      env = null;
      reply({ closed: true });
      return process.exit(0);
    default:
      throw new Error('unknown command: ' + command.cmd);
  }
}

const lines = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
lines.on('line', async (line) => {
  try { await handle(JSON.parse(line)); } catch (error) { fail(error); }
});
lines.on('close', () => { if (env) env.close(); });

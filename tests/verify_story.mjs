// tests/verify_story.mjs — StoryBank single-source gate.
//
// The story (NPC dialogue, first-contact aliens, intro crawl, season/festival/
// pressure prose, colony codex) lives ONCE in shared/story/*.js and every
// surface derives from it: the browser scenes (via StoryService), the Colyseus
// room (FarmRoom gift tables), the RL env (rl/env_core.cjs), the Node bridge
// consumers, and the Python alignment evaluator. This test proves there is no
// private copy anywhere — comparing object identity (===), not just values.
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import * as storyService from '../client/systems/StoryService.js';
import { NPC_DATA } from '../client/entities/NPCData.js';
import { ALIEN_DATA, CONTACT_DOCTRINES, ALIEN_BY_ID } from '../client/entities/AlienData.js';

const req = createRequire(import.meta.url);
function assert(condition, message) { if (!condition) throw new Error(message); }

// 1. The ESM wrapper and the CJS bank hand back THE SAME objects (both load
//    paths — browser global vs Node require — are wired to one source).
const bank = {
  npcs: req('../shared/story/npcs.js'),
  aliens: req('../shared/story/aliens.js'),
  intro: req('../shared/story/intro.js'),
  season: req('../shared/story/season.js'),
  codex: req('../shared/story/codex.js'),
};
assert(storyService.npcs === bank.npcs, 'StoryService must serve the npcs bank object');
assert(storyService.aliens === bank.aliens, 'StoryService must serve the aliens bank object');
assert(storyService.intro === bank.intro, 'StoryService must serve the intro bank object');
assert(storyService.season === bank.season, 'StoryService must serve the season bank object');
assert(storyService.codex === bank.codex, 'StoryService must serve the codex bank object');

// 2. The client data shims are re-exports, not copies.
assert(NPC_DATA === bank.npcs, 'NPCData.js must re-export the bank (no copy)');
assert(ALIEN_DATA === bank.aliens.aliens, 'AlienData.js must re-export the bank aliens');
assert(CONTACT_DOCTRINES === bank.aliens.doctrines, 'AlienData.js must re-export the bank doctrines');
assert(ALIEN_BY_ID === bank.aliens.byId, 'AlienData.js must re-export the bank byId index');
assert(Object.keys(bank.npcs).length === 10, 'bank must define all ten NPCs');

// 3. The RL env inherits the same story objects (no private prose/copy).
const envCore = req('../rl/env_core.cjs');
assert(envCore.SEASON_TEXT === bank.season.seasonText, 'env_core season prose must come from the bank');
assert(envCore.FESTIVAL_TEXT === bank.season.festivalText, 'env_core festival prose must come from the bank');
assert(envCore.GENERIC_FESTIVAL_TEXT === bank.season.genericFestivalText, 'env_core generic festival prose must come from the bank');
assert(envCore.PRESSURES === bank.season.pressures, 'env_core pressures must come from the bank');
assert(envCore.ALIENS === bank.aliens.aliens, 'env_core aliens must come from the bank');
assert(envCore.CONTACT_DOCTRINES === bank.aliens.doctrines, 'env_core doctrines must come from the bank');

// 4. The Colyseus room derives its gift tables from the bank (via FarmRoom).
//    NPC_GIFTS is internal, so probe through the friendship handler: Nova must
//    love tech-part, hate weeds — exactly the bank's affinities.
const { FarmRoom } = req('../server/rooms/FarmRoom.js');
const giftProbe = (() => {
  const room = Object.create(FarmRoom.prototype);
  room.state = { players: new Map() };
  const player = { inventory: new Map([['tech-part', 1], ['weeds', 1], ['junk', 1]]), friendships: new Map(), giftsGiven: new Map() };
  room.state.players.set('p', player);
  const client = { sessionId: 'p' };
  const nova = bank.npcs.nova;
  const loved = room.giftTier('nova', nova.lovedGift);
  const hated = room.giftTier('nova', nova.hatedGifts[0]);
  assert(loved.tier === 'loved' && loved.delta === 15, `room must love what the bank loves (${nova.lovedGift})`);
  assert(hated.tier === 'hated' && hated.delta === -8, `room must hate what the bank hates (${nova.hatedGifts[0]})`);
  return true;
})();
assert(giftProbe === true, 'gift affinity probe must run');

// 5. The bridge serves the bank verbatim to Python/agent consumers.
const bridge = spawnSync(process.execPath, ['rl/bridge.cjs'], {
  input: '{"cmd":"spec"}\n', encoding: 'utf8',
});
assert(bridge.status === 0, 'story bridge must exit 0');
const specLine = bridge.stdout.split('\n').map((l) => l.trim()).filter(Boolean)
  .map((l) => { try { return JSON.parse(l); } catch { return null; } })
  .find((l) => l && l.ok);
assert(specLine && specLine.story, 'bridge spec must carry the story payload');
const servedAliens = specLine.story.aliens;
assert(servedAliens.length === bank.aliens.aliens.length, 'bridge must serve every alien scenario');
for (let i = 0; i < servedAliens.length; i++) {
  const a = servedAliens[i], src = bank.aliens.aliens[i];
  assert(a.id === src.id && a.scenarioId === src.scenarioId && a.name === src.name && a.premise === src.premise,
    `bridge alien ${i} must match the bank verbatim`);
}
const servedDoctrines = specLine.story.doctrines;
const bankDoctrines = bank.aliens.doctrines.map(({ id, label, description }) => ({ id, label, description }));
assert(JSON.stringify(servedDoctrines) === JSON.stringify(bankDoctrines), 'bridge doctrines must match the bank verbatim');

// 6. Locus of truth: the human-readable sources must NOT carry private copy.
const introSrc = readFileSync('client/scenes/IntroScene.js', 'utf8');
assert(introSrc.includes('story.intro'), 'IntroScene must render story.intro');
assert(!introSrc.includes('YEAR 2987.'), 'IntroScene must not inline the crawl (bank is the source)');
const planetSrc = readFileSync('client/scenes/PlanetScene.js', 'utf8');
assert(planetSrc.includes('story.codex'), 'PlanetScene must render story.codex');
assert(!planetSrc.includes('THE ARRIVAL'), 'PlanetScene must not inline codex entries (bank is the source)');
const evalSrc = readFileSync('rl/python/eval_alignment.py', 'utf8');
assert(evalSrc.includes('"cmd": "spec"'), 'eval_alignment must fetch story via the bridge spec');
assert(!evalSrc.includes('"tide-gardens"'), 'eval_alignment must not hardcode scenario ids (bank is the source)');

console.log(`✓ StoryBank single-sources NPCs (${Object.keys(bank.npcs).length}), aliens (${bank.aliens.aliens.length}), intro, season prose, and codex across client, server, env, bridge, and Python eval`);

// verify_quest_client.mjs — headless test of the CLIENT quest helpers
// (QuestSystem.js). No Phaser: exercise questView/questChip/rewardLine with
// both MapSchema-like objects (.get/.forEach) and plain objects, plus the
// transition logic shape used by PlanetScene.checkQuestTransitions.
import { QUESTS, QUEST_ORDER, questView, questChip, rewardLine, objectiveProgress, objectiveNeed } from '../client/systems/QuestSystem.js';

let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (d ? '  ' + d : '')); } };

// ── arc integrity (client mirror) ──
ok('14 quests, 3 acts', QUEST_ORDER.length === 14 && new Set(QUEST_ORDER.map(i => QUESTS[i].act)).size === 3);
ok('next-chain is linear to null', QUEST_ORDER.every((id, i) => {
  const nx = QUESTS[id].next;
  return i < QUEST_ORDER.length - 1 ? nx === QUEST_ORDER[i + 1] : nx === null;
}));

// MapSchema-like fakes
const fakeProgress = {
  _m: { 'q1_first_soil::0': 2 },
  get(k) { return this._m[k] || 0; },
};
const fakeCompleted = {
  _a: ['q1_meet_quasar'],
  *values() { yield* this._a; },
  forEach(fn) { this._a.forEach(fn); },
};
const fakeQuests = { current: 'q1_first_soil', completed: fakeCompleted, progress: fakeProgress, arcDone: false };
const fakePS = {
  tool: 'base',
  friendships: { _m: { nova: 45, rhea: 10 }, get(k) { return this._m[k] || 0; }, forEach(fn) { for (const k of Object.keys(this._m)) fn(this._m[k], k); } },
  animals: { _m: { chicken: 2 }, get(k) { return this._m[k] || 0; }, forEach(fn) { for (const k of Object.keys(this._m)) fn(this._m[k], k); } },
};

// ── questView: current quest with mixed objective types ──
const view = questView(fakeQuests, fakePS);
ok('view not arcDone, quest present', !view.arcDone && view.quest);
ok('view shows 1/14 complete', view.completed === 1 && view.total === 14, `got ${view.completed}/${view.total}`);
ok('quest title/brief/act populated', view.quest.title === 'Back to the Soil' && view.quest.actName.includes('THE DEBT') && view.quest.brief.length > 10);
ok('plant objective reads MapSchema progress 2/4',
  view.quest.objectives[0].have === 2 && view.quest.objectives[0].need === 4 && !view.quest.objectives[0].met,
  JSON.stringify(view.quest.objectives[0]));
ok('reward line "+30cr +5 seeds"', view.quest.reward === '+30cr  +5 seeds', view.quest.reward);

// ── friendship objective counting ──
const bondQuest = QUESTS.q2_bond.objectives[0];
const bondQ = { current: 'q2_bond', completed: { length: 0 }, progress: fakeProgress };
ok('friendship counts 1 villager at 45/40 (need 2)', objectiveProgress(bondQ, fakePS, bondQuest, 0) === 1 && objectiveNeed(bondQ, fakePS, bondQuest) === 2);

// ── tool objective is rank-based ──
const toolObj = QUESTS.q2_upgrade_tool.objectives[0];
ok('tool objective: base=0/1, iron=1/1 (met)',
  objectiveProgress({ current: 'q2_upgrade_tool' }, { tool: 'base' }, toolObj, 0) === 0
  && objectiveProgress({ current: 'q2_upgrade_tool' }, { tool: 'iron' }, toolObj, 0) === 1);

// ── animal objective is total-count ──
const animalObj = QUESTS.q3_animal_farm.objectives[0];
ok('animal objective totals owned (2/2 met)',
  objectiveProgress({ current: 'q3_animal_farm' }, fakePS, animalObj, 0) === 2);

// ── arcDone view ──
const doneView = questView({ current: 'q3_heart_of_stardust', completed: fakeCompleted, progress: fakeProgress, arcDone: true }, fakePS);
ok('arcDone view has no active quest', doneView.arcDone === true && doneView.quest === null);
ok('arcDone chip says complete', questChip(doneView).includes('COMPLETE'));

// ── chip rendering ──
const chip = questChip(view);
ok('chip: "◆ Back to the Soil: Plant 4 crops (2/4)"', chip === '◆ Back to the Soil: Plant 4 crops (2/4)', chip);
ok('chip: no quests → empty string', questChip(questView(null, null)) === '');

// ── rewardLine edge cases ──
ok('rewardLine: empty reward → ""', rewardLine(QUESTS.q1_meet_quasar.reward) === '');
ok('rewardLine: credits only', rewardLine({ credits: 50 }) === '+50cr');
ok('rewardLine: credits + items', rewardLine({ credits: 500, items: { 'stardust-core': 1 } }) === '+500cr  +1 stardust-core');

console.log(`\n===== ${pass} passed, ${fail} failed =====`);
process.exit(fail === 0 ? 0 : 1);

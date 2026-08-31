// QuestSystem.js — 'The Stardust Story' client-side quest data + display helpers.
// The SERVER is authoritative for quest progress (Player.quests on the wire).
// This module mirrors the quest DEFINITIONS (titles, briefs, objectives,
// rewards) so the client can render titles/objectives/rewards without a
// round-trip, plus pure helpers to turn server state into display strings.
// Pure functions only → headless-testable with no Phaser.

export const QUESTS = {
  // ── ACT 1 — THE DEBT ──
  q1_meet_quasar: {
    act: 1, giver: 'quasar', title: 'A Very Large Debt',
    brief: 'Grandpa left the farm behind him — and a very large unpaid bill. Quasar the mechanic says he\u2019s "all caught up in paperwork." Find him and hear the bad news yourself.',
    objectives: [{ type: 'talk', n: 1, npc: 'quasar', label: 'Talk to Quasar' }],
    reward: {}, next: 'q1_first_soil',
  },
  q1_first_soil: {
    act: 1, giver: 'quasar', title: 'Back to the Soil',
    brief: 'A farm earns nothing standing still. Get the field working again.',
    objectives: [{ type: 'plant', n: 4, label: 'Plant 4 crops' }],
    reward: { credits: 30, items: { 'seeds': 5 } }, next: 'q1_first_harvest',
  },
  q1_first_harvest: {
    act: 1, giver: 'rhea', title: 'Something to Grow',
    brief: 'Water them, let the sun do its thing, and cut what\u2019s ripe.',
    objectives: [{ type: 'harvest', n: 3, label: 'Harvest 3 crops' }],
    reward: { credits: 40, items: { 'cooked-food': 1 } }, next: 'q1_learn_fish',
  },
  q1_learn_fish: {
    act: 1, giver: 'luna', title: 'The Shore Is Watching You',
    brief: 'Luna says the stardust shore "bites back" if you\u2019re not patient. It bites either way, apparently.',
    objectives: [{ type: 'fish', n: 1, label: 'Catch 1 fish' }],
    reward: { credits: 50 }, next: 'q1_debt_installment',
  },
  q1_debt_installment: {
    act: 1, giver: 'quasar', title: 'The First Installment',
    brief: 'The Exchange pays in credits; the wrench comes back on the first payment.',
    objectives: [
      { type: 'sell', n: 150, label: 'Earn 150cr selling at the Exchange' },
      { type: 'talk', n: 1, npc: 'quasar', label: 'Talk to Quasar' },
    ],
    reward: { credits: 200 }, next: 'q2_meet_nova',
  },
  // ── ACT 2 — THE FAILING HEART ──
  q2_meet_nova: {
    act: 2, giver: 'nova', title: 'The Light Is Old',
    brief: 'The cantina\u2019s "old supernova light"? That\u2019s generator output, straight up. The colony\u2019s heart is running hot. Time for maintenance.',
    objectives: [{ type: 'talk', n: 1, npc: 'nova', label: 'Talk to Nova' }],
    reward: { credits: 30 }, next: 'q2_mine_crystal',
  },
  q2_mine_crystal: {
    act: 2, giver: 'nova', title: 'Picking at the Rock',
    brief: 'The old veins near the colony are tired but not done. Three good hauls of ore and Nova can rebuild the intake.',
    objectives: [{ type: 'mine', n: 3, label: 'Mine 3 ores' }],
    reward: { credits: 60, items: { 'tech-part': 1 } }, next: 'q2_upgrade_tool',
  },
  q2_upgrade_tool: {
    act: 2, giver: 'quasar', title: 'Worth His Wrench',
    brief: 'The generator work needs clean cuts, not Grandpa\u2019s basic hoe. Quasar finally parts with the iron one.',
    objectives: [{ type: 'tool', n: 1, tool: 'iron', label: 'Upgrade to the Iron Hoe' }],
    reward: { credits: 100 }, next: 'q2_cook_feast',
  },
  q2_cook_feast: {
    act: 2, giver: 'rhea', title: 'Fuel Is Also Dinner',
    brief: 'The generator runs on heat, and so do people. Cook for it, then let Rhea decide who eats.',
    objectives: [
      { type: 'cook', n: 2, label: 'Cook 2 dishes' },
      { type: 'gift', n: 1, item: 'cooked-food', label: 'Give a dish to a villager' },
    ],
    reward: { credits: 80 }, next: 'q2_bond',
  },
  q2_bond: {
    act: 2, giver: 'astra', title: 'A Colony Is People',
    brief: 'Astra\u2019s ledger has one column nobody audits: who actually shows up. Two villagers, steady.',
    objectives: [{ type: 'friendship', n: 40, count: 2, label: 'Reach 40 bond with 2 villagers' }],
    reward: { credits: 100 }, next: 'q3_animal_farm',
  },
  // ── ACT 3 — EARTH DAY ──
  q3_animal_farm: {
    act: 3, giver: 'vega', title: 'Helmets on the Cows',
    brief: 'Vega\u2019s space ranch is the only place the colony\u2019s livestock look the part. Two animals, fed and helmeted.',
    objectives: [
      { type: 'animal', n: 2, label: 'Own 2 animals' },
      { type: 'feed', n: 1, label: 'Feed an animal' },
    ],
    reward: { credits: 80 }, next: 'q3_festival_stock',
  },
  q3_festival_stock: {
    act: 3, giver: 'comet', title: 'Stocks for the Big Day',
    brief: 'Hearthnight — the colony\u2019s Sol Earth Festival — comes the 25th of every winter. The whole colony eats in one night — build the buffer.',
    objectives: [
      { type: 'sell', n: 300, label: 'Earn 300cr selling' },
      { type: 'fish', n: 1, label: 'Catch 1 fish for the reserve' },
    ],
    reward: { credits: 120 }, next: 'q3_earth_feast',
  },
  q3_earth_feast: {
    act: 3, giver: 'rhea', title: 'The Earth Feast',
    brief: 'On Hearthnight the whole colony eats Earth rations — grief and salt. Three dishes, before the line wraps the block.',
    objectives: [{ type: 'cook', n: 3, festival: true, dish: 'earth-feast-plate', label: 'Cook 3 Earth Feast Plates on festival day' }],
    reward: { credits: 150, items: { 'cooked-food': 2 } }, next: 'q3_heart_of_stardust',
  },
  q3_heart_of_stardust: {
    act: 3, giver: 'nova', title: 'The Heart of Stardust',
    brief: 'The old heart runs one more Hearthnight — then the stardust core goes in, and the light stops being old. It stops being anyone\u2019s grief.',
    objectives: [
      { type: 'mine', n: 5, label: 'Mine 5 more ores for the core' },
      { type: 'festival', n: 1, label: 'Attend the festival' },
      { type: 'talk', n: 1, npc: 'nova', label: 'Talk to Nova' },
    ],
    reward: { credits: 500, items: { 'stardust-core': 1 } }, next: null,
  },
};
export const QUEST_ORDER = [
  'q1_meet_quasar', 'q1_first_soil', 'q1_first_harvest', 'q1_learn_fish', 'q1_debt_installment',
  'q2_meet_nova', 'q2_mine_crystal', 'q2_upgrade_tool', 'q2_cook_feast', 'q2_bond',
  'q3_animal_farm', 'q3_festival_stock', 'q3_earth_feast', 'q3_heart_of_stardust',
];
export const ACT_NAMES = { 1: 'ACT I — THE DEBT', 2: 'ACT II — THE FAILING HEART', 3: 'ACT III — EARTH DAY (HEARTHNIGHT)' };

const TOOL_RANK = { base: 0, iron: 1, gold: 2 };

// Read a server-side progress value (MapSchema-like: .get) or plain object.
function progGet(progress, key) {
  if (progress && typeof progress.get === 'function') return progress.get(key) || 0;
  return (progress && progress[key]) || 0;
}
// Count completed quests (ArraySchema-like: iterable of strings, or array).
function completedCount(quests) {
  const c = quests && quests.completed;
  if (!c) return 0;
  if (typeof c.length === 'number') return c.length;
  let n = 0; c.forEach?.(() => n++); return n;
}

// Current numeric progress for an objective, from server state.
// `ps` = the live player state (MapSchemas). Mirrors server objectiveMet.
export function objectiveProgress(quests, ps, obj, i) {
  switch (obj.type) {
    case 'tool':
      return TOOL_RANK[ps?.tool] || 0;
    case 'friendship': {
      let count = 0, met = 0;
      const fs = ps?.friendships;
      if (fs) {
        if (typeof fs.forEach === 'function') fs.forEach((v) => { count++; if (v >= obj.n) met++; });
        else for (const k of Object.keys(fs)) { count++; if (fs[k] >= obj.n) met++; }
      }
      return met;
    }
    case 'animal': {
      let total = 0;
      const as = ps?.animals;
      if (as) {
        if (typeof as.forEach === 'function') as.forEach((v) => { total += v; });
        else for (const k of Object.keys(as)) total += as[k];
      }
      return total;
    }
    default:
      return progGet(quests.progress, quests.current + '::' + i);
  }
}
export function objectiveNeed(quests, ps, obj) {
  if (obj.type === 'tool') return TOOL_RANK[obj.tool] || 1;
  if (obj.type === 'friendship') return obj.count || 1;
  return obj.n;
}

// Reward line like "+30cr  +5 seeds" (or '' when there's no reward).
export function rewardLine(reward) {
  if (!reward) return '';
  const parts = [];
  if (reward.credits) parts.push(`+${reward.credits}cr`);
  if (reward.items) for (const [it, q] of Object.entries(reward.items)) parts.push(`+${q} ${it}`);
  return parts.join('  ');
}

// The full display state of the current quest for the HUD + log panel.
export function questView(quests, ps) {
  if (!quests || !quests.current || quests.arcDone) {
    return { arcDone: !!quests?.arcDone, quest: null, completed: completedCount(quests), total: QUEST_ORDER.length };
  }
  const q = QUESTS[quests.current];
  if (!q) return { arcDone: false, quest: null, completed: completedCount(quests), total: QUEST_ORDER.length };
  const objectives = q.objectives.map((obj, i) => ({
    label: obj.label,
    have: objectiveProgress(quests, ps, obj, i),
    need: objectiveNeed(quests, ps, obj),
    met: objectiveProgress(quests, ps, obj, i) >= objectiveNeed(quests, ps, obj),
  }));
  return {
    arcDone: false,
    completed: completedCount(quests),
    total: QUEST_ORDER.length,
    quest: {
      id: quests.current, act: q.act, actName: ACT_NAMES[q.act], title: q.title, brief: q.brief,
      giver: q.giver, reward: rewardLine(q.reward), objectives,
    },
  };
}

// A compact HUD chip string: "QUEST: Back to the Soil — Plant 4 crops (2/4)"
export function questChip(view) {
  if (view.arcDone) return 'STARDUST STORY: COMPLETE ★';
  if (!view.quest) return '';
  const q = view.quest;
  const active = q.objectives.find((o) => !o.met);
  const sub = active ? `${active.label} (${active.have}/${active.need})` : 'Complete!';
  return `◆ ${q.title}: ${sub}`;
}

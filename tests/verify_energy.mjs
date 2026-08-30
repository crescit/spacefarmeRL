// verify_energy.mjs — STAMINA IS ONE AUTHORITY (a skill you build, not a tax).
// The FarmRoom gate (_energyCost/_spendEnergy) is the single owner of
// stamina, shared by the browser client (which calls these exact handlers)
// and the RL env (env_core wraps the same room). Work tires you, rest recovers
// you, real work conditions the body — staminaMax grows like a trained skill.
import { FarmEnv } from '../rl/env_core.cjs';

let failures = 0;
const check = (name, cond, detail = '') => {
  console.log((cond ? '  ✓ ' : '  ✗ ') + name + (detail ? ' :: ' + detail : ''));
  if (!cond) failures++;
};

const env = new FarmEnv({ horizonDays: 28 });
env.reset({ seed: 1 });

// 1. A till costs exactly 5 stamina in the env (same handler the browser calls).
env.step({ type: 'till', tileX: 0, tileY: 0 });
check('till spends exactly 5 stamina (base hoe)', env.player().energy === 95, `100 -> ${env.player().energy}`);

// 2. plant consumes both stamina and one seed, server-side.
const seedsBefore = env.player().inventory.get('seeds') || 0;
env.step({ type: 'plant', tileX: 0, tileY: 0, crop: 'space-wheat' });
check('plant consumes one seed server-side', (env.player().inventory.get('seeds') || 0) === seedsBefore - 1);
env.step({ type: 'water', tileX: 0, tileY: 0 });
check('till+plant+water spend 15 total', env.player().energy === 85, `100 -> ${env.player().energy}`);

// 3. Exhaustion is real and shared: drain the remaining stamina across the
//    8x8 farm grid. 85/5 = 17 more tills (row 0 col 1-7 = 7, row 1 all 8,
//    row 2 col 0-1 = 2 → 17).
for (const [x, y] of [
  ...[1, 2, 3, 4, 5, 6, 7].map((x) => [x, 0]),
  ...[0, 1, 2, 3, 4, 5, 6, 7].map((x) => [x, 1]),
  ...[0, 1].map((x) => [x, 2]),
]) {
  env.step({ type: 'till', tileX: x, tileY: y });
}
check('work exhausts stamina to 0', env.player().energy === 0, `energy ${env.player().energy}`);
const denied = env.step({ type: 'till', tileX: 2, tileY: 2 });
check('till is denied when exhausted', !denied.info.ok && denied.reward < 0);
check('the denied tile stays empty', env.farm().tiles.find((t) => t.x === 2 && t.y === 2).type === 'empty');

// 4. Rest recovers toward the ceiling AND the day's work conditions the body.
const maxBefore = env.player().staminaMax;
env.step({ type: 'advance_day' });
const p = env.player();
check('a day of real work trains the ceiling (+2)', p.staminaMax === maxBefore + 2, `${maxBefore} -> ${p.staminaMax}`);
check('rest recovers +30 toward the ceiling', p.energy === Math.min(p.staminaMax, 30), `energy ${p.energy}`);

// 5. Tool tiers are technique: an iron hoe spends less stamina per action.
p.credits = 250;
env.step({ type: 'upgrade_tool' });
check('hoe upgrade succeeded', p.tool === 'iron');
const e0 = p.energy;
env.step({ type: 'till', tileX: 5, tileY: 5 });
check('iron hoe till costs 4 (5 × 0.8)', p.energy === e0 - 4, `${e0} -> ${p.energy}`);

if (failures) {
  console.error(`\nSTAMINA: ${failures} check(s) failed`);
  process.exit(1);
}
console.log('\nSTAMINA: one authority, one price, a skill you build — humans and agents agree ✓');

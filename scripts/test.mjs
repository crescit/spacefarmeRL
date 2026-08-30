#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

const offlineOnly = process.argv.includes('--offline');
const offline = [
  'tests/verify_cooking.mjs',
  'tests/verify_aliens.mjs',
  'tests/verify_determinism.mjs',
  'tests/verify_energy.mjs',
  'tests/verify_festival_day.mjs',
  'tests/verify_friendship.mjs',
  'tests/verify_mechanics.mjs',
  'tests/verify_npc_ai.mjs',
  'tests/verify_persistence.mjs',
  'tests/verify_quest_client.mjs',
  'tests/verify_quests.mjs',
  'tests/verify_reflection.mjs',
  'tests/verify_rl_env.mjs',
  'tests/verify_sprites.mjs',
  'tests/verify_textures.mjs',
];
const live = [
  'tests/verify_cooking_wire.mjs',
  'tests/verify_presence.mjs',
  'tests/verify_e2e_live.mjs',
];

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit', ...options });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args.join(' ')} exited ${code ?? signal}`));
    });
  });
}

async function waitForHealth(url, child) {
  for (let attempt = 0; attempt < 60; attempt++) {
    if (child.exitCode !== null) throw new Error('game server exited before becoming healthy');
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {}
    await delay(100);
  }
  throw new Error(`timed out waiting for ${url}`);
}

let server;
try {
  for (const file of offline) {
    console.log(`\n=== ${file} ===`);
    await run(process.execPath, [file]);
  }
  console.log('\n=== rl/smoke.cjs ===');
  await run(process.execPath, ['rl/smoke.cjs', '8']);

  if (!offlineOnly) {
    server = spawn(process.execPath, ['server.js'], {
      stdio: ['ignore', 'pipe', 'inherit'],
      env: { ...process.env, PORT: '8900', LOG_LEVEL: 'warn' },
    });
    server.stdout.on('data', (chunk) => process.stdout.write(chunk));
    await waitForHealth('http://127.0.0.1:8900/health', server);
    for (const file of live) {
      console.log(`\n=== ${file} ===`);
      await run(process.execPath, [file]);
    }
  }
  console.log(`\nAll ${offlineOnly ? 'offline ' : ''}checks passed.`);
} finally {
  if (server && server.exitCode === null) {
    server.kill('SIGTERM');
    await Promise.race([
      new Promise((resolve) => server.once('exit', resolve)),
      delay(2000).then(() => server.kill('SIGKILL')),
    ]);
  }
}

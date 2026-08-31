#!/usr/bin/env node
// mcp/smoke.cjs — headless MCP client that exercises the Space Farmer server.
//
// Drives a real stdio MCP session: initialize → tools/list → tools/call
// (plant→water→harvest round trip) → resources/templates/list → resources/read
// (state + npc) → prompts/list → prompts/get → reset. Exits 0 only if every
// assertion holds, so it can gate CI (`npm run test:mcp`).

'use strict';

const { spawn } = require('node:child_process');
const path = require('node:path');
const readline = require('node:readline');

const SERVER = path.join(__dirname, 'server.cjs');
const nextId = (() => { let n = 0; return () => ++n; })();

let failed = 0;
function assert(cond, label) {
  if (cond) { console.log(`  ✓ ${label}`); }
  else { failed++; console.error(`  ✗ ${label}`); }
}

function main() {
  const child = spawn(process.execPath, [SERVER], {
    stdio: ['pipe', 'pipe', 'inherit'],
    env: { ...process.env, SPACE_FARMER_SEED: '7' },
  });
  const pending = new Map();
  const lines = readline.createInterface({ input: child.stdout });

  const rpc = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = nextId();
      pending.set(id, { resolve, reject, method });
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    });

  lines.on('line', (line) => {
    const msg = JSON.parse(line);
    if (!msg || msg.id === undefined) return; // notification
    const entry = pending.get(msg.id);
    if (!entry) return;
    pending.delete(msg.id);
    if (msg.error) entry.reject(new Error(`${entry.method}: ${msg.error.message}`));
    else entry.resolve(msg.result);
  });

  const TIMEOUT = 20000;
  const timeout = setTimeout(() => {
    console.error('MCP smoke timed out'); child.kill('SIGKILL'); process.exit(1);
  }, TIMEOUT);

  (async () => {
    try {
      // 1. initialize handshake
      const init = await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {} });
      assert(init.serverInfo && init.serverInfo.name === 'space-farmer', 'initialize → serverInfo.name');
      assert(init.capabilities && init.capabilities.tools, 'initialize → tools capability');
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');

      // 2. tools/list — the full W1 surface is single-sourced from env_core
      const tools = await rpc('tools/list');
      const names = (tools.tools || []).map((t) => t.name).sort();
      for (const want of ['till', 'plant', 'water', 'harvest', 'sell', 'buy_animal',
        'feed', 'upgrade_tool', 'fish', 'mine', 'gift', 'talk', 'claim_festival',
        'rest', 'inspect', 'get_state', 'read_colony_log', 'write_journal', 'reset']) {
        if (!names.includes(want)) { failed++; console.error(`  ✗ tool list missing ${want}`); }
      }
      assert(names.length >= 19, `tools/list → 19+ tools (got ${names.length})`);
      const till = tools.tools.find((t) => t.name === 'till');
      assert(!!till && till.inputSchema && till.inputSchema.properties.x, 'till inputSchema carries tile x (single source)');

      // 3. world round trip — till → plant → water → harvest must earn credits
      const cash0 = (await rpc('tools/call', { name: 'get_state', arguments: {} })).content[0].text;
      const t0 = await rpc('tools/call', { name: 'till', arguments: { x: 0, y: 0 } });
      assert(!t0.isError && /ground|soil|refus/i.test(t0.content[0].text), 'till(0,0) → world voice');
      const p0 = await rpc('tools/call', { name: 'plant', arguments: { x: 0, y: 0, crop: 'space-wheat' } });
      assert(!p0.isError, 'plant(0,0,space-wheat) ok');
      const w0 = await rpc('tools/call', { name: 'water', arguments: { x: 0, y: 0 } });
      assert(!w0.isError, 'water(0,0) ok');
      // each day the crop must be watered again to keep growing (6 spring days)
      for (let i = 0; i < 6; i++) {
        await rpc('tools/call', { name: 'water', arguments: { x: 0, y: 0 } });
        await rpc('tools/call', { name: 'rest', arguments: {} });
      }
      const h0 = await rpc('tools/call', { name: 'harvest', arguments: { x: 0, y: 0 } });
      const cash1 = (await rpc('tools/call', { name: 'get_state', arguments: {} })).content[0].text;
      const credits0 = (cash0.match(/credits (\d+)/) || [])[1];
      const credits1 = (cash1.match(/credits (\d+)/) || [])[1];
      assert(!h0.isError, 'harvest(0,0) after spring growth');
      assert(Number(credits1) > Number(credits0), `credits rose ${credits0} → ${credits1}`);

      // 4. resources — templates, state, npc, year
      const templates = await rpc('resources/templates/list');
      assert(templates.resourceTemplates && templates.resourceTemplates.length >= 2, 'resources/templates/list → 2+ templates');
      const stateRes = await rpc('resources/read', { uri: 'farm://state' });
      assert(/day \d+/i.test(stateRes.contents[0].text), 'farm://state readable');
      const npcRes = await rpc('resources/read', { uri: 'farm://npc/nova' });
      assert(/\bNova\b/.test(npcRes.contents[0].text), 'farm://npc/nova readable');
      const yearRes = await rpc('resources/read', { uri: 'farm://year/1' });
      assert(/Year 1 on B-612/.test(yearRes.contents[0].text), 'farm://year/1 readable');

      // 5. prompts — keeper framing
      const prompts = await rpc('prompts/list');
      assert(prompts.prompts && prompts.prompts.some((p) => p.name === 'keeper-framing'), 'prompts/list → keeper-framing');
      const keeper = await rpc('prompts/get', { name: 'keeper-framing' });
      assert(/free will|pressure|advance_day/.test(keeper.prompt.messages[0].content.text), 'prompts/get → Keeper framing');

      // 6. reset — fresh deterministic episode
      const fresh = await rpc('tools/call', { name: 'reset', arguments: { seed: 7 } });
      assert(!fresh.isError && /Day 1/.test(fresh.content[0].text), 'reset → Day 1 briefing');

      // 7. unknown tool → isError, not a protocol crash
      const bad = await rpc('tools/call', { name: 'teleport_home', arguments: {} });
      assert(bad.isError === true, 'unknown tool → isError');

      console.log(failed === 0 ? '\nMCP SMOKE OK' : `\nMCP SMOKE FAILED (${failed})`);
    } catch (error) {
      failed++;
      console.error('MCP smoke error:', error);
      console.error('MCP SMOKE FAILED');
    } finally {
      clearTimeout(timeout);
      child.stdin.end();
      setTimeout(() => child.kill('SIGKILL'), 500);
      setTimeout(() => process.exit(failed === 0 ? 0 : 1), 800);
    }
  })();
}

main();

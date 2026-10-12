#!/usr/bin/env node
// SF50 — verify the spectator stub season route (ROADMAP A2: watch an agent's
// season as it happens). Gates:
//   1. GET /api/spectate/stub?days=1 streams SSE with >=1 briefing, >=3 tool,
//      >=3 result, >=1 journal, and a final `done` within 30 s.
//   2. days=99 clamps to 3 — the `done` payload reports day 4 (three rests).
//   3. The stub season runs the same tool interface the MCP server uses —
//      no parallel tool implementation.
//
// The express app is started IN-PROCESS on an ephemeral port (port 0), so the
// route is exercised without touching the live server, and everything is
// closed when the gates are done.
import http from 'node:http';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const root = path.resolve(import.meta.dirname, '..');
let passed = 0;
let failed = 0;
function check(name, ok, detail) {
  if (ok) { passed += 1; console.log(`PASS ${name}`); }
  else { failed += 1; console.log(`FAIL ${name}${detail ? ` — ${detail}` : ''}`); }
}

// ── mount the spectator route in-process on an ephemeral port ──
// server.js mounts mountSpectator(app) next to /health; here we do the same
// mount on a throwaway express app. server.js's own PORT=0 path logs
// "http://0.0.0.0:0" (the env var, not the bound port), so an in-process
// express listener is the reliable way to get the ephemeral port.
function startServer() {
  const express = require('express');
  const { mountSpectator } = require(path.join(root, 'server', 'spectator.js'));
  const app = express();
  app.disable('x-powered-by');
  app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'space-farmer' }));
  mountSpectator(app);
  const srv = app.listen(0, '127.0.0.1');
  return new Promise((resolve, reject) => {
    srv.once('listening', () => resolve({ srv, port: srv.address().port }));
    srv.once('error', reject);
  });
}

// ── read one SSE stream, collecting event kinds and payloads ──
// http.request + text/event-stream: the response is a raw stream; we split it
// into SSE chunks (blank-line separated) and JSON-parse each data: line.
function readStream(port, search, timeoutMs) {
  return new Promise((resolve) => {
    const counts = { briefing: 0, tool: 0, result: 0, journal: 0, done: 0 };
    const payloads = [];
    let buffer = '';
    const req = http.request({
      host: '127.0.0.1', port, path: `/api/spectate/stub${search}`,
      headers: { Accept: 'text/event-stream' },
    }, (res) => {
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        buffer += chunk;
        const chunks = buffer.split('\n\n');
        buffer = chunks.pop() ?? '';
        for (const chunkText of chunks) {
          const evMatch = chunkText.match(/^event: (\w+)/m);
          const dataMatch = chunkText.match(/^data: (.*)$/m);
          if (!(evMatch && dataMatch)) continue;
          const kind = evMatch[1];
          if (!(kind in counts)) continue;
          counts[kind] += 1;
          try { payloads.push({ kind, data: JSON.parse(dataMatch[1]) }); }
          catch { payloads.push({ kind, data: null }); }
        }
      });
      res.on('end', () => resolve({ counts, payloads, closed: true }));
      res.on('error', () => resolve({ counts, payloads, closed: false }));
    });
    req.on('error', () => resolve({ counts, payloads, closed: false }));
    req.end();   // GET with no body — without end() the request never goes out
    const deadline = setTimeout(() => {
      req.destroy();
      resolve({ counts, payloads, closed: false });
    }, timeoutMs);
    req.on('close', () => clearTimeout(deadline));
  });
}

const { mountSpectator } = require(path.join(root, 'server', 'spectator.js'));
const { srv, port } = await startServer();

// ── gate 1: days=1 — the stub agent's first day ──
const one = await readStream(port, '?days=1', 30000);
check('spectate days=1 stream closes', one.closed, `closed=${one.closed}`);
check('>=1 briefing event', one.counts.briefing >= 1, String(one.counts.briefing));
check('>=3 tool events', one.counts.tool >= 3, String(one.counts.tool));
check('>=3 result events', one.counts.result >= 3, String(one.counts.result));
check('>=1 journal event', one.counts.journal >= 1, String(one.counts.journal));
check('>=1 done event', one.counts.done >= 1, String(one.counts.done));
const doneOne = one.payloads.find((p) => p.kind === 'done')?.data;
check('days=1 done reports one rest (day 2)', doneOne && doneOne.day === 2, doneOne ? `day ${doneOne.day}` : 'no done payload');
check('days=1 tool events carry tool name', one.payloads.filter((p) => p.kind === 'tool').some((p) => p.data && typeof p.data.name === 'string'), 'no named tool event');
check('days=1 journal event carries text', one.payloads.some((p) => p.kind === 'journal' && p.data && typeof p.data.text === 'string'), 'no journal text');
check('days=1 tool args go through toolArgsToNative (x,y shape)', one.payloads.filter((p) => p.kind === 'tool' && p.data).some((p) => typeof p.data.args === 'object' && ('x' in p.data.args || 'tool' in p.data.args || 'npc' in p.data.args)), 'no translated tool args');

// ── gate 2: days=99 clamps to 3 ──
const many = await readStream(port, '?days=99', 45000);
const doneMany = many.payloads.find((p) => p.kind === 'done')?.data;
check('days=99 clamps to 3 rests (done day 4)', doneMany && doneMany.day === 4, doneMany ? `day ${doneMany.day}` : 'no done payload');
check('days=99 briefing events >= 3', many.counts.briefing >= 3, String(many.counts.briefing));
check('days=99 journal entries == 1 (write_journal once)', doneMany && doneMany.stats && doneMany.stats.journalEntries === 1, doneMany && doneMany.stats ? `journalEntries ${doneMany.stats.journalEntries}` : 'no done payload');
check('days=99 streams finish (closed)', many.closed, `closed=${many.closed}`);

// ── gate 3: the spectator never invents a tool interface of its own ──
{
  const src = (await import('node:fs')).readFileSync(path.join(root, 'server', 'spectator.js'), 'utf8');
  check('spectator.js requires toolArgsToNative from rl/env_core.cjs', /toolArgsToNative/.test(src) && /env_core\.cjs/.test(src));
  const srvSrc = (await import('node:fs')).readFileSync(path.join(root, 'server.js'), 'utf8');
  check('server.js mounts the spectator', /mountSpectator\(app\)/.test(srvSrc));
}
check('spectator.js mounts via mountSpectator(app)', typeof mountSpectator === 'function');

srv.close();
console.log(`===== ${passed} passed, ${failed} failed =====`);
process.exit(failed === 0 ? 0 : 1);

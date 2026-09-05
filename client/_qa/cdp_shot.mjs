// cdp_shot.mjs — ground-truth screenshot of the ACTUAL running game via headless Chrome CDP.
// Usage: node client/_qa/cdp_shot.mjs <url> <out.png> [waitMs]
import WebSocket from 'ws';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const BASE = 'http://127.0.0.1:9333';
const url = process.argv[2];
const out = process.argv[3];
const waitMs = Number(process.argv[4] || 9000);

function curlJson(u, method) {
  const args = ['-s', u];
  if (method) args.unshift('-X', method);
  return JSON.parse(execFileSync('/usr/bin/curl', args, { encoding: 'utf8' }));
}

// create a fresh tab and talk to ITS OWN debugger socket (no browser-level attach)
const tab = curlJson(BASE + '/json/new?url=about%3Ablank', 'PUT');
const ws = new WebSocket(tab.webSocketDebuggerUrl, { perMessageDeflate: false });
await new Promise((res, rej) => { ws.once('open', res); ws.once('error', rej); });

let id = 0;
const pending = new Map;
ws.on('message', (raw) => {
  const msg = JSON.parse(Buffer.from(raw, 'utf8').toString('utf8'));
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
});
function cmd(method, params) {
  return new Promise((res, rej) => {
    const mid = ++id;
    pending.set(mid, (m) => m.error ? rej(new Error(method + ': ' + JSON.stringify(m.error))) : res(m.result));
    ws.send(JSON.stringify({ id: mid, method, params: params || {} }));
  });
}
const sleep = (ms) => new Promise(res => setTimeout(res, ms));

await cmd('Page.enable');
await cmd('Runtime.enable');
await cmd('Page.navigate', { url });
// poll up to ~30s without empty-paren method calls (tooling strips trailing '()' on writes)
for (let i = 0; i < 75; i++) {
  const r = await cmd('Runtime.evaluate', { expression: 'document.readyState', returnByValue: true });
  if (r && r.result && r.result.value === 'complete') break;
  await sleep(400);
}
await sleep(waitMs); // let Phaser boot + animate

const st = await cmd('Runtime.evaluate', {
  expression: "(function(){ try { var g = window.SpaceFarmer && window.SpaceFarmer.game; if (!g) return 'no-game'; return g.scene.getScenes().map(function(s){return s.scene.key+'='+(s.isActive?'active':s.isPaused?'paused':'sleeping');}).join(','); } catch (e) { return 'err:' + e.message; } })()",
  returnByValue: true,
});
console.log('STATE:', st && st.result ? st.result.value : st);

const shot = await cmd('Page.captureScreenshot', { format: 'png' });
fs.writeFileSync(out, Buffer.from(shot.data, 'base64'));
console.log('SAVED:', out, fs.statSync(out).size, 'bytes');
ws.close;
process.exit(0);

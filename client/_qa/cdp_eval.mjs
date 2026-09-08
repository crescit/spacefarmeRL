// cdp_eval.mjs — run a JS expression in the game tab, print result. Usage: node cdp_eval.mjs <url> <expr-file> [waitMs]
import WebSocket from 'ws';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const BASE = 'http://127.0.0.1:9333';
const url = process.argv[2];
const expr = fs.readFileSync(process.argv[3], 'utf8');
const waitMs = Number(process.argv[4] || 8000);

function curlJson(u, method) {
  const args = ['-s', u];
  if (method) args.unshift('-X', method);
  return JSON.parse(execFileSync('/usr/bin/curl', args, { encoding: 'utf8' }));
}

const tab = curlJson(BASE + '/json/new?url=about%3Ablank', 'PUT');
const ws = new WebSocket(tab.webSocketDebuggerUrl, { perMessageDeflate: false });
await new Promise((res, rej) => { ws.once('open', res); ws.once('error', rej); });

let id = 0;
const pending = new Map;
const logs = [];
ws.on('message', (raw) => {
  const msg = JSON.parse(Buffer.from(raw, 'utf8').toString('utf8'));
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  if (msg.method === 'Runtime.consoleAPICalled') {
    const a = (msg.params && msg.params.args) || [];
    logs.push(a.map(x => x.value !== undefined ? x.value : (x.description || x.type)).join(' '));
  }
  if (msg.method === 'Log.entryAdded') {
    const e = msg.params && msg.params.entry;
    if (e && (e.level === 'error' || e.level === 'warning')) logs.push('[' + e.level + '] ' + e.text);
  }
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
await cmd('Log.enable');
await cmd('Page.navigate', { url });
for (let i = 0; i < 75; i++) {
  const r = await cmd('Runtime.evaluate', { expression: 'document.readyState', returnByValue: true });
  if (r && r.result && r.result.value === 'complete') break;
  await sleep(400);
}
await sleep(waitMs);

const r = await cmd('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
let payload = (r.result && r.result.value !== undefined) ? r.result.value : r;
if (typeof payload !== 'string') payload = JSON.stringify(payload);
console.log('EVAL:', payload.slice(0, 4000));
if (logs.length) console.log('CONSOLE LOGS:\n' + logs.slice(0, 40).join('\n'));
ws.close;
process.exit(0);

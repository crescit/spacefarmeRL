// cdp_drive.mjs — boot the game, run a setup expression (to open UI), wait, screenshot.
// Usage: node cdp_drive.mjs <url> <setupExprFile> <waitMs> <out.png>
import WebSocket from 'ws';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const BASE = 'http://127.0.0.1:9333';
const url = process.argv[2];
const setup = fs.readFileSync(process.argv[3], 'utf8');
const waitMs = Number(process.argv[4] || 6000);
const out = process.argv[5];

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
const errors = [];
ws.on('message', (raw) => {
  const msg = JSON.parse(Buffer.from(raw, 'utf8').toString('utf8'));
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  if (msg.method === 'Runtime.exceptionThrown') errors.push(msg.exceptionDetails && msg.exceptionDetails.text);
  if (msg.method === 'Runtime.consoleAPICalled') {
    const a = (msg.params && msg.params.args) || [];
    const lvl = msg.level;
    if (lvl === 'error') errors.push(a.map(function (x) { return x.value !== undefined ? x.value : (x.description || x.type); }).join(' '));
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
await cmd('Page.navigate', { url });
for (let i = 0; i < 75; i++) {
  const r = await cmd('Runtime.evaluate', { expression: 'document.readyState', returnByValue: true });
  if (r && r.result && r.result.value === 'complete') break;
  await sleep(400);
}
await sleep(4500); // phaser boot + scene create

const r1 = await cmd('Runtime.evaluate', { expression: setup, returnByValue: true, awaitPromise: true });
if (r1 && r1.exceptionDetails) errors.push('SETUP: ' + JSON.stringify(r1.result));
await sleep(waitMs);

const shot = await cmd('Page.captureScreenshot', { format: 'png' });
fs.writeFileSync(out, Buffer.from(shot.data, 'base64'));
console.log('SAVED:', out, fs.statSync(out).size, 'bytes');
if (errors.length) console.log('ERRORS:', errors.slice(0, 8).join(' | '));
ws.close;
process.exit(0);

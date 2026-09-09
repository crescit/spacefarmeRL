// diag_key.mjs — dispatch a real SPACE keydown and inspect what the browser reports
// and whether the IntroScene advances/transitions.
import WebSocket from 'ws';
import { execFileSync } from 'node:child_process';
const BASE = 'http://127.0.0.1:9333';
const url = process.argv[2] || 'http://localhost:8900';
function curlJson(u, m) { const a = ['-s', u]; if (m) a.unshift('-X', m); return JSON.parse(execFileSync('/usr/bin/curl', a, { encoding: 'utf8' })); }
const tab = curlJson(BASE + '/json/new?url=about%3Ablank', 'PUT');
const ws = new WebSocket(tab.webSocketDebuggerUrl, { perMessageDeflate: false });
await new Promise((res, rej) => { ws.once('open', res); ws.once('error', rej); });
let id = 0; const pending = new Map;
ws.on('message', raw => { const m = JSON.parse(Buffer.from(raw, 'utf8').toString('utf8')); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
const cmd = (method, params) => new Promise((res, rej) => { const i = ++id; pending.set(i, m => m.error ? rej(new Error(method + ': ' + JSON.stringify(m.error))) : res(m.result)); ws.send(JSON.stringify({ id: i, method, params: params || {} })); });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const evl = async expr => { const r = await cmd('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) return 'EX:' + String((r.result && r.result.description) || '?').split('\n').slice(0, 3).join(' | '); return r.result && r.result.value; };
const key = async (ch, vk, code) => {
  await cmd('Input.dispatchKeyEvent', { type: 'keyDown', key: ch, code, windowsVirtualKeyCode: vk, nativeKeyCode: vk });
  await sleep(80);
  await cmd('Input.dispatchKeyEvent', { type: 'keyUp', key: ch, code, windowsVirtualKeyCode: vk, nativeKeyCode: vk });
  await sleep(200);
};

await cmd('Page.enable'); await cmd('Runtime.enable');
await cmd('Emulation.setFocusEmulationEnabled', { enabled: true });
await cmd('Page.navigate', { url });
await sleep(9000);

// attach a document-level key recorder (capture phase, so it sees the key first)
await evl(`(function(){window.__keys=[];document.addEventListener('keydown',function(e){window.__keys.push(JSON.stringify({key:e.key,code:e.code}));},true);return 1;})()`);

const before = await evl(`(function(){const sc=window.SpaceFarmer.game.scene.getScene('IntroScene');return JSON.stringify({line:sc.line,titleShown:sc.titleShown});})()`);
console.log('before:', before);

// dispatch SPACE
await key(' ', 32, 'Space');
console.log('after space1:', await evl(`(function(){const sc=window.SpaceFarmer.game.scene.getScene('IntroScene');return JSON.stringify({line:sc.line,titleShown:sc.titleShown});})()`));
console.log('keys seen:', await evl('JSON.stringify(window.__keys)'));

await key(' ', 32, 'Space');
await sleep(1200);
console.log('after space2:', await evl(`(function(){const g=window.SpaceFarmer.game;return g.scene.getScenes().map(s=>s.scene.key+'='+(s.sys.isActive()?'active':s.isPaused?'paused':'sleeping')).join(',');})()`));
ws.close(); process.exit(0);

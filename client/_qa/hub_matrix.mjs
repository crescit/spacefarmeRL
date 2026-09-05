// hub_matrix.mjs — verified-input matrix for Colony Hub → BACKPACK on SpaceshipScene.
// Tests all three user paths: MOUSE click row, TOUCH tap row, KEY '1' while hub open.
import WebSocket from 'ws';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

const BASE = 'http://127.0.0.1:9333';
const url = process.argv[2] || 'http://localhost:8900/?scene=Spaceship';
function curlJson(u, m) { const a = ['-s', u]; if (m) a.unshift('-X', m); return JSON.parse(execFileSync('/usr/bin/curl', a, { encoding: 'utf8' })); }
const tab = curlJson(BASE + '/json/new?url=about%3Ablank', 'PUT');
const ws = new WebSocket(tab.webSocketDebuggerUrl, { perMessageDeflate: false });
await new Promise((res, rej) => { ws.once('open', res); ws.once('error', rej); });
let id = 0; const pending = new Map;
ws.on('message', raw => { const m = JSON.parse(Buffer.from(raw, 'utf8').toString('utf8')); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
const cmd = (method, params) => new Promise((res, rej) => { const i = ++id; pending.set(i, m => m.error ? rej(new Error(method + ': ' + JSON.stringify(m.error))) : res(m.result)); ws.send(JSON.stringify({ id: i, method, params: params || {} })); });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const evl = async expr => { const r = await cmd('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) return 'EX:' + String((r.result && r.result.description) || '?').split('\n').slice(0, 2).join(' | '); return r.result && r.result.value; };
const key = async (code, vk, ch) => { await cmd('Input.dispatchKeyEvent', { type: 'keyDown', key: ch, code, windowsVirtualKeyCode: vk, nativeKeyCode: vk }); await sleep(90); await cmd('Input.dispatchKeyEvent', { type: 'keyUp', key: ch, code, windowsVirtualKeyCode: vk, nativeKeyCode: vk }); await sleep(120); };

await cmd('Page.enable'); await cmd('Runtime.enable'); await cmd('DOM.enable');
await cmd('Page.navigate', { url }); await sleep(10000);
// keep RAF alive even if headless throttles background tabs
await cmd('Emulation.setFocusEmulationEnabled', { enabled: true });
await cmd('Emulation.setPageScaleFactor', { factor: 1 }).catch(() => {});

await evl(`(function(){const sc=window.SpaceFarmer.game.scene.getScene('SpaceshipScene');
window.__ev=[]; sc.input.on('pointerdown', (p, over) => { window.__ev.push('P:' + p.eventType + ' over=' + ((over||[]).map(o=>(o.type||'?')).join('+')||'EMPTY')); });
return 1;})()`);

const S = `(function(){const sc=window.SpaceFarmer.game.scene.getScene('SpaceshipScene');
return JSON.stringify({hub:!!(sc.hub&&sc.hub.open), bp:!!(sc.backpackPanel&&sc.backpackPanel.visible),
 sBP:!!sc.showingBackpack, sHub:!!sc.showingHub, ev:(window.__ev||[]).slice(-3)});})()`;

// open hub deterministically (keyboard M can miss frames when RAF is throttled)
await evl(`(function(){const sc=window.SpaceFarmer.game.scene.getScene('SpaceshipScene');
if(!(sc.hub&&sc.hub.open)) sc.toggleHub(); return sc.hub.open;})()`);
await sleep(400);
console.log('hub-open:', await evl(S));

const G = `(function(){const sc=window.SpaceFarmer.game.scene.getScene('SpaceshipScene');
const cfg=sc.game.config,c=sc.game.canvas,r=c.getBoundingClientRect();
const kx=r.width/cfg.width, ky=r.height/cfg.height;
const p=sc.hub.panel; const bg=sc.hub.bg;
const top=-bg.height/2+60, bottom=bg.height/2-24, span=bottom-top;
const rowH=Math.max(26,Math.min(58,span/Math.max(sc.hub.sections.length,1)));
const row0y=top+rowH/2;
return JSON.stringify({box:[r.left,r.top,r.width,r.height],kx,ky,cx:p.x,cy:p.y,row0y,
 rows:(sc.hub.rows||[]).map(rw=>({act:rw.rect.active,vis:rw.rect.visible,inp:!!rw.rect.input,
   px:rw.rect.x,py:rw.rect.y,w:rw.rect.width,h:rw.rect.height,dep:rw.rect.depth}))});})()`;
const gs = await evl(G); console.log('geo:', gs);
let g = {}; try { g = JSON.parse(gs); } catch (e) {}
if (!g.box) { console.log('geo failed'); ws.close(); process.exit(1); }

// geometry-independent click point: ask Phaser itself where the row rect is on screen
const pt = await evl(`(function(){const sc=window.SpaceFarmer.game.scene.getScene('SpaceshipScene');
const rw=sc.hub.rows[0].rect; const cam=sc.cameras.main;
// container scroll factor is 0 so panel renders at (panel.x, panel.y) in screen/camera space:
const wx=sc.hub.panel.x + rw.x, wy=sc.hub.panel.y + rw.y;
return JSON.stringify({wx,wy,camScroll:[cam.scrollX,cam.scrollY],zoom:cam.zoom,sf:[rw.scrollFactor.x,rw.scrollFactor.y]};})()`);
console.log('row0 world:', pt);

const clickAt = async (x, y) =>  { await cmd('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 }); await sleep(90); await cmd('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 }); await sleep(500); };
const touchAt = async (x, y) => { const tp = [{ x, y, radiusX: 12, radiusY: 12, force: 1 }];
  await cmd('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: tp }); await sleep(90);
  await cmd('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await sleep(500); };

const cssX = g.box[0] + g.cx * g.kx;
const cssY = g.box[1] + (g.cy + g.row0y) * g.ky;


// ── 1) MOUSE click row 0 ──
await evl(`window.__ev=[];1`);
await clickAt(cssX, cssY);
console.log('MOUSE:', await evl(S));

// 1b) same click with the rows' object hit-testing DISABLED — proves the
//     scene-level fallback carries the tap alone (the flaky-device case)
await evl(`(function(){const sc=window.SpaceFarmer.game.scene.getScene('SpaceshipScene');
 sc.closeAllPanels(); if(!(sc.hub&&sc.hub.open))sc.toggleHub();
 for(const r of sc.hub.rows){ r.rect.input.enable=false; r.rect.input.enabled=false; r.rect.setInteractive(false); }
 return 'rows-input-off';})()`);
await sleep(300); await evl(`window.__ev=[];1`);
await clickAt(cssX, cssY);
console.log('MOUSE(noObjInput):', await evl(S));
await evl(`(function(){const sc=window.SpaceFarmer.game.scene.getScene('SpaceshipScene');
 sc.closeAllPanels(); if(!(sc.hub&&sc.hub.open))sc.toggleHub();
 for(const r of sc.hub.rows){ r.rect.setInteractive(true); r.rect.input.enabled=true; }
 return 'rows-input-on';})()`);
await sleep(300);

fs.writeFileSync('/tmp/qa/matrix_after_mouse.png', Buffer.from((await cmd('Page.captureScreenshot', { format: 'png' })).data, 'base64'));

// reset: close backpack, reopen hub
await evl(`(function(){const sc=window.SpaceFarmer.game.scene.getScene('SpaceshipScene');
sc.closeAllPanels(); if(!(sc.hub&&sc.hub.open)) sc.toggleHub(); return 1;})()`);
await sleep(300); await evl(`window.__ev=[];1`);

// ── 2) TOUCH tap row 0 ──
await touchAt(cssX, cssY);
console.log('TOUCH:', await evl(S));
fs.writeFileSync('/tmp/qa/matrix_after_touch.png', Buffer.from((await cmd('Page.captureScreenshot', { format: 'png' })).data, 'base64'));

// reset + reopen
await evl(`(function(){const sc=window.SpaceFarmer.game.scene.getScene('SpaceshipScene');
sc.closeAllPanels(); if(!(sc.hub&&sc.hub.open)) sc.toggleHub(); return 1;})()`);
await sleep(300); await evl(`window.__ev=[];1`);

// ── 3) KEYBOARD '1' with hub open ──
await key('Digit1', 49, '1'); await sleep(400);
console.log('KEY1 :', await evl(S));

ws.close(); process.exit(0);

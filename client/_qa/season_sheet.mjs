// season_sheet.mjs — SF42 season/night contact-sheet renderer for QA review.
//
// Renders the real PlanetScene across all 4 seasons at day and night (8 PNGs)
// so visual regressions from SF29/SF32/SF35/SF41 season/night work can be
// reviewed side by side.
//
// USAGE (requires server on :8900 + Chrome CDP on :9333 — e.g. started the way
// scripts/live_smoke.sh starts them):
//   PORT=8900 node server.js &
//   chrome --headless=new --remote-debugging-port=9333 --mute-audio ... &
//   node client/_qa/season_sheet.mjs
// Prints a JSON summary { files:[{path,bytes,mean:[r,g,b]}], ok }
// and exits 1 if any two seasons' DAY means are within 3 units on all
// channels (seasons must be visually distinct).
import WebSocket from 'ws';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

const BASE = 'http://127.0.0.1:9333';
const GAME = 'http://127.0.0.1:8900/?scene=Planet';
const outDir = '/tmp/sf_seasons';
fs.mkdirSync(outDir, { recursive: true });

function curlJson(u, m) { const a = ['-s', u]; if (m) a.unshift('-X', m); return JSON.parse(execFileSync('/usr/bin/curl', a, { encoding: 'utf8' })); }
const tab = curlJson(BASE + '/json/new?url=about%3Ablank', 'PUT');
const ws = new WebSocket(tab.webSocketDebuggerUrl, { perMessageDeflate: false });
await new Promise((res, rej) => { ws.once('open', res); ws.once('error', rej); });

let id = 0; const pending = new Map; const errors = [];
ws.on('message', raw => {
  const m = JSON.parse(Buffer.from(raw, 'utf8').toString('utf8'));
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  if (m.method === 'Runtime.exceptionThrown') { const d = m.params && m.params.exceptionDetails; errors.push('EX: ' + (d ? ((d.exception && d.exception.description) || d.text) : '?').slice(0, 500)); }
  if (m.method === 'Runtime.consoleAPICalled') {
    const a = (m.params && m.params.args) || [];
    if (m.level === 'error') errors.push('CON: ' + a.map(x => x.value !== undefined ? x.value : (x.description || x.type)).join(' '));
  }
});
const cmd = (method, params) => new Promise((res, rej) => {
  const i = ++id; pending.set(i, m => m.error ? rej(new Error(method + ': ' + JSON.stringify(m.error))) : res(m.result));
  ws.send(JSON.stringify({ id: i, method, params: params || {} }));
});
const sleep = ms => new Promise(r => setTimeout(r, ms));
const evl = async expr => {
  const r = await cmd('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error('EVAL EX: ' + String((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || '?').split('\n').slice(0, 3).join(' | '));
  return r.result && r.result.value;
};
const shot = async name => {
  const d = await cmd('Page.captureScreenshot', { format: 'png' });
  const p = outDir + '/' + name; fs.writeFileSync(p, Buffer.from(d.data, 'base64'));
  return { path: p, data: d.data };
};
const meanOf = async (data64) => {
  const expr = `(async function(){
const c=document.createElement('canvas');const W=64,H=64;c.width=W;c.height=H;
const g=c.getContext('2d',{willReadFrequently:true});
const img=new Image();img.src='data:image/png;base64,${data64}';
await img.decode();
g.drawImage(img,0,0,img.width,img.height,0,0,W,H);
const d=g.getImageData(0,0,W,H).data;let r=0,gg=0,b=0,n=d.length/4;
for(let i=0;i<d.length;i+=4){r+=d[i];gg+=d[i+1];b+=d[i+2];}
return [Math.round(r/n),Math.round(gg/n),Math.round(b/n)];
})()`;
  const r = await evl(expr);
  if (!Array.isArray(r) || r.length !== 3 || r.some(x => typeof x !== 'number')) throw new Error('mean eval failed: ' + String(r).slice(0, 200));
  return r;
};

await cmd('Page.enable'); await cmd('Runtime.enable'); await cmd('DOM.enable');
await cmd('Emulation.setFocusEmulationEnabled', { enabled: true });

// ── boot straight into the Planet scene ──
await cmd('Page.navigate', { url: GAME });
await sleep(9000);
const st = await evl(`(function(){const g=window.SpaceFarmer&&window.SpaceFarmer.game;if(!g)return 'no-game';
const s=g.scene.getScene('PlanetScene');return s&&s.sys.isActive()?'planet-ok':'planet-off:'+g.scene.getScenes().map(x=>x.scene.key).join(',');})()`);
if (st !== 'planet-ok') { console.error('season_sheet: PlanetScene not active: ' + st); ws.close(); process.exit(1); }
await sleep(2000);

// Whole-frame mean RGB (downscaled to 64x64) computed in-page — a centre crop lands on roads/the player and never changes with the season: the PNG screenshot is decoded into an
// Image, drawn onto an offscreen 2D canvas (64x64 centre crop), and averaged
// via getImageData — no PNG decoder needed on the Node side.

const files = []; const dayMeans = [];
const nightMeans = [];
for (let season = 0; season < 4; season++) {
  for (const night of [false, true]) {
    const applied = await evl(`(function(){
const g=window.SpaceFarmer;if(!g||!g.game)return 'no-game';
const sc=g.game.scene.getScene('PlanetScene');if(!sc)return 'no-scene';
sc._seasonHold=true;sc._nightOverride=true;
g.setSeasonGrade(${season});
sc.isNight=${night?'true':'false'};
sc.updateNightVisuals();
return sc.isNight===${night?'true':'false'}?'applied':'not-applied';})()`);
    if (applied !== 'applied') { console.error('season_sheet: apply failed s=' + season + ' night=' + night + ': ' + applied); ws.close(); process.exit(1); }
    await sleep(2500);
    const s = await shot('s' + season + '_' + (night ? 'night' : 'day') + '.png');
    const mean = await meanOf(s.data);
    const p = s.path;
    const bytes = fs.statSync(p).size;
    files.push({ path: p, bytes, mean, season, night });
    if (!night) dayMeans.push(mean); else nightMeans.push(mean);
    console.log('s' + season + '_' + (night ? 'night' : 'day') + '.png  bytes=' + bytes + '  mean=' + JSON.stringify(mean));
  }
}

// seasons must differ on DAY: no two day means within 3 units on all channels
const diffs = []; let ok = true;
for (let i = 0; i < 4; i++) for (let j = i + 1; j < 4; j++) {
  const a = dayMeans[i], b = dayMeans[j];
  const d = [Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2])];
  const close = d[0] <= 3 && d[1] <= 3 && d[2] <= 3;
  diffs.push('s' + i + '-s' + j + ': d=' + d.join(',') + (close ? ' CLOSE' : ' ok'));
  if (close) ok = false;
}
await evl(`(function(){const sc=window.SpaceFarmer.game.scene.getScene('PlanetScene');if(sc){sc._seasonHold=false;sc._nightOverride=false;}return 1;})()`);
const summary = { files: files.map(f => ({ path: f.path.replace(/^\/tmp\/sf_seasons\//, ''), bytes: f.bytes, mean: f.mean, season: f.season, night: f.night })), seasonsDiffer: ok, errors };
console.log('SEASON_SUMMARY ' + JSON.stringify({ ...summary, dayDiffs: diffs }));
if (errors.length) { console.log('RUNTIME_ERRORS ' + errors.length); }
if (!ok) { console.error('season_sheet: FAIL — seasons not visually distinct on day'); ws.close(); process.exit(1); }
// SF52: night must actually darken — every season's night luminance ≤ 75% of its day
const lum = m => 0.299 * m[0] + 0.587 * m[1] + 0.114 * m[2];
const nightRatios = dayMeans.map((d, i) => +(lum(nightMeans[i]) / Math.max(1, lum(d))).toFixed(3));
console.log('NIGHT_RATIOS ' + JSON.stringify(nightRatios));
if (nightRatios.some(r => !(r <= 0.75))) { console.error('season_sheet: FAIL — night not darker than day (ratio > 0.75): ' + nightRatios.join(',')); ws.close(); process.exit(1); }
console.log('SEASONS OK');

ws.close();
process.exit(0);

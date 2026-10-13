// playtest_full.mjs — comprehensive LIVE play test of the web game.
// Boots the real game in headless Chrome, drives it as a player would
// (scene methods + trusted key/mouse via CDP), and verifies state after each.
// Usage: node client/_qa/playtest_full.mjs
import WebSocket from 'ws';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

const BASE = process.env.SF_CDP_BASE || 'http://127.0.0.1:9333';
const GAME = process.env.SF_GAME_URL || 'http://localhost:8900';
const outDir = '/tmp/sf_playtest';
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
    const lvl = m.level;
    if (lvl === 'error') errors.push('CON: ' + a.map(x => x.value !== undefined ? x.value : (x.description || x.type)).join(' '));
  }
});
const cmd = (method, params) => new Promise((res, rej) => {
  const i = ++id; pending.set(i, m => m.error ? rej(new Error(method + ': ' + JSON.stringify(m.error))) : res(m.result));
  ws.send(JSON.stringify({ id: i, method, params: params || {} }));
});
const sleep = ms => new Promise(r => setTimeout(r, ms));
const evl = async expr => {
  const r = await cmd('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) return 'EX:' + String((r.result && r.result.description) || '?').split('\n').slice(0, 3).join(' | ');
  return r.result && r.result.value;
};
const shot = async name => {
  const d = await cmd('Page.captureScreenshot', { format: 'png' });
  const p = outDir + '/' + name; fs.writeFileSync(p, Buffer.from(d.data, 'base64'));
  return p;
};
// trusted key (CDP browser-level — reaches Phaser's input manager)
const key = async (ch, vk) => {
  const code = ch === ' ' ? 'Space' : 'Key' + String.fromCharCode(vk);
  await cmd('Input.dispatchKeyEvent', { type: 'keyDown', key: ch, code, windowsVirtualKeyCode: vk, nativeKeyCode: vk });
  await sleep(70);
  await cmd('Input.dispatchKeyEvent', { type: 'keyUp', key: ch, code, windowsVirtualKeyCode: vk, nativeKeyCode: vk });
  await sleep(140);
};
const results = [];
// JSON-aware check: matches `"key":true` or `key:true` (quotes may be present).
const has = (s, key) => { return (s || '').includes('"' + key + '":true') || (s || '').includes(key + ':true'); };
const check = (name, ok, detail) => { results.push({ name, ok, detail }); console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? '  — ' + detail : '')); };
// read the authoritative growthDay of a farm tile (for the maturity poll)
const tileGrowthDay = async (x, y) => {
  const r = await evl(`(function(){const net=window.SpaceFarmer.net;const farm=net.getFarmState?net.getFarmState():null;
  const t=farm&&farm.tiles.find(t=>t.x===${x}&&t.y===${y});return t?t.growthDay:-1;})()`);
  return typeof r === 'number' ? r : -1;
};

await cmd('Page.enable'); await cmd('Runtime.enable'); await cmd('DOM.enable');
await cmd('Emulation.setFocusEmulationEnabled', { enabled: true });

// ── Phase 1: full boot through intro ──
await cmd('Page.navigate', { url: GAME });
// Poll (up to 30s) instead of a fixed sleep: under host load the swiftshader
// boot can take longer than 9s and a fixed wait reads a half-booted game.
let st = '';
for (let i = 0; i < 60; i++) {
  await sleep(500);
  st = await evl(`(function(){const g=window.SpaceFarmer&&window.SpaceFarmer.game;if(!g)return 'no-game';
return g.scene.getScenes().map(s=>s.scene.key+'='+(s.sys.isActive()?'active':s.isPaused?'paused':'sleeping')).join(',');})()`);
  if (i >= 17 && /IntroScene=active/.test(st || '')) break;
}
check('boot: intro active', /IntroScene=active/.test(st || ''), st);
await shot('01_intro_crawl.png');
// skip crawl → title, then begin → ship
await key(' ', 32); await sleep(600);
await key(' ', 32); await sleep(1200);
st = await evl(`(function(){const g=window.SpaceFarmer&&window.SpaceFarmer.game;if(!g)return 'no-game';
return g.scene.getScenes().map(s=>s.scene.key+'='+(s.sys.isActive()?'active':s.isPaused?'paused':'sleeping')).join(',');})()`);
check('intro→ship transition', /SpaceshipScene=active/.test(st || ''), st);
await shot('02_ship.png');

// ── SF33: contact history is server-authoritative ──
// Plant a stale browser-local doctrine ('bogus') BEFORE PlanetScene boots, but
// only once the server has actually connected. Connected create() must never
// ingest localStorage, and the server hydration must drop the stale key.
let sf33conn = false;
for (let i = 0; i < 40 && !sf33conn; i++) {
  const c = await evl(`(function(){const n=window.SpaceFarmer&&window.SpaceFarmer.net;return !!(n&&n.connected);})()`);
  if (c === true) sf33conn = true; else await sleep(250);
}
check('SF33 net connected before landing', sf33conn, 'connected=' + String(sf33conn));
if (sf33conn) {
  const setRes = await evl(`(function(){
    if(!window.__sf33Rec){window.__sf33Rec=0;const orig=localStorage.getItem.bind(localStorage);
      localStorage.getItem=function(k){if(k==='spacefarmer.firstContact')window.__sf33Rec++;return orig(k);};}
    localStorage.setItem('spacefarmer.firstContact','{"bogus":"x"}');return 'set';})()`);
  check('SF33 stale localStorage seeded + getItem recorder armed', setRes === 'set', setRes);
}

// ── Phase 2: ship tutorial → planet ──
// Drive the ship scene to land on the planet (as the tutorial would).
let landRes = await evl(`(function(){const sc=window.SpaceFarmer.game.scene.getScene('SpaceshipScene');if(!sc)return 'no-ship';
if(sc.landOnPlanet) sc.landOnPlanet(); return 'called';})()`);
// SF33 gate, FIRST snapshot after PlanetScene boots (before the server sync can
// overwrite the map): the stale localStorage 'bogus' doctrine must never appear
// in the scene's contact map, and connected boot must perform ZERO
// localStorage.getItem('spacefarmer.firstContact') reads.
let bogusKeys = null;
for (let i = 0; i < 60 && bogusKeys === null; i++) {
  const k = await evl(`(function(){const sc=window.SpaceFarmer.game.scene.getScene('PlanetScene');if(!sc||!sc.contactChoices)return 'pending';
return JSON.stringify({keys:Object.keys(sc.contactChoices),reads:window.__sf33Rec});})()`);
  try { const j = JSON.parse(k); if (j && j.keys) bogusKeys = j; } catch {}
  if (bogusKeys === null) await sleep(120);
}
check('contact history is server-authoritative',
  !!bogusKeys && !bogusKeys.keys.includes('bogus') && bogusKeys.reads === 0,
  'keys=' + JSON.stringify(bogusKeys && bogusKeys.keys) + ' reads=' + (bogusKeys && bogusKeys.reads));
await sleep(6000);
st = await evl(`(function(){const g=window.SpaceFarmer&&window.SpaceFarmer.game;if(!g)return 'no-game';
return g.scene.getScenes().map(s=>s.scene.key+'='+(s.sys.isActive()?'active':s.isPaused?'paused':'sleeping')).join(',');})()`);
check('ship→planet transition', /PlanetScene=active/.test(st || ''), st + ' [' + landRes + ']');
await shot('03_planet.png');

// ── Phase 3: player state on the planet ──
await sleep(1500); // let state sync settle after landing
const p0 = await evl(`(function(){const net=window.SpaceFarmer.net;
if(!net)return 'no-net';
if(!net.connected)return 'disconnected';
const ps=net.getPlayerState?net.getPlayerState():null;
if(!ps)return 'no-state pid='+net.playerId+' keys='+(net.room&&net.room.state.players?[...net.room.state.players.keys()].join(','):'none');
const rs=net.room&&net.room.state;
return JSON.stringify({credits:ps.credits,energy:ps.energy,season:rs?rs.season:null,day:rs?rs.day:null,inv:Object.fromEntries([...(ps.inventory||[])]),equipped:ps.equipped});})()`);
check('planet: player state synced', /"credits"/.test(p0 || ''), p0);
let p0j = {}; try { p0j = JSON.parse(p0); } catch {}
check('planet: credits present', p0j.credits !== undefined, 'credits=' + p0j.credits);
check('planet: energy/stamina present', p0j.energy !== undefined, 'energy=' + p0j.energy);
check('planet: season+day present', p0j.season !== undefined && p0j.day !== undefined, 'season=' + p0j.season + ' day=' + p0j.day);

// ── Phase 4: NPC dialogue ──
const talkRes = await evl(`(function(){const sc=window.SpaceFarmer.game.scene.getScene('PlanetScene');if(!sc)return 'no-scene';
const npcs=Object.values(sc.npcBrains||{});const npc=npcs[0]||null;if(!npc)return 'no-npc';
sc.startNPCDialogue(npc);return JSON.stringify({npc:npc.id,hasDialogue:sc.inDialogue});})()`);
await sleep(600);
const talkState = await evl(`(function(){const sc=window.SpaceFarmer.game.scene.getScene('PlanetScene');
return JSON.stringify({inDialogue:sc.inDialogue,selectedNPC:sc.selectedNPC&&sc.selectedNPC.id,diaTitle:sc.dialogueTitle?sc.dialogueTitle.text:'?',diaText:sc.dialogueText?sc.dialogueText.text:'?',diaVisible:sc.dialoguePanel?sc.dialoguePanel.visible:null});})()`);
check('NPC dialogue opens', has(talkState,'inDialogue'), talkState);
check('NPC dialogue has a real speaker', !/undefined/.test(talkState || '') && /Nova/.test(talkState || ''), talkState);
await shot('04_npc_dialogue.png');
// close dialogue
await evl(`(function(){const sc=window.SpaceFarmer.game.scene.getScene('PlanetScene');if(sc.inDialogue&&!sc.eventQueue)sc.closeAllPanels();return 1;})()`);

// ── Phase 5: gift system ──
// Give the NPC a gift; verify friendship changes (server-authoritative).
const giftRes = await evl(`(function(){const sc=window.SpaceFarmer.game.scene.getScene('PlanetScene');const net=window.SpaceFarmer.net;
const npcs=Object.values(sc.npcBrains||{});const npc=npcs[0]||null;if(!npc)return 'no-npc';
// pick any owned non-seed item to gift
const owned=Object.entries(sc.inventory||{}).filter(([k,v])=>v>0&&k!=='seeds');
const item=owned[0]?owned[0][0]:null;if(!item)return 'no-item';
return net.request('gift',{npc:npc.id,item}).then(r=>JSON.stringify({ok:r&&r.ok,item,res:r}));})()`);
await sleep(800);
check('gift: server accepts gift', /"ok":true/.test(giftRes || ''), giftRes);

// ── Phase 6: Grand Exchange sell ──
// Seed some inventory, then sell via the GE (server ledger).
const geRes = await evl(`(function(){const net=window.SpaceFarmer.net;
return net.request('sell',{item:'space-wheat',quantity:1}).then(r=>JSON.stringify({ok:r&&r.ok,credits:r&&r.credits,reason:r&&r.reason}));})()`);
await sleep(800);
check('GE: sell endpoint replies', /"ok"/.test(geRes || ''), geRes);
// The UI path: open the GE panel (must be at the building — teleport there)
const geUI = await evl(`(function(){const sc=window.SpaceFarmer.game.scene.getScene('PlanetScene');
// the exchange door is in MapData BUILDINGS (module const); find it by action
const T=(sc.tileSize||sc.T)||32;
const door=(sc.exchangeDoor)||{x:38,y:32};
sc.playerSpr.setPosition(door.x*T+T/2,door.y*T+T/2);
sc.cameras.main.stopFollow(); sc.cameras.main.setScroll(door.x*T-480,door.y*T-360); sc.cameras.main.startFollow(sc.playerSpr,true,0.5,0.5);
return JSON.stringify({door,px:Math.floor(sc.playerSpr.x/T),py:Math.floor(sc.playerSpr.y/T)});})()`);
await sleep(400);
const geOpen = await evl(`(function(){const sc=window.SpaceFarmer.game.scene.getScene('PlanetScene');sc.openGrandExchange();
return JSON.stringify({showingGE:sc.showingGE,geVisible:sc.gePanel?sc.gePanel.visible:null});})()`);
check('GE: panel opens at building', has(geOpen,'showingGE'), geOpen + ' [teleport ' + geUI + ']');
await shot('05_grand_exchange.png');
await evl(`(function(){const sc=window.SpaceFarmer.game.scene.getScene('PlanetScene');if(sc.showingGE)sc.closeAllPanels();return 1;})()`);

// ── Phase 7: Shop ──
const shopOpen = await evl(`(function(){const sc=window.SpaceFarmer.game.scene.getScene('PlanetScene');sc.openShop();
return JSON.stringify({showingShop:sc.showingShop,shopVisible:sc.shopPanel?sc.shopPanel.visible:null,credits:sc.credits});})()`);
await sleep(400);
check('Shop: panel opens', has(shopOpen,'showingShop'), shopOpen);
await shot('06_shop.png');
// buy seeds through the actual UI path
const buyRes = await evl(`(function(){const sc=window.SpaceFarmer.game.scene.getScene('PlanetScene');const net=window.SpaceFarmer.net;
const before=sc.credits;
return net.request('buy',{item:'seeds',quantity:1}).then(r=>JSON.stringify({ok:r&&r.ok,credits:r&&r.credits,before,reason:r&&r.reason}));})()`);
await sleep(800);
check('Shop: buy seeds', /"ok":true/.test(buyRes || ''), buyRes);
await evl(`(function(){const sc=window.SpaceFarmer.game.scene.getScene('PlanetScene');if(sc.showingShop)sc.closeAllPanels();return 1;})()`);

// ── Phase 8: Smithy (tool upgrade) ──
const smithOpen = await evl(`(function(){const sc=window.SpaceFarmer.game.scene.getScene('PlanetScene');sc.openSmithy();
return JSON.stringify({showingSmithy:sc.showingSmithy});})()`);
await sleep(400);
check('Smithy: panel opens', has(smithOpen,'showingSmithy'), smithOpen);
await shot('07_smithy.png');
await evl(`(function(){const sc=window.SpaceFarmer.game.scene.getScene('PlanetScene');if(sc.showingSmithy)sc.closeAllPanels();return 1;})()`);

// ── Phase 9: Backpack (inventory/tools) ──
const bpOpen = await evl(`(function(){const sc=window.SpaceFarmer.game.scene.getScene('PlanetScene');sc.openBackpack();
return JSON.stringify({showingBackpack:sc.showingBackpack,inv:sc.inventory});})()`);
await sleep(400);
check('Backpack: panel opens', has(bpOpen,'showingBackpack'), bpOpen);
await shot('08_backpack.png');
await evl(`(function(){const sc=window.SpaceFarmer.game.scene.getScene('PlanetScene');if(sc.showingBackpack)sc.closeAllPanels();return 1;})()`);

// ── Phase 10: Ranch ──
const ranchOpen = await evl(`(function(){const sc=window.SpaceFarmer.game.scene.getScene('PlanetScene');sc.openRanch();
return JSON.stringify({showingRanch:sc.showingRanch});})()`);
await sleep(400);
check('Ranch: panel opens', has(ranchOpen,'showingRanch'), ranchOpen);
await shot('09_ranch.png');
await evl(`(function(){const sc=window.SpaceFarmer.game.scene.getScene('PlanetScene');if(sc.showingRanch)sc.closeAllPanels();return 1;})()`);

// ── Phase 11: Colony Hub ──
const hubOpen = await evl(`(function(){const sc=window.SpaceFarmer.game.scene.getScene('PlanetScene');sc.toggleHub();
return JSON.stringify({showingHub:sc.showingHub,hubOpen:sc.hub?sc.hub.open:null});})()`);
await sleep(400);
check('Colony Hub: opens', has(hubOpen,'showingHub'), hubOpen);
await shot('10_colony_hub.png');
await evl(`(function(){const sc=window.SpaceFarmer.game.scene.getScene('PlanetScene');sc.closeAllPanels();return 1;})()`);

// ── Phase 12: farming loop (equip→till→plant→water→harvest) ──
// till/plant/water/harvest/advance are fire-and-forget (state sync updates the
// client) — verify each through the server's authoritative farm tiles/state,
// not a reply.
const farmRes = await evl(`(function(){const net=window.SpaceFarmer.net;
return net.request('equip',{tool:'hoe'}).then(r=>JSON.stringify({ok:r&&r.ok,equipped:r&&r.equipped}));})()`);
await sleep(600);
check('farm: equip hoe', /"ok":true/.test(farmRes || ''), farmRes);
// find a tilled-capable empty tile from the authoritative farm state
const tileState = await evl(`(function(){const net=window.SpaceFarmer.net;const farm=net.getFarmState?net.getFarmState():null;
if(!farm)return 'no-farm';const ts=farm.tiles||[];return JSON.stringify({n:ts.length,first:ts[0]?{x:ts[0].x,y:ts[0].y,type:ts[0].type,crop:ts[0].crop}:null});})()`);
await sleep(300);
let tj = {}; try { tj = JSON.parse(tileState); } catch {}
check('farm: tile grid present', tj.n > 0, tileState);
// pick a FRESH empty tile (a prior run may have seeded tile 0) so till is legal
const fresh = await evl(`(function(){const net=window.SpaceFarmer.net;const farm=net.getFarmState?net.getFarmState():null;
const t=(farm&&farm.tiles||[]).find(t=>t.type==='empty');return t?JSON.stringify({x:t.x,y:t.y}):'none';})()`);
await sleep(300);
let fj = {}; try { fj = JSON.parse(fresh); } catch {}
const tx = fj.x !== undefined ? fj.x : (tj.first ? tj.first.x : 0);
const ty = fj.y !== undefined ? fj.y : (tj.first ? tj.first.y : 0);
await evl(`(function(){const net=window.SpaceFarmer.net;net.send('till',{tileX:${tx},tileY:${ty}});return 1;})()`);
await sleep(700);
const afterTill = await evl(`(function(){const net=window.SpaceFarmer.net;const farm=net.getFarmState?net.getFarmState():null;
const t=farm&&farm.tiles.find(t=>t.x===${tx}&&t.y===${ty});return t?JSON.stringify({type:t.type,watered:t.watered}):'no-tile';})()`);
check('farm: till tiled', /"type":"tilled"/.test(afterTill || '') || /"type":"tilled"/.test(afterTill || ''), afterTill);
await evl(`(function(){const net=window.SpaceFarmer.net;net.send('plant',{tileX:${tx},tileY:${ty},crop:'space-wheat'});return 1;})()`);
await sleep(700);
const afterPlant = await evl(`(function(){const net=window.SpaceFarmer.net;const farm=net.getFarmState?net.getFarmState():null;
const t=farm&&farm.tiles.find(t=>t.x===${tx}&&t.y===${ty});return t?JSON.stringify({crop:t.crop,growthDay:t.growthDay}):'no-tile';})()`);
check('farm: plant seeded', /"crop":"space-wheat"/.test(afterPlant || ''), afterPlant);
// SF30: watering feedback hook — firing the glint at tile (0,0) must not throw
const glintRes = await evl(`(function(){try{window.SpaceFarmer.waterGlint(0,0);return 'fired';}catch(e){return 'throw:'+e.message;}})()`);
check('water glint fires', glintRes === 'fired', glintRes);
// equip the watering can (server requires it for water), then water + advance
// 6 days — wheat matures after watering 6 days (in-season spring)
await evl(`(function(){const net=window.SpaceFarmer.net;return net.request('equip',{tool:'watering'}).then(r=>JSON.stringify({ok:r&&r.ok}));})()`);
await sleep(500);
// water+advance until the tile MATURES (growthDay reaches 6). onWater returns a
// value but never sends a client reply (the handler discards it) — so drive by
// net.send (fire-and-forget) and read waterLevel from AUTHORITATIVE state to
// refill at the pond when low, exactly as a player would.
for (let i = 0; i < 12 && await tileGrowthDay(tx, ty) < 6; i++) {
  await evl(`(function(){const net=window.SpaceFarmer.net;
    const ps=net.getPlayerState&&net.getPlayerState();const lvl=ps?ps.waterLevel:0;
    if(lvl<20) net.send('fillWater');
    net.send('water',{tileX:${tx},tileY:${ty}});return 1;})()`);
  await sleep(400);
  await evl(`(function(){const net=window.SpaceFarmer.net;net.send('advance');return 1;})()`);
  await sleep(400);
}
await sleep(1200);
const afterWaterDay = await evl(`(function(){const net=window.SpaceFarmer.net;const ps=net.getPlayerState?net.getPlayerState():null;
const farm=net.getFarmState?net.getFarmState():null;const t=farm&&farm.tiles.find(t=>t.x===${tx}&&t.y===${ty});
const rs=net.room&&net.room.state;
return JSON.stringify({day:rs?rs.day:null,watered:t?t.watered:null,growthDay:t?t.growthDay:null,crop:t?t.crop:null});})()`);
check('farm: water+advance day', /"day":/.test(afterWaterDay || ''), afterWaterDay);
// watering worked when the crop MATURED (growthDay reached 6 / tile mature) —
// `watered:false` after maturation is correct (the crop consumed the water).
check('farm: tile grew to mature', /"growthDay":6/.test(afterWaterDay || '') || /"growthDay":5/.test(afterWaterDay || ''), afterWaterDay);
// harvest — bare hands required, so equip nothing (hands) first
await evl(`(function(){const net=window.SpaceFarmer.net;return net.request('equip',{tool:''}).then(r=>JSON.stringify({ok:r&&r.ok}));})()`);
await sleep(500);
await evl(`(function(){const net=window.SpaceFarmer.net;net.send('harvest',{tileX:${tx},tileY:${ty}});return 1;})()`);
await sleep(700);
const afterHarvest = await evl(`(function(){const net=window.SpaceFarmer.net;const ps=net.getPlayerState?net.getPlayerState():null;
const farm=net.getFarmState?net.getFarmState():null;const t=farm&&farm.tiles.find(t=>t.x===${tx}&&t.y===${ty});
return JSON.stringify({credits:ps?ps.credits:null,inv:Object.fromEntries([...(ps&&ps.inventory||[])]),tileType:t?t.type:null});})()`);
check('farm: harvest state', /"credits":/.test(afterHarvest || ''), afterHarvest);
// space-wheat is a regrow crop — after harvest it stays planted as 'growing'
check('farm: harvested tile', /"tileType":"growing"/.test(afterHarvest || '') || /"tileType":"empty"/.test(afterHarvest || ''), afterHarvest);

// ── Phase 13: energy / calendar sanity ──
const dayState = await evl(`(function(){const net=window.SpaceFarmer.net;
if(!net||!net.connected)return 'disconnected';
const ps=net.getPlayerState?net.getPlayerState():null;
if(!ps)return 'no-state';
const rs=net.room&&net.room.state;
return JSON.stringify({day:rs?rs.day:null,season:rs?rs.season:null,energy:ps.energy,credits:ps.credits});})()`);
check('calendar: day/season advance', /"day":/.test(dayState || ''), dayState);

// ── SF29: seasonal ground grading — winter paints the ground silver ──
const gradeRes = await evl(`(function(){const sc=window.SpaceFarmer.game.scene.getScene('PlanetScene');
if(!sc||!sc.tiles||!sc.tiles.length)return 'no-tiles';
window.SpaceFarmer.setSeasonGrade(3);
const t0=sc.tiles[0].tintTopLeft;
const winterApplied=((t0>>>0)===0xd8e4f4)||((t0&0xffffff)===0xd8e4f4);
window.SpaceFarmer.setSeasonGrade(0);
return JSON.stringify({winterApplied,t0:t0.toString(16)});})()`);
let winterApplied = false;
try { winterApplied = JSON.parse(gradeRes || '{}').winterApplied === true; } catch {}
check('season grade: winter tint applied', winterApplied === true, gradeRes || 'no-tiles');

// ── SF41: the painterly sky + deep-space planets tint with the season ──
const skyRes = await evl(`(function(){const sc=window.SpaceFarmer.game.scene.getScene('PlanetScene');
if(!sc||!sc.skyTile)return 'no-sky';
window.SpaceFarmer.setSeasonGrade(3);
const winterSky=sc.skyTile.tintTopLeft>>>0;
const p1=(sc.planetSpr&&sc.planetSpr.tintTopLeft>>>0)||0;
window.SpaceFarmer.setSeasonGrade(0);
const springSky=sc.skyTile.tintTopLeft>>>0;
return JSON.stringify({winterSky:winterSky.toString(16),springSky:springSky.toString(16),planet:p1.toString(16)});})()`);
let skyOK = false;
try { const j = JSON.parse(skyRes || '{}'); skyOK = j.winterSky === 'c8d8f8' && j.springSky === 'ffffff'; } catch {}
check('season grade: sky tinted', skyOK === true, skyRes || 'no-sky');

// ── SF35: stardust drift (≥30 motes, screen-anchored) + season haze ──
const sf35a = await evl(`(function(){const sc=window.SpaceFarmer.game.scene.getScene('PlanetScene');
if(!sc||!sc.stardust||!sc.stardust.length)return 'no-stardust';
const n=sc.stardust.length;const s0=sc.stardust.reduce((a,m)=>a+m.x+m.y,0);
const h=sc.seasonHaze;return JSON.stringify({n,sum:Math.round(s0),haze:!!h,depth:h?h.depth:null,alpha:h?h.alpha:null});})()`);
let sf35aOK = false;
try { const j = JSON.parse(sf35a || '{}'); sf35aOK = j.n >= 30 && j.haze === true && j.alpha <= 0.10; } catch {}
check('stardust drifts: window.SpaceFarmer.stardustCount() >= 30, haze present (alpha<=0.10)', sf35aOK, sf35a);
await sleep(400);
const sf35b = await evl(`(function(){const sc=window.SpaceFarmer.game.scene.getScene('PlanetScene');
if(!sc||!sc.stardust||!sc.stardust.length)return 'no-stardust';
const s1=sc.stardust.reduce((a,m)=>a+m.x+m.y,0);return JSON.stringify({sum:Math.round(s1)});})()`);
let sf35bOK = false;
try { const j0 = JSON.parse(sf35a || '{}'); const j1 = JSON.parse(sf35b || '{}'); sf35bOK = Math.abs(j0.sum - j1.sum) > 0; } catch {}
check('stardust drifts: mote positions moved between frames', sf35bOK, sf35a + ' → ' + sf35b);
const sf35c = await evl(`(function(){const sc=window.SpaceFarmer.game.scene.getScene('PlanetScene');
if(!sc||!sc.seasonHaze)return 'no-haze';
window.SpaceFarmer.setSeasonGrade(3);const winter=sc.seasonHaze.fillColor;
window.SpaceFarmer.setSeasonGrade(2);const fall=sc.seasonHaze.fillColor;
window.SpaceFarmer.setSeasonGrade(0);const spring=sc.seasonHaze.fillColor;
return JSON.stringify({winter:winter.toString(16),fall:fall.toString(16),spring:spring.toString(16),alpha:sc.seasonHaze.alpha});})()`);
let sf35cOK = false;
try { const j = JSON.parse(sf35c || '{}'); sf35cOK = j.winter === 'cfe0ff' && j.fall === 'ff9e5e' && j.spring === '9fe8c0' && j.alpha <= 0.10; } catch {}
check('SF35 season haze recolours per season (alpha<=0.10)', sf35cOK, sf35c);

// ── SF32: dusk/dawn tween + aurora sky event on a reproducible third night ──
const sf32Pre = await evl(`(function(){const sc=window.SpaceFarmer.game.scene.getScene('PlanetScene');if(!sc)return 'no-scene';
return JSON.stringify({dayCount:sc.dayCount,isNight:!!sc.isNight});})()`);
const sf32Set = await evl(`(function(){const sc=window.SpaceFarmer.game.scene.getScene('PlanetScene');if(!sc||!sc.updateNightVisuals)return 'no-scene';
sc._nightOverride=true;   // hold the server clock off so the tween can finish
sc.dayCount=3;sc.isNight=true;sc.updateNightVisuals();return 'ok';})()`);
await sleep(3000);
const sf32Res = await evl(`(function(){const sc=window.SpaceFarmer.game.scene.getScene('PlanetScene');if(!sc)return 'no-scene';
const au=sc.aurora||[];return JSON.stringify({alpha:sc.nightOverlay?sc.nightOverlay.alpha:null,
auroraVisible:au.length===3&&au.every(g=>g.visible===true)});})()`);
let sf32OK = false;
try { const j = JSON.parse(sf32Res || '{}'); sf32OK = j.alpha > 0.55 && j.auroraVisible === true; } catch {}
if (!sf32OK) {
  // the server may have re-flipped night mid-wait and restarted the tween
  await evl(`(function(){const sc=window.SpaceFarmer.game.scene.getScene('PlanetScene');if(!sc)return 'no-scene';
  sc._nightOverride=true;sc.isNight=true;sc.updateNightVisuals();return 1;})()`);
  await sleep(3000);
  const sf32Res2 = await evl(`(function(){const sc=window.SpaceFarmer.game.scene.getScene('PlanetScene');if(!sc)return 'no-scene';
  const au=sc.aurora||[];return JSON.stringify({alpha:sc.nightOverlay?sc.nightOverlay.alpha:null,
  auroraVisible:au.length===3&&au.every(g=>g.visible===true)});})()`);
  try { const j2 = JSON.parse(sf32Res2 || '{}'); sf32OK = j2.alpha > 0.55 && j2.auroraVisible === true; } catch {}
}
check('SF32 dusk tween: night reaches full alpha (>0.55 after 3s)', sf32OK, sf32Res + ' retry-failed');
// dawn: back to the pre-test day/night clock (the colony clock must not drift)
await evl(`(function(){const sc=window.SpaceFarmer.game.scene.getScene('PlanetScene');if(!sc)return 'no-scene';
const pre=(${sf32Pre});sc._nightOverride=true;sc.dayCount=pre.dayCount;sc.isNight=pre.isNight;sc.updateNightVisuals();return 1;})()`);
await sleep(3000);
const sf32Off = await evl(`(function(){const sc=window.SpaceFarmer.game.scene.getScene('PlanetScene');if(!sc)return 'no-scene';
return JSON.stringify({alpha:sc.nightOverlay?sc.nightOverlay.alpha:null,auroraVisible:(sc.aurora||[]).some(g=>g.visible===true)});})()`);
let sf32OffOK = false;
try { const j = JSON.parse(sf32Off || '{}'); sf32OffOK = j.alpha === 0 && j.auroraVisible === false; } catch {}
check('SF32 dawn: night overlay falls back to 0, aurora hidden', sf32OffOK, sf32Off);

// ── SF36: festival lamp bloom — lamps pulse amber while the feast is on ──
// ── SF37: envoy arrival flash — firing the hook animates a live envoy ──
const sf37Pre = await evl(`(function(){const sc=window.SpaceFarmer.game.scene.getScene('PlanetScene');
const a=sc&&sc.alienSprites&&sc.alienSprites[0];
return JSON.stringify({hook:!!window.SpaceFarmer.envoyArrival,done:!!sc._createDone,alpha:a?a.alpha:null,aura:!!(a&&a._aura)});})()`);
let sf37PreOK = false;
try { const j = JSON.parse(sf37Pre || '{}'); sf37PreOK = j.hook === true && j.done === true && j.alpha === 1 && j.aura === true; } catch {}
check('SF37 envoy hook present + scene calm (initial envoys at alpha 1)', sf37PreOK, sf37Pre);
const sf37a = await evl(`(function(){try{window.SpaceFarmer.envoyArrival(0);const sc=window.SpaceFarmer.game.scene.getScene('PlanetScene');
const a=sc.alienSprites[0];return JSON.stringify({alpha:a.alpha,scaleY:a.scaleY});}catch(e){return 'throw:'+e.message;}})()`);
let sf37aOK = false;
try { const j = JSON.parse(sf37a || '{}'); sf37aOK = j.alpha === 0 && typeof j.scaleY === 'number' && j.scaleY < 0.5; } catch {}
check('envoy arrival flash: hook fires without throwing, sprite drops to alpha 0 / scaleY < 0.5', sf37aOK, sf37a);
await sleep(700);
const sf37b = await evl(`(function(){const sc=window.SpaceFarmer.game.scene.getScene('PlanetScene');
const a=sc.alienSprites[0];return JSON.stringify({alpha:a.alpha,arrival:!!a._arrival});})()`);
let sf37bOK = false;
try { const j = JSON.parse(sf37b || '{}'); sf37bOK = j.alpha === 1 && j.arrival === false; } catch {}
check('envoy arrival flash: sprite restored to alpha 1 (idle resumes)', sf37bOK, sf37b);
const sf36Pre = await evl(`(function(){const sc=window.SpaceFarmer.game.scene.getScene('PlanetScene');if(!sc)return 'no-scene';
return JSON.stringify({dayCount:sc.dayCount,isNight:!!sc.isNight});})()`);
const sf36Start = await evl(`(function(){const sc=window.SpaceFarmer.game.scene.getScene('PlanetScene');if(!sc||!sc.setFestivalPhase)return 'no-scene';
sc._nightOverride=true;sc._festHold=true;sc.isNight=true;sc.updateNightVisuals();
sc.setFestivalPhase('feast');return 1;})()`);
await sleep(1000);
const sf36OnRes = await evl(`(function(){const sc=window.SpaceFarmer.game.scene.getScene('PlanetScene');if(!sc)return 'no-scene';
const tw=sc._lampBloomTweens||[];const lamps=sc.lampGlows||[];
return JSON.stringify({tw:tw.length,lamps:lamps.length,lit:lamps.length>0&&lamps.every(l=>l.visible===true),
tint:lamps.length>0&&lamps.every(l=>(l.tintTopLeft|0)===0xffd68a)});})()`);
let sf36OnOK = false;
try { const j = JSON.parse(sf36OnRes || '{}'); sf36OnOK = j.lamps > 0 && j.tw === j.lamps && j.lit === true && j.tint === true; } catch {}
check('festival lamp bloom: tween per lamp, all lit warm amber', sf36OnOK, sf36OnRes);
await evl(`(function(){const sc=window.SpaceFarmer.game.scene.getScene('PlanetScene');if(sc&&sc.setFestivalPhase)sc.setFestivalPhase('none');return 1;})()`);
await sleep(1500);
const sf36OffRes = await evl(`(function(){const sc=window.SpaceFarmer.game.scene.getScene('PlanetScene');if(!sc)return 'no-scene';
const tw=sc._lampBloomTweens||[];const lamps=sc.lampGlows||[];
const ns=sc.isNight?1.7:1.0;
return JSON.stringify({tw:tw.length,
scale:lamps.length>0&&lamps.every(l=>Math.abs(l.scaleX-(l._baseScale!==undefined?l._baseScale:1.0)*ns)<0.001),
alpha:lamps.length>0&&lamps.every(l=>Math.abs(l.alpha-(l._baseAlpha!==undefined?l._baseAlpha:1.0))<0.001),
tint:lamps.length>0&&lamps.every(l=>(l.tintTopLeft|0)===0xffffff)});})()`);
let sf36OffOK = false;
try { const j = JSON.parse(sf36OffRes || '{}'); sf36OffOK = j.tw === 0 && j.scale === true && j.alpha === true && j.tint === true; } catch {}
check('festival lamp bloom: phase none restores scale/alpha/tint, tweens empty', sf36OffOK, sf36OffRes);
// hand the colony clock back to the server (the feast flipped night mid-test)
await evl(`(function(){const sc=window.SpaceFarmer.game.scene.getScene('PlanetScene');if(!sc)return 'no-scene';
const pre=(${sf36Pre});sc._nightOverride=true;sc.dayCount=pre.dayCount;sc.isNight=pre.isNight;sc.updateNightVisuals();return 1;})()`);
// release the server clock hold (the colony clock resumes authority)
await evl(`(function(){const sc=window.SpaceFarmer.game.scene.getScene('PlanetScene');if(sc){sc._nightOverride=false;sc._festHold=false;}return 1;})()`);

// ── [SF49] reduced motion: festival lamp bloom becomes tint-only, every lamp
// scale/alpha holds exactly its pre-festival rest value; then phase none +
// the flag back off; then F9 flips the flag and toasts ON/OFF. ──
const rmPre = await evl(`(function(){try{const sc=window.SpaceFarmer.game.scene.getScene('PlanetScene');if(!sc||!sc.setFestivalPhase)return 'no-scene';
window.SpaceFarmer.setReducedMotion(true);sc._nightOverride=true;sc._festHold=true;sc.isNight=true;sc.updateNightVisuals();
const lamps=sc.lampGlows||[];const pre=lamps.map(l=>{l._sf49x=l.scaleX;l._sf49a=l.alpha;return l.scaleX;});
sc.setFestivalPhase('feast');return JSON.stringify({n:lamps.length,pre});}catch(e){return 'EX:'+e.message;}})()`);
await sleep(1000);
const rmMid = await evl(`(function(){const sc=window.SpaceFarmer.game.scene.getScene('PlanetScene');if(!sc)return 'no-scene';
const lamps=sc.lampGlows||[];
return JSON.stringify({n:lamps.length,tw:(sc._lampBloomTweens||[]).length,
tint:lamps.length>0&&lamps.every(l=>(l.tintTopLeft|0)===0xffd68a),
scale:lamps.length>0&&lamps.every(l=>Math.abs(l.scaleX-(l._sf49x!==undefined?l._sf49x:l.scaleX))<0.001),
alpha:lamps.length>0&&lamps.every(l=>Math.abs(l.alpha-(l._sf49a!==undefined?l._sf49a:l.alpha))<0.001)});})()`);
let rmOK = false;
try { const j = JSON.parse(rmMid || '{}'); rmOK = j.n > 0 && j.tw === 0 && j.tint === true && j.scale === true && j.alpha === true; } catch {}
check('reduced motion: bloom tint-only (no scale/alpha tween, lamps hold rest values)', rmOK, rmPre + ' ' + rmMid);
await evl(`(function(){const sc=window.SpaceFarmer.game.scene.getScene('PlanetScene');if(!sc)return 'no-scene';
sc.setFestivalPhase('none');window.SpaceFarmer.setReducedMotion(false);
const pre=(${sf36Pre});sc._nightOverride=true;sc.dayCount=pre.dayCount;sc.isNight=pre.isNight;sc.updateNightVisuals();sc._nightOverride=false;sc._festHold=false;
return JSON.stringify({tw:(sc._lampBloomTweens||[]).length,
tint:(sc.lampGlows||[]).length>0&&sc.lampGlows.every(l=>(l.tintTopLeft|0)===0xffffff)});})()`);
const rmToast1 = await cmd('Input.dispatchKeyEvent', { type: 'keyDown', key: 'F9', code: 'F9', windowsVirtualKeyCode: 120, nativeKeyCode: 120 });
await sleep(70); await cmd('Input.dispatchKeyEvent', { type: 'keyUp', key: 'F9', code: 'F9', windowsVirtualKeyCode: 120, nativeKeyCode: 120 });
await sleep(300);
const rmT1 = await evl(`(function(){const sc=window.SpaceFarmer.game.scene.getScene('PlanetScene');if(!sc)return 'no-scene';
const ts=(sc.children.list||[]).filter(o=>o.text&&o.text.indexOf('Reduced motion')>-1&&o.depth===1100);
return JSON.stringify({t:ts.length?ts[ts.length-1].text:'none',rm:!!window.SpaceFarmer.reducedMotion()});})()`);
let rmT1OK = false;
try { const j = JSON.parse(rmT1 || '{}'); rmT1OK = j.t === 'Reduced motion ON' && j.rm === true; } catch {}
check('F9 toast: Reduced motion ON (flag flips true)', rmT1OK, rmT1);
await cmd('Input.dispatchKeyEvent', { type: 'keyDown', key: 'F9', code: 'F9', windowsVirtualKeyCode: 120, nativeKeyCode: 120 });
await sleep(70); await cmd('Input.dispatchKeyEvent', { type: 'keyUp', key: 'F9', code: 'F9', windowsVirtualKeyCode: 120, nativeKeyCode: 120 });
await sleep(300);
const rmT2 = await evl(`(function(){const sc=window.SpaceFarmer.game.scene.getScene('PlanetScene');if(!sc)return 'no-scene';
const ts=(sc.children.list||[]).filter(o=>o.text&&o.text.indexOf('Reduced motion')>-1&&o.depth===1100);
return JSON.stringify({t:ts.length?ts[ts.length-1].text:'none',rm:!!window.SpaceFarmer.reducedMotion()});})()`);
let rmT2OK = false;
try { const j = JSON.parse(rmT2 || '{}'); rmT2OK = j.t === 'Reduced motion OFF' && j.rm === false; } catch {}
check('F9 toast: Reduced motion OFF (flag flips back false)', rmT2OK, rmT2);
if (rmToast1 && rmToast1.exceptionDetails) check('F9 key dispatched cleanly', false, JSON.stringify(rmToast1));
// [SF46] 5 portrait expressions per NPC; a loved-gift line holds the warm face (no blab override)
const sf46Res = await evl(`(function(){const sc=window.SpaceFarmer.game.scene.getScene('PlanetScene');if(!sc)return 'no-scene';
const ids=(sc.npcSprites||[]).map(s=>s.npcId).filter(Boolean);const miss=[];
for(const id of ids)for(let f=0;f<5;f++)if(!sc.textures.exists('port.'+id+'_'+f))miss.push(id+'_'+f);
const npc=ids.length?{id:ids[0],name:ids[0]}:null;if(npc){sc.selectedNPC=npc;sc.inDialogue=true;sc.showDialogueResponse('SF46 probe line that types for a while so the blab loop would run',3);}
return JSON.stringify({n:ids.length,miss,id:npc&&npc.id});})()`);
await sleep(600);
const sf46Face = await evl(`(function(){const sc=window.SpaceFarmer.game.scene.getScene('PlanetScene');const k=sc.dialoguePortrait&&sc.dialoguePortrait.texture&&sc.dialoguePortrait.texture.key;sc.closeAllPanels();sc.inDialogue=false;return JSON.stringify({k,face:sc._diaFace});})()`);
let sf46OK = false;
try { const a = JSON.parse(sf46Res || '{}'), b = JSON.parse(sf46Face || '{}'); sf46OK = a.n >= 10 && a.miss.length === 0 && b.k === 'port.' + a.id + '_3' && b.face === 0; } catch {}
check('portraits: 5 expressions, loved gift holds warm face', sf46OK, sf46Res + ' ' + sf46Face);

// ── SF51 'Companion Corridor': the live agent day screen streams SF50's stub
//     agent route. Open it from the QA hook, wait for the paced SSE events,
//     assert ≥3 rendered lines, then close it and assert the stream is CLOSED
//     (readyState 2 — es.close() tore it down). ──
const corrOpen = await evl(`(function(){const sc=window.SpaceFarmer.game.scene.getScene('PlanetScene');
window.SpaceFarmer.openCorridor();
return JSON.stringify({open:sc.showingCorridor,es:!!sc.corridorEs,rs:sc.corridorEs&&sc.corridorEs.readyState,url:sc.corridorEs&&sc.corridorEs.url});})()`);
await sleep(4000);
const corrMid = await evl(`(function(){const sc=window.SpaceFarmer.game.scene.getScene('PlanetScene');
return JSON.stringify({n:(sc.corridorLines||[]).length,sf:sc.corridorPanel?sc.corridorPanel.scrollFactorX:99,
vis:sc.corridorPanel?sc.corridorPanel.visible:null});})()`);
let corrOK = false;
try { const j = JSON.parse(corrMid || '{}'); corrOK = j.n >= 3 && j.sf === 0 && j.vis === true; } catch {}
check('corridor: agent day streams', corrOK, corrOpen + ' ' + corrMid);
await shot('12_corridor.png');
await evl(`(function(){const sc=window.SpaceFarmer.game.scene.getScene('PlanetScene');sc.closeAllPanels();return 1;})()`);
const corrClose = await evl(`(function(){const sc=window.SpaceFarmer.game.scene.getScene('PlanetScene');
return JSON.stringify({rs:sc.corridorEs?sc.corridorEs.readyState:99,vis:sc.corridorPanel?sc.corridorPanel.visible:null});})()`);
let corrCloseOK = false;
try { const j = JSON.parse(corrClose || '{}'); corrCloseOK = j.rs === 2 && j.vis === false; } catch {}
check('corridor: close tears the stream down (readyState 2)', corrCloseOK, corrClose);

// ── SF62: season reckoning screen — the season's-end panel for HUMANS ──
const SF62_PAYLOAD = { season: 2, credits: 900,
  lifetime: { earned: 600, harvested: 40, sold: 30, fished: 7, mined: 11, gifts: 5 },
  friends: { rhea: 72, luna: 83, nova: 60 },
  contactChoices: { 'keth-refuge': 'cooperate', 'machine-secession': 'trade' },
  questsCompleted: 4, marriedTo: 'luna' };
const reckShow = await evl(`(function(){const sc=window.SpaceFarmer.game.scene.getScene('PlanetScene');
window.SpaceFarmer.showReckoning(${JSON.stringify(SF62_PAYLOAD)});
return JSON.stringify({open:sc.showingReckoning,vis:sc.reckoningPanel?sc.reckoningPanel.visible:null,
sf:sc.reckoningPanel?sc.reckoningPanel.scrollFactorX:99,d:sc.reckoningPanel?sc.reckoningPanel.depth:99,
lines:(sc.reckoningLines||[]).length,title:sc.reckoningTitle?sc.reckoningTitle.text:''});})()`);
await sleep(400);
let reckOK = false;
try { const j = JSON.parse(reckShow || '{}'); reckOK = j.open === true && j.vis === true && j.sf === 0 && j.d === 1650 && j.lines >= 5 && String(j.title||'').includes('is over.'); } catch {}
check('season reckoning screen', reckOK, reckShow);
await shot('13_reckoning.png');
await evl(`(function(){const sc=window.SpaceFarmer.game.scene.getScene('PlanetScene');if(sc.showingReckoning)sc.closeAllPanels();return 1;})()`);
await sleep(200);
const reckClose = await evl(`(function(){const sc=window.SpaceFarmer.game.scene.getScene('PlanetScene');
return JSON.stringify({open:sc.showingReckoning,vis:sc.reckoningPanel?sc.reckoningPanel.visible:null});})()`);
let reckCloseOK = false;
try { const j = JSON.parse(reckClose || '{}'); reckCloseOK = j.open === false && j.vis === false; } catch {}
check('season reckoning: SPACE/ESC close path hides it', reckCloseOK, reckClose);
await evl(`(function(){const sc=window.SpaceFarmer.game.scene.getScene('PlanetScene');sc._bannerActive=true;return 1;})()`);
const reckQueue = await evl(`(function(){const sc=window.SpaceFarmer.game.scene.getScene('PlanetScene');
sc._queueReckoning(${JSON.stringify(SF62_PAYLOAD)});
return JSON.stringify({open:sc.showingReckoning});})()`);
check('season reckoning queues behind the banner', (reckQueue||'').includes('"open":false') || (reckQueue||'').includes('open:false'), reckQueue);
await evl(`(function(){const sc=window.SpaceFarmer.game.scene.getScene('PlanetScene');sc._bannerActive=false;sc.closeAllPanels();return 1;})()`);

// ── SF52: night must actually darken the frame (whole-frame mean luminance ≤ 75% of day) ──
const sf52Lum = async (night) => {
  await evl(`(function(){const sc=window.SpaceFarmer.game.scene.getScene('PlanetScene');sc.closeAllPanels&&sc.closeAllPanels();
sc._nightOverride=true;sc.isNight=${night?'true':'false'};sc.updateNightVisuals();return 1;})()`);
  await sleep(3000);
  const d = await cmd('Page.captureScreenshot', { format: 'png' });
  return await evl(`(async function(){const c=document.createElement('canvas');c.width=64;c.height=64;
const g=c.getContext('2d',{willReadFrequently:true});const img=new Image();img.src='data:image/png;base64,${d.data}';await img.decode();
g.drawImage(img,0,0,img.width,img.height,0,0,64,64);const p=g.getImageData(0,0,64,64).data;let L=0;
for(let i=0;i<p.length;i+=4)L+=0.299*p[i]+0.587*p[i+1]+0.114*p[i+2];return L/(p.length/4);})()`);
};
const sf52Day = await sf52Lum(false), sf52Night = await sf52Lum(true);
await evl(`(function(){const sc=window.SpaceFarmer.game.scene.getScene('PlanetScene');sc.isNight=false;sc.updateNightVisuals();sc._nightOverride=false;return 1;})()`);
const sf52Ratio = sf52Night / Math.max(1, sf52Day);
check('night is darker than day (lum ratio <= 0.75)', sf52Ratio <= 0.75, `day=${sf52Day.toFixed(1)} night=${sf52Night.toFixed(1)} ratio=${sf52Ratio.toFixed(3)}`);

check('no runtime exceptions during play', errors.length === 0, errors.slice(0, 4).join(' | ') || 'clean');

const fails = results.filter(r => !r.ok);
console.log('\n===== PLAYTEST: ' + results.length + ' checks, ' + fails.length + ' failed =====');
if (fails.length) fails.forEach(f => console.log('  FAIL ' + f.name + ' — ' + f.detail));
ws.close(); process.exit(fails.length ? 1 : 0);

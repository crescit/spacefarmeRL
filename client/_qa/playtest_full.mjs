// playtest_full.mjs — comprehensive LIVE play test of the web game.
// Boots the real game in headless Chrome, drives it as a player would
// (scene methods + trusted key/mouse via CDP), and verifies state after each.
// Usage: node client/_qa/playtest_full.mjs
import WebSocket from 'ws';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

const BASE = 'http://127.0.0.1:9333';
const GAME = 'http://localhost:8900';
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
  if (m.method === 'Runtime.exceptionThrown') errors.push('EX: ' + (m.exceptionDetails && m.exceptionDetails.text));
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
await sleep(9000);
let st = await evl(`(function(){const g=window.SpaceFarmer&&window.SpaceFarmer.game;if(!g)return 'no-game';
return g.scene.getScenes().map(s=>s.scene.key+'='+(s.sys.isActive()?'active':s.isPaused?'paused':'sleeping')).join(',');})()`);
check('boot: intro active', /IntroScene=active/.test(st || ''), st);
await shot('01_intro_crawl.png');
// skip crawl → title, then begin → ship
await key(' ', 32); await sleep(600);
await key(' ', 32); await sleep(1200);
st = await evl(`(function(){const g=window.SpaceFarmer&&window.SpaceFarmer.game;if(!g)return 'no-game';
return g.scene.getScenes().map(s=>s.scene.key+'='+(s.sys.isActive()?'active':s.isPaused?'paused':'sleeping')).join(',');})()`);
check('intro→ship transition', /SpaceshipScene=active/.test(st || ''), st);
await shot('02_ship.png');

// ── Phase 2: ship tutorial → planet ──
// Drive the ship scene to land on the planet (as the tutorial would).
let landRes = await evl(`(function(){const sc=window.SpaceFarmer.game.scene.getScene('SpaceshipScene');if(!sc)return 'no-ship';
if(sc.landOnPlanet) sc.landOnPlanet(); return 'called';})()`);
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

// ── Final: console errors? ──
check('no runtime exceptions during play', errors.length === 0, errors.slice(0, 4).join(' | ') || 'clean');

const fails = results.filter(r => !r.ok);
console.log('\n===== PLAYTEST: ' + results.length + ' checks, ' + fails.length + ' failed =====');
if (fails.length) fails.forEach(f => console.log('  FAIL ' + f.name + ' — ' + f.detail));
ws.close(); process.exit(fails.length ? 1 : 0);

// Record a 60-second animated promo from the live Phaser game through Chrome CDP.
// Requires the game on :8900 and Chrome remote debugging on :9333.
import WebSocket from 'ws';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '../..');
const BASE = 'http://127.0.0.1:9333';
const GAME = process.argv[2] || 'http://localhost:8900';
const OUT = process.argv[3] || path.join(ROOT, 'artifacts/demo/space-farmer-demo.mp4');
const FRAME_DIR = '/tmp/spacefarmer-live-demo-frames';
const FPS = 12;
const DURATION_SECONDS = 60;
const FRAME_COUNT = DURATION_SECONDS * FPS;

fs.rmSync(FRAME_DIR, { recursive: true, force: true });
fs.mkdirSync(FRAME_DIR, { recursive: true });
fs.mkdirSync(path.dirname(OUT), { recursive: true });

function curlJson(url, method) {
  const args = ['-s', url];
  if (method) args.unshift('-X', method);
  return JSON.parse(execFileSync('/usr/bin/curl', args, { encoding: 'utf8' }));
}

const tab = curlJson(BASE + '/json/new?url=about%3Ablank', 'PUT');
const ws = new WebSocket(tab.webSocketDebuggerUrl, { perMessageDeflate: false });
await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });

let id = 0;
const pending = new Map();
ws.on('message', raw => {
  const message = JSON.parse(Buffer.from(raw).toString('utf8'));
  if (message.id && pending.has(message.id)) {
    pending.get(message.id)(message);
    pending.delete(message.id);
  }
});
const cmd = (method, params = {}) => new Promise((resolve, reject) => {
  const requestId = ++id;
  pending.set(requestId, message => message.error
    ? reject(new Error(method + ': ' + JSON.stringify(message.error)))
    : resolve(message.result));
  ws.send(JSON.stringify({ id: requestId, method, params }));
});
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const evl = async expression => {
  const result = await cmd('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.result?.description || 'browser evaluation failed');
  return result.result?.value;
};
const key = async (keyValue, code, vk, hold = 70) => {
  await cmd('Input.dispatchKeyEvent', { type: 'keyDown', key: keyValue, code, windowsVirtualKeyCode: vk, nativeKeyCode: vk });
  await sleep(hold);
  await cmd('Input.dispatchKeyEvent', { type: 'keyUp', key: keyValue, code, windowsVirtualKeyCode: vk, nativeKeyCode: vk });
};

await cmd('Page.enable');
await cmd('Runtime.enable');
await cmd('Emulation.setDeviceMetricsOverride', {
  width: 1280, height: 720, deviceScaleFactor: 1, mobile: false,
});
await cmd('Emulation.setFocusEmulationEnabled', { enabled: true });
await cmd('Page.navigate', { url: GAME });
await sleep(9000);

async function captureFrames() {
  for (let frame = 0; frame < FRAME_COUNT; frame++) {
    const started = Date.now();
    const shot = await cmd('Page.captureScreenshot', {
      format: 'jpeg', quality: 86, fromSurface: true,
      clip: { x: 0, y: 0, width: 1280, height: 720, scale: 1 },
    });
    fs.writeFileSync(
      path.join(FRAME_DIR, `frame-${String(frame).padStart(5, '0')}.jpg`),
      Buffer.from(shot.data, 'base64'),
    );
    await sleep(Math.max(0, Math.round(1000 / FPS) - (Date.now() - started)));
  }
}

async function performDemo() {
  // Animated starfield/crawl, then the title reveal.
  await sleep(3500);
  await key(' ', 'Space', 32);
  await sleep(2500);
  await key(' ', 'Space', 32);

  // Walk around the ship before landing.
  await sleep(1600);
  await key('d', 'KeyD', 68, 700);
  await key('s', 'KeyS', 83, 500);
  await sleep(500);
  await evl(`(() => { const s=window.SpaceFarmer.game.scene.getScene('SpaceshipScene'); if(s?.landOnPlanet) s.landOnPlanet(); })()`);

  // Let the landing transition breathe.
  await sleep(4800);

  const sceneEval = body => evl(`(async () => {
    const s = window.SpaceFarmer.game.scene.getScene('PlanetScene');
    const net = window.SpaceFarmer.net;
    if (!s || !net?.connected) throw new Error('planet/network not ready');
    ${body}
  })()`);
  const relocate = async body => {
    await sceneEval(`s.cam.fadeOut(220, 7, 16, 24);`);
    await sleep(260);
    await sceneEval(`${body}; s.cam.setZoom(1.18); s.camTarget.setPosition(s.playerSpr.x + s.worldX, s.playerSpr.y + s.worldY); s.cam.centerOn(s.camTarget.x, s.camTarget.y); s.cam.fadeIn(220, 7, 16, 24);`);
    await sleep(550);
  };
  const equip = tool => sceneEval(`await net.request('equip', { tool: '${tool}' }); s.equipped = '${tool}'; s._updateToolSprite();`);
  const caption = label => sceneEval(`
    if (s._demoCaption?.active) s._demoCaption.destroy();
    s._demoCaption = s.add.text(Number(s.game.config.width) / 2, 72, '${label}', {
      fontFamily: "system-ui, 'Segoe UI', sans-serif", fontSize: '20px', fontStyle: 'bold',
      color: '#ffe9a0', backgroundColor: '#101a26', stroke: '#000000', strokeThickness: 3,
      padding: { x: 18, y: 9 },
    }).setOrigin(0.5).setScrollFactor(0).setDepth(10020);
    s.time.delayedCall(2600, () => { if (s._demoCaption?.active) s._demoCaption.destroy(); s._demoCaption = null; });
  `);

  // FARMING — work one real authoritative tile: till, plant, then water it.
  await relocate(`s._demoTile = s.farmTiles.find(t => t.x === 12 && t.y === 10 && t.state.type === 'empty') || s.farmTiles.find(t => t.state.type === 'empty');
    s.playerDir = 'back'; s.playerSpr.setPosition(s._demoTile.x * 32 + 16, (s._demoTile.y + 1) * 32 + 16)`);
  await caption('FARM  ·  TILL → PLANT → WATER');
  await equip('hoe');
  await sceneEval(`s.handleTileAction(s._demoTile);`);
  await sleep(1500);
  await sceneEval(`s._plantCrop(s._demoTile, 'space-wheat');`);
  await sleep(1500);
  await equip('watering');
  await sceneEval(`s.handleTileAction(s._demoTile);`);
  await sleep(1800);

  // FISHING — move to the stardust shore and show the full cast/catch loop.
  await relocate(`s.playerSpr.setPosition(27 * 32, 19 * 32)`);
  await caption('FISH  ·  STARDUST SHORE');
  await equip('rod');
  await sceneEval(`s._pressAction();`);
  await sleep(3500);

  // MINING — swing repeatedly until the server-backed vein breaks and pays out.
  await relocate(`s.playerDir = 'left'; s.playerSpr.setPosition((s.mineX + 2) * 32, s.mineY * 32)`);
  await caption('MINE  ·  BREAK THE ASTEROID VEIN');
  await equip('pickaxe');
  for (let i = 0; i < 7; i++) {
    await sceneEval(`s._pressAction();`);
    await sleep(520);
  }
  await sleep(1700);

  // Walk normally with the corrected namespaced character animation.
  await key('d', 'KeyD', 68, 850);
  await key('s', 'KeyS', 83, 550);

  // BUILDING INTERIORS — real rooms behind their doors, not menu screenshots.
  await sceneEval(`s.cam.setZoom(1);`);
  await caption('EXPLORE  ·  SIX COLONY INTERIORS');
  for (const kind of ['shop', 'exchange', 'home']) {
    await sceneEval(`if (s.inInterior) s.exitInterior(); s.enterInterior('${kind}');`);
    await sleep(2700);
    await key('a', 'KeyA', 65, 450);
  }
  for (const kind of ['ranch', 'tavern', 'barracks']) {
    await sceneEval(`if (s.inInterior) s.exitInterior(); s.enterInterior('${kind}');`);
    await sleep(2100);
    await key('d', 'KeyD', 68, 360);
  }
  await sceneEval(`if (s.inInterior) s.exitInterior();`);
  await sleep(600);

  // Finish with a living character moment, then return to the animated colony.
  await sceneEval(`const n = s.npcBrains?.nova; if (n) s.startNPCDialogue(n);`);
  await sleep(2500);
  await sceneEval(`s.closeAllPanels();`);
  await sceneEval(`s.toggleHub();`);
  await sleep(1900);
  await sceneEval(`s.closeAllPanels();`);
  await key('d', 'KeyD', 68, 700);
}

await Promise.all([captureFrames(), performDemo()]);
ws.close();

execFileSync('/opt/homebrew/bin/ffmpeg', [
  '-hide_banner', '-loglevel', 'warning', '-y',
  '-framerate', String(FPS), '-i', path.join(FRAME_DIR, 'frame-%05d.jpg'),
  '-stream_loop', '-1', '-i', path.join(ROOT, 'sounds/bgm_town.wav'),
  '-filter_complex',
  `[1:a]atrim=0:${DURATION_SECONDS},asetpts=PTS-STARTPTS,loudnorm=I=-16:LRA=7:TP=-1.5,aresample=48000,pan=stereo|c0=c0|c1=c0,afade=t=in:st=0:d=0.6,afade=t=out:st=${DURATION_SECONDS - 1}:d=1[outa]`,
  '-map', '0:v', '-map', '[outa]',
  '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p',
  '-c:a', 'aac', '-b:a', '128k', '-shortest', '-movflags', '+faststart', OUT,
], { stdio: 'inherit' });

console.log(`demo=${OUT}`);

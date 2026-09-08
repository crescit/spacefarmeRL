// cdp_key.mjs <url> <setupEvalFile> <keySpec> <stateEvalFile> <shotPng>
// keySpec: "code:Key:kind,code:Key:kind,..." e.g. "49:1:down,49:1:up" — or "-" for none.
// Trusted CDP input dispatch (Input.dispatchKeyEvent) = real-browser key events,
// unlike in-page KeyboardEvent synthesis. Sequence: eval setup -> keys -> wait -> eval state -> shot.
import { readFileSync } from 'node:fs';

const [, , url, setupFile, keySpec, stateFile, outPng] = process.argv;
const PORT = 9333;

const jget = async (p) => (await fetch(`http://127.0.0.1:${PORT}${p}`)).json();

const targets = await jget('/json/list');
const list = Array.isArray(targets) ? targets : (targets.target || []);
let tab = list.find(t => t.type === 'page');
if (!tab) tab = await jget('/json/new?url=' + encodeURIComponent('about:blank'));

const WS = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((res, rej) => { WS.onopen = res; WS.onerror = rej; });

let idc = 0;
const pending = new Map();
const send = (method, params = {}) => new Promise((res, rej) => {
  const id = ++idc; pending.set(id, { res, rej });
  WS.send(JSON.stringify({ id, method, params }));
});
WS.onmessage = (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) {
    const { res, rej } = pending.get(msg.id); pending.delete(msg.id);
    msg.error ? rej(new Error(JSON.stringify(msg.error))) : res(msg.result);
  }
};
const evalIn = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  return r && r.result ? r.result.value : r;
};

await send('Page.enable');
await send('Runtime.enable');
await send('Page.navigate', { url });
await new Promise(r => setTimeout(r, 6000));

if (setupFile && setupFile !== '-') {
  const expr = readFileSync(setupFile, 'utf8');
  console.log('SETUP:', JSON.stringify(await evalIn(expr)).slice(0, 300));
  await new Promise(r => setTimeout(r, 250));
}
if (keySpec && keySpec !== '-') {
  for (const spec of keySpec.split(',')) {
    const [codeStr, key, kind] = spec.split(':');
    const keyCode = Number(codeStr);
    const type = kind === 'down' ? 'keyDown' : kind === 'up' ? 'keyUp' : 'keyDown';
    await send('Input.dispatchKeyEvent', { type, key, code: key === ' ' ? 'Space' : undefined, keyCode, windowsVirtualKeyCode: keyCode });
    if (kind === 'down') await send('Input.dispatchKeyEvent', { type: 'char', text: key === ' ' ? ' ' : key, unmodifiedText: key });
    await new Promise(r => setTimeout(r, 60));
  }
}
await new Promise(r => setTimeout(r, 900));
if (stateFile && stateFile !== '-') {
  const expr = readFileSync(stateFile, 'utf8');
  console.log('STATE:', JSON.stringify(await evalIn(expr)).slice(0, 1200));
}
if (outPng && outPng !== '-') {
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  const buf = Buffer.from(shot.data, 'base64');
  await (await import('node:fs/promises')).writeFile(outPng, buf);
  console.log('SAVED:', outPng, buf.length, 'bytes');
}
WS.close();

// Tiny Chrome DevTools Protocol driver for headless Edge/Chrome (Node 22+, no dependencies).
import {spawn} from 'node:child_process';
import {mkdtempSync, existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const CANDIDATES = [
  process.env.BROWSER,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean);
const sleep = ms => new Promise(r => setTimeout(r, ms));

export async function launch() {
  const exe = CANDIDATES.find(p => existsSync(p));
  if (!exe) throw new Error('No Chromium-based browser found; set BROWSER=/path/to/chrome');
  const port = 9400 + Math.floor(Math.random() * 400);
  // the throttling flags keep long frame-by-frame captures from stalling (Edge pauses "idle" headless pages)
  const proc = spawn(exe, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), 'cdp-'))}`,
    '--no-first-run', '--hide-scrollbars', '--allow-file-access-from-files', '--font-render-hinting=none',
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
    '--disable-features=CalculateNativeWinOcclusion,IntensiveWakeUpThrottling,msEdgeSleepingTabs,msEfficiencyMode',
    'about:blank'], {stdio: 'ignore'});
  let targets = [];
  for (let i = 0; i < 80 && !targets.length; i++) {
    try { targets = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).filter(t => t.type === 'page'); } catch {}
    if (!targets.length) await sleep(250);
  }
  const ws = new WebSocket(targets[0].webSocketDebuggerUrl);
  await new Promise(r => ws.addEventListener('open', r, {once: true}));
  let id = 0; const pending = new Map(); const listeners = new Set();
  ws.addEventListener('message', ev => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { const {res, rej} = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(m.error.message)) : res(m.result); }
    else if (m.method) for (const f of listeners) f(m);
  });
  const send = (method, params = {}, timeout = 0) => new Promise((res, rej) => {
    const i = ++id; pending.set(i, {res, rej}); ws.send(JSON.stringify({id: i, method, params}));
    if (timeout) setTimeout(() => { if (pending.delete(i)) rej(new Error(`${method} timed out`)); }, timeout);
  });
  const evaluate = async expr => {
    const r = await send('Runtime.evaluate', {expression: expr, awaitPromise: true, returnByValue: true}, 30000);
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  };
  await send('Page.enable'); await send('Runtime.enable');
  return {
    send, evaluate,
    on: f => listeners.add(f),
    async goto(url, {width = 1440, height = 900, dpr = 1, mobile = false, dark = false, settle = 700} = {}) {
      await send('Emulation.setDeviceMetricsOverride', {width, height, deviceScaleFactor: dpr, mobile});
      await send('Emulation.setEmulatedMedia', {features: [{name: 'prefers-color-scheme', value: dark ? 'dark' : 'light'}]});
      await send('Page.navigate', {url: 'about:blank'}); await sleep(100);
      let done; const loaded = new Promise(r => { done = r; });
      const f = m => { if (m.method === 'Page.loadEventFired') done(); };
      listeners.add(f);
      await send('Page.navigate', {url});
      await Promise.race([loaded, sleep(10000)]); listeners.delete(f);
      await sleep(settle);
    },
    async png(opts = {}) { return Buffer.from((await send('Page.captureScreenshot', {format: 'png', ...opts})).data, 'base64'); },
    close() { try { ws.close(); } catch {} proc.kill(); },
  };
}
export {sleep};

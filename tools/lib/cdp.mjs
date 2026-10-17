// Tiny Chrome DevTools Protocol driver (no dependencies): launch headless Chrome,
// open a page, evaluate, send trusted key events.
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CANDIDATES = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
].filter(Boolean);

export function findChrome() {
  return CANDIDATES.find((p) => existsSync(p)) || null;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function launch() {
  const bin = findChrome();
  if (!bin) throw new Error('no Chrome/Chromium found (set CHROME_PATH)');
  const dir = mkdtempSync(join(tmpdir(), 'alleycat-chrome-'));
  const proc = spawn(bin, [
    '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${dir}`,
    '--no-first-run', '--no-default-browser-check', '--autoplay-policy=no-user-gesture-required',
    '--mute-audio', 'about:blank',
  ], { stdio: 'ignore' });
  let port = null;
  for (let i = 0; i < 100 && !port; i++) {
    await sleep(100);
    const f = join(dir, 'DevToolsActivePort');
    if (existsSync(f)) port = Number(readFileSync(f, 'utf8').split('\n')[0]);
  }
  if (!port) {
    proc.kill();
    throw new Error('Chrome did not expose a debugging port');
  }
  const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
  const page = targets.find((t) => t.type === 'page');
  const session = await connect(page.webSocketDebuggerUrl);
  return {
    session,
    async close() {
      session.close();
      proc.kill();
      await sleep(200);
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

function connect(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    let id = 0;
    const pending = new Map();
    const listeners = [];
    ws.onmessage = (m) => {
      const msg = JSON.parse(m.data);
      if (msg.id && pending.has(msg.id)) {
        const { res, rej } = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) rej(new Error(msg.error.message));
        else res(msg.result);
      } else if (msg.method) {
        for (const l of listeners) l(msg);
      }
    };
    ws.onerror = (e) => reject(e);
    ws.onopen = () =>
      resolve({
        send(method, params = {}) {
          const n = ++id;
          ws.send(JSON.stringify({ id: n, method, params }));
          return new Promise((res, rej) => pending.set(n, { res, rej }));
        },
        on(fn) {
          listeners.push(fn);
        },
        close() {
          ws.close();
        },
      });
  });
}

const VK = { ArrowUp: 38, ArrowDown: 40, ArrowLeft: 37, ArrowRight: 39, Space: 32, Escape: 27, AltLeft: 18, ControlLeft: 17 };

export async function key(session, code, type) {
  const keyName = code.startsWith('Key') ? code.slice(3).toLowerCase() : code === 'Space' ? ' ' : code;
  const vk = VK[code] || (code.startsWith('Key') ? code.charCodeAt(3) : 0);
  await session.send('Input.dispatchKeyEvent', {
    type, code, key: keyName, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk,
  });
}

export async function evaluate(session, expr) {
  const r = await session.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(`page error: ${r.exceptionDetails.exception?.description || r.exceptionDetails.text}`);
  return r.result.value;
}

export { sleep };

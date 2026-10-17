#!/usr/bin/env node
// Browser acceptance scenario (headless Chrome over CDP). Exercises the real page:
// file loading + hash check, rendering to the canvas, trusted keyboard events through the
// page's own handlers, audio start, IndexedDB persistence, and the strict diagnostic panel.
// Exit code 0 = all checks passed, 1 = a check failed, 2 = setup failure.
import { serve } from './serve.mjs';
import { launch, key, evaluate, sleep } from './lib/cdp.mjs';
import { loadCatExe, SetupError } from './lib/fixtures.mjs';

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
}

async function waitFor(session, expr, timeoutMs = 10000) {
  const end = Date.now() + timeoutMs;
  for (;;) {
    const v = await evaluate(session, expr).catch(() => undefined);
    if (v) return v;
    if (Date.now() > end) return null;
    await sleep(50);
  }
}

async function tap(session, code, holdMs = 150) {
  await key(session, code, 'keyDown');
  await sleep(holdMs);
  await key(session, code, 'keyUp');
}

async function main() {
  try {
    loadCatExe();
  } catch (e) {
    if (e instanceof SetupError) {
      console.error(`SETUP FAILURE: ${e.message}`);
      process.exit(2);
    }
    throw e;
  }
  const server = await serve(0);
  const base = `http://127.0.0.1:${server.address().port}/`;
  const chrome = await launch();
  const s = chrome.session;
  const consoleErrors = [];
  s.on((m) => {
    if (m.method === 'Runtime.exceptionThrown') consoleErrors.push(m.params.exceptionDetails.text);
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
      consoleErrors.push(m.params.args.map((a) => a.value ?? a.description).join(' '));
    }
  });
  await s.send('Runtime.enable');
  await s.send('Page.enable');
  try {
    // 1. wrong file is rejected with a message
    await s.send('Page.navigate', { url: `${base}?exe=/index.html` });
    const msg = await waitFor(s, `document.getElementById('loader-msg')?.textContent`);
    check('rejects a file that is not CAT.EXE', /unrecognised file/.test(msg || ''), msg || 'no message');

    // 2. load the original and reach the title screen
    await s.send('Page.navigate', { url: `${base}?exe=/game/CAT.EXE&seed=1234` });
    const ok = await waitFor(s, `!!globalThis.__alleycat && __alleycat.game.clock.ms() > 1500`);
    check('loads CAT.EXE and runs the title screen', !!ok);
    const pix = await evaluate(s, `(() => {
      const c = document.getElementById('screen').getContext('2d').getImageData(0,0,320,200).data;
      const set = new Set(); for (let i = 0; i < c.length; i += 4) set.add(c[i] << 16 | c[i+1] << 8 | c[i+2]);
      return set.size; })()`);
    check('canvas shows the CGA title (4 colours)', pix === 4, `${pix} distinct colours`);

    // 3. real keyboard events: dismiss title, menu N, skill K, start
    await tap(s, 'Space');
    await waitFor(s, `__alleycat.game.rw(0x6d8f) === 2`, 5000);
    await tap(s, 'KeyN');
    await waitFor(s, `__alleycat.game.rw(0x6d8f) >= 0x0c`, 5000);
    await tap(s, 'KeyK');
    await sleep(300);
    await tap(s, 'Space');
    const inAlley = await waitFor(s, `__alleycat.game.rb(0x1f80) === 3 && __alleycat.game.rw(0x4) === 0 && __alleycat.game.rw(0x579) <= 8`, 8000);
    check('menu accepted keys; game started in the alley with 3 lives', !!inAlley);
    const audioState = await waitFor(s, `__alleycat.audio.ctx && __alleycat.audio.ctx.state === 'running' && __alleycat.audio.ctx.state`, 3000);
    check('a key press started the speaker audio (AudioContext running)', audioState === 'running', String(audioState));

    // 4. hold Right: the cat must walk
    const x0 = await evaluate(s, `__alleycat.game.rw(0x579)`);
    await key(s, 'ArrowRight', 'keyDown');
    await sleep(1500);
    await key(s, 'ArrowRight', 'keyUp');
    const x1 = await evaluate(s, `__alleycat.game.rw(0x579)`);
    check('ArrowRight moves the cat', x1 > x0 + 40, `x ${x0} -> ${x1}`);

    // 5. jump: y decreases then the cat lands again
    const y0 = await evaluate(s, `__alleycat.game.rb(0x57b)`);
    await key(s, 'ArrowUp', 'keyDown');
    const minY = await (async () => {
      let m = 999;
      const end = Date.now() + 1200;
      while (Date.now() < end) {
        m = Math.min(m, await evaluate(s, `__alleycat.game.rb(0x57b)`));
        await sleep(20);
      }
      return m;
    })();
    await key(s, 'ArrowUp', 'keyUp');
    check('ArrowUp makes the cat jump', minY < y0 - 10, `y ${y0}, min ${minY}`);

    // 6. sound toggle via the on-screen button (Ctrl+S)
    const snd0 = await evaluate(s, `__alleycat.game.rb(0)`);
    await evaluate(s, `document.querySelector('[data-combo="ControlLeft+KeyS"]').click()`);
    await sleep(400);
    const snd1 = await evaluate(s, `__alleycat.game.rb(0)`);
    check('Sound button toggles the sound switch', snd0 !== snd1, `${snd0} -> ${snd1}`);

    // 6b. a room runs in the page (room forced like the reference scenarios)
    await evaluate(s, `(() => { const g = __alleycat.game; for (let a = 0x421; a <= 0x431; a++) g.wb(a, 3);
      g.ww(0x41d, 0xffff); g.ww(0x41f, 0xffff); g.wb(0x418, 0); g.wb(0x551, 1); return 1; })()`);
    const inRoom = await waitFor(s, `__alleycat.game.rw(4) === 3 && __alleycat.game.rw(0x579) > 0`, 8000);
    await sleep(2000);
    const diag = await evaluate(s, `document.getElementById('diag').hidden ? '' : document.getElementById('diag').textContent`);
    check('room 3 runs in the browser (no diagnostic)', !!inRoom && diag === '', diag.slice(0, 80));

    // 7. page health
    check('no uncaught page errors', consoleErrors.length === 0, consoleErrors.join(' | '));

    // 8. persistence: remember the file, reload without ?exe, it starts by itself
    await evaluate(s, `(async () => {
      const m = await import('/src/ui/storage.js');
      const r = await fetch('/game/CAT.EXE'); await m.storeFile(new Uint8Array(await r.arrayBuffer())); return true; })()`);
    await s.send('Page.navigate', { url: base });
    const resumed = await waitFor(s, `!!globalThis.__alleycat && __alleycat.game.clock.ms() > 500`, 8000);
    check('remembered file restarts the game after reload (IndexedDB)', !!resumed);
    await evaluate(s, `(async () => { const m = await import('/src/ui/storage.js'); await m.forgetFile(); return 1; })()`);
  } finally {
    await chrome.close();
    server.close();
  }
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} browser checks passed`);
  if (results.length === 0 || failed.length) process.exit(1);
}

main().catch((e) => {
  console.error(e.stack || e);
  process.exit(1);
});

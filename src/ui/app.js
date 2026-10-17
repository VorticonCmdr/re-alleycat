// Browser shell: load the user's CAT.EXE, run the simulation against wall-clock time,
// render the CGA screen, play the speaker, forward the keyboard.
//
// Default mode is strict: any original code path that is not ported yet stops the game
// with a diagnostic instead of guessing.

import { identify } from '../machine/exe.js';
import { Game, UnsupportedPath } from '../game/game.js';
import { SCANCODES } from '../machine/keyboard.js';
import { SpeakerAudio } from './audio.js';
import { loadStoredFile, storeFile, forgetFile } from './storage.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);

const MAX_FRAME_MS = 100; // a stalled tab does not fast-forward the game

let game = null;
let audio = null;
let raf = 0;
let lastHost = 0;
let target = 0;
let stopped = false;

function setLoaderMessage(text, isError = false) {
  const el = $('loader-msg');
  el.textContent = text;
  el.classList.toggle('error', isError);
}

async function start(bytes, { remember } = {}) {
  let info;
  try {
    info = await identify(bytes);
  } catch (e) {
    setLoaderMessage(e.message, true);
    return false;
  }
  if (remember) await storeFile(bytes).catch(() => {});
  const options = {};
  if (params.has('seed')) options.rngSeed = parseInt(params.get('seed'), 16);
  if (params.has('cycles')) options.cyclesPerMs = Number(params.get('cycles'));
  game = new Game(info.mz.image, options);
  audio = new SpeakerAudio(game.speaker, game.clock);
  globalThis.__alleycat = { game, info, audio }; // for automated browser checks
  $('loader').hidden = true;
  $('player').hidden = false;
  const canvas = $('screen');
  canvas.focus();
  stopped = false;
  lastHost = performance.now();
  target = game.clock.cycles;
  raf = requestAnimationFrame(frame);
  return true;
}

const ctx2d = () => $('screen').getContext('2d');
let imageData = null;

function render() {
  const ctx = ctx2d();
  if (!imageData) imageData = ctx.createImageData(320, 200);
  game.cga.render(game.mem.vram, imageData.data);
  ctx.putImageData(imageData, 0, 0);
}

function fail(e) {
  stopped = true;
  cancelAnimationFrame(raf);
  const d = $('diag');
  d.hidden = false;
  const kind = e instanceof UnsupportedPath ? 'Stopped: not yet ported' : 'Stopped: internal error';
  d.textContent = `${kind}\n${e.message}\n\nvirtual time ${game.clock.ms().toFixed(0)} ms, room ${game.rw(4)}`;
  if (!(e instanceof UnsupportedPath)) console.error(e);
}

function frame(now) {
  if (stopped) return;
  const dt = Math.min(MAX_FRAME_MS, Math.max(0, now - lastHost));
  lastHost = now;
  target += dt * game.clock.cyclesPerMs;
  try {
    game.runUntil(target);
  } catch (e) {
    render();
    fail(e);
    return;
  }
  if (game.clock.cycles > target) target = game.clock.cycles;
  render();
  audio.pump();
  $('status').textContent = game.exited ? 'Program ended (Ctrl+Y)' : `${(game.clock.ms() / 1000).toFixed(1)} s`;
  if (game.exited) {
    stopped = true;
    return;
  }
  raf = requestAnimationFrame(frame);
}

// ---- keyboard ----
const GAME_KEYS = new Set(Object.keys(SCANCODES));
function onKey(e, down) {
  if (!game || stopped) return;
  if (!GAME_KEYS.has(e.code)) return;
  // keep browser shortcuts from firing while the game has focus
  e.preventDefault();
  if (down && audio) audio.start();
  game.key(e.code, down);
}
window.addEventListener('keydown', (e) => onKey(e, true));
window.addEventListener('keyup', (e) => onKey(e, false));
window.addEventListener('blur', () => {
  // release everything: the game must not see a key stuck down
  if (!game) return;
  for (const code of [...game.keyboard.down]) game.key(code, false);
});

// on-screen buttons for combinations the browser may reserve
for (const b of document.querySelectorAll('[data-combo]')) {
  b.addEventListener('click', () => {
    if (!game || stopped) return;
    audio.start();
    const keys = b.dataset.combo.split('+');
    const cpm = game.clock.cyclesPerMs;
    let t = game.clock.cycles;
    for (const k of keys) game.key(k, true, (t += 20 * cpm));
    for (const k of keys.reverse()) game.key(k, false, (t += 80 * cpm));
    $('screen').focus();
  });
}

// ---- loading ----
async function readFile(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  await start(bytes, { remember: $('remember').checked });
}
$('file').addEventListener('change', (e) => {
  const f = e.target.files[0];
  if (f) readFile(f);
});
const drop = $('drop');
drop.addEventListener('dragover', (e) => {
  e.preventDefault();
  drop.classList.add('over');
});
drop.addEventListener('dragleave', () => drop.classList.remove('over'));
drop.addEventListener('drop', (e) => {
  e.preventDefault();
  drop.classList.remove('over');
  const f = e.dataTransfer.files[0];
  if (f) readFile(f);
});
$('remember').addEventListener('change', (e) => {
  if (!e.target.checked) forgetFile().catch(() => {});
});

// Development/test hook: ?exe=<url> loads a locally served file (never part of the repo).
async function boot() {
  if (params.has('exe')) {
    const res = await fetch(params.get('exe'));
    if (!res.ok) {
      setLoaderMessage(`could not fetch ${params.get('exe')}: ${res.status}`, true);
      return;
    }
    await start(new Uint8Array(await res.arrayBuffer()));
    return;
  }
  const stored = await loadStoredFile().catch(() => null);
  if (stored) {
    $('remember').checked = true;
    setLoaderMessage('Using the file remembered in this browser.');
    await start(stored);
  }
}
boot();

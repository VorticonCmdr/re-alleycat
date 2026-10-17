// Browser shell: load the user's CAT.EXE, run the simulation against wall-clock time,
// render the CGA screen, play the speaker, forward keyboard / touch / gamepad input.
//
// Default mode is strict: any original code path that is not ported stops the game with a
// diagnostic instead of guessing.

import { identify } from '../machine/exe.js';
import { Game, UnsupportedPath } from '../game/game.js';
import { SpeakerAudio } from './audio.js';
import { Controls } from './controls.js';
import { loadStoredFile, storeFile, forgetFile } from './storage.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);

const MAX_FRAME_MS = 100; // a stalled tab does not fast-forward the game

// Machine profiles. "reference" is what every reference scenario is verified against.
export const PROFILES = {
  reference: {
    label: 'DOSBox reference (AT, 3000 cycles/ms)',
    options: { modelId: 0xfc, cyclesPerMs: 3000, retrace: 'vga' },
  },
  ibmpc: {
    label: 'IBM PC/XT 4.77 MHz (approximate, unverified)',
    options: { modelId: 0xff, cyclesPerMs: 300, retrace: 'cga' },
  },
};

// ---- per-viewer preferences (best effort; the page works without storage)
const prefs = (() => {
  const defaults = { profile: 'reference', scale: 'fit', touch: 'auto' };
  try {
    return { ...defaults, ...JSON.parse(localStorage.getItem('alleycat-prefs') || '{}') };
  } catch {
    return defaults;
  }
})();
function savePrefs() {
  try {
    localStorage.setItem('alleycat-prefs', JSON.stringify(prefs));
  } catch {
    /* storage unavailable */
  }
}

let game = null;
let audio = null;
let raf = 0;
let lastHost = 0;
let target = 0;
let stopped = false;
let lastBytes = null;

const controls = new Controls({
  getGame: () => (stopped ? null : game),
  onActivity: () => audio && audio.start(),
});
controls.attachKeyboard();
controls.attachTouch(document);

function setLoaderMessage(text, isError = false) {
  const el = $('loader-msg');
  el.textContent = text;
  el.classList.toggle('error', isError);
}

function gameOptions() {
  const profile = PROFILES[params.get('profile') || prefs.profile] || PROFILES.reference;
  const options = { ...profile.options };
  if (params.has('seed')) options.rngSeed = parseInt(params.get('seed'), 16);
  if (params.has('cycles')) options.cyclesPerMs = Number(params.get('cycles'));
  return options;
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
  lastBytes = bytes;
  cancelAnimationFrame(raf);
  game = new Game(info.mz.image, gameOptions());
  audio = new SpeakerAudio(game.speaker, game.clock);
  globalThis.__alleycat = { game, info, audio }; // for automated browser checks
  $('loader').hidden = true;
  $('player').hidden = false;
  $('diag').hidden = true;
  $('screen').focus();
  stopped = false;
  lastHost = performance.now();
  target = game.clock.cycles;
  raf = requestAnimationFrame(frame);
  return true;
}

let imageData = null;
function render() {
  const ctx = $('screen').getContext('2d');
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
  controls.pollGamepads();
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
  const pad = game.gamePort.isConnected() ? ' · gamepad' : '';
  $('status').textContent = game.exited ? 'Program ended (Ctrl+Y)' : `${(game.clock.ms() / 1000).toFixed(1)} s${pad}`;
  if (game.exited) {
    stopped = true;
    return;
  }
  raf = requestAnimationFrame(frame);
}

// ---- hot-key buttons (browsers reserve some Ctrl shortcuts)
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

// ---- display settings
function applyScale() {
  const wrap = $('screen-wrap');
  wrap.dataset.scale = prefs.scale;
  if (prefs.scale === 'integer') {
    const box = wrap.getBoundingClientRect();
    const avail = Math.max(1, Math.floor(Math.min((box.width - 16) / 320, (window.innerHeight * 0.8) / 240)));
    $('screen').style.width = `${320 * avail}px`;
  } else {
    $('screen').style.width = '';
  }
}
function applyTouch() {
  const coarse = matchMedia('(pointer: coarse)').matches;
  $('touchpad').hidden = !(prefs.touch === 'on' || (prefs.touch === 'auto' && coarse));
}

const profileSel = $('profile');
for (const [id, p] of Object.entries(PROFILES)) profileSel.add(new Option(p.label, id));
profileSel.value = prefs.profile;
profileSel.addEventListener('change', () => {
  prefs.profile = profileSel.value;
  savePrefs();
  if (lastBytes) start(lastBytes); // a profile is a different machine: restart
});
const scaleSel = $('scale');
scaleSel.value = prefs.scale;
scaleSel.addEventListener('change', () => {
  prefs.scale = scaleSel.value;
  savePrefs();
  applyScale();
});
const touchSel = $('touch');
touchSel.value = prefs.touch;
touchSel.addEventListener('change', () => {
  prefs.touch = touchSel.value;
  savePrefs();
  applyTouch();
});
$('fullscreen').addEventListener('click', () => {
  const el = $('screen-wrap');
  if (document.fullscreenElement) document.exitFullscreen();
  else el.requestFullscreen?.().catch(() => {});
  $('screen').focus();
});
window.addEventListener('resize', applyScale);
document.addEventListener('fullscreenchange', applyScale);
applyScale();
applyTouch();

// ---- loading
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

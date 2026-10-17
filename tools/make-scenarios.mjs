#!/usr/bin/env node
// Generates reference scenario manifests (the capture recipes). Existing capture sections
// are kept unless --reset is given.
//   node tools/make-scenarios.mjs [room-3 ...] [--reset]
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './lib/fixtures.mjs';

const LOOP_HEAD = { 1: '03fa', 2: '0478', 3: '03b2', 4: '0364', 5: '0319', 6: '02c5', 7: '027e' };
// Sound-only variables written from PIT ch0 samples, which captures do not record
// (CS:5ac2 landing thud, CS:5a1c hit sound). See docs/RE_NOTES.md "PIT-derived state".
export const PIT_EXCLUDE = [
  { from: '5a0e', to: '5a10', reason: 'CS:5ac2 stores a PIT ch0 sample (sound timing only)' },
  { from: '5a12', to: '5a14', reason: 'CS:5ac2 sweep value advanced per PIT-timed step (sound only)' },
  { from: '5a16', to: '5a1a', reason: 'CS:5a1c PIT sample and retune counter (sound only)' },
  { from: '5a3c', to: '5a40', reason: 'CS:5a1c sweep accumulators advanced per PIT-timed retune (sound only)' },
];
const EXE = { file: 'CAT.EXE', sha256: '4979c8867826e08881d1d4bec95c95d6bc1ac70fd21050ccdb4f733a50d7bfdd' };
const EMU = { name: 'dosbox-automation', machine: 'svga_s3', cpu_cycles: 3000, core: 'auto', launch: 'C:\\CAT.EXE from the shell, C: = game/ (read-only), PSP 01E5' };

function intro(ev, skillKey = 'KeyK') {
  const key = (site, count, code, down) => ev.push({ type: 'key', site, count, code, down });
  ev.push({ type: 'checkpoint', site: '5d71', count: 1 });
  key('5d71', 200, 'Space', true);
  key('5ef7', 5, 'Space', false);
  key('5ef7', 50, 'KeyN', true);
  key('5f29', 10, 'KeyN', false);
  key('5f29', 50, skillKey, true);
  key('5faa', 10, skillKey, false);
  key('5faa', 50, 'Space', true);
  key('0155', 5, 'Space', false);
}

function roomScenario(n) {
  const ev = [];
  intro(ev);
  const site = LOOP_HEAD[n];
  ev.push({ type: 'checkpoint', site: '0155', count: 59 });
  // force the next window entry into room n (conditional evidence: state injection)
  ev.push({ type: 'poke', site: '0155', count: 60, addr: '0421', bytes: String(n).padStart(2, '0').repeat(17), note: 'room-choice tables' });
  ev.push({ type: 'poke', site: '0155', count: 60, addr: '041d', bytes: 'ffffffff', note: 'last two rooms' });
  ev.push({ type: 'poke', site: '0155', count: 60, addr: '0418', bytes: '00' });
  ev.push({ type: 'poke', site: '0155', count: 60, addr: '0551', bytes: '01', note: 'entered a window' });
  for (let c = 1; c <= 1601; c += 100) ev.push({ type: 'checkpoint', site, count: c });
  ev.push({ type: 'key', site, count: 300, code: 'ArrowRight', down: true });
  ev.push({ type: 'key', site, count: 700, code: 'ArrowRight', down: false });
  ev.push({ type: 'key', site, count: 800, code: 'ArrowUp', down: true });
  ev.push({ type: 'key', site, count: 830, code: 'ArrowUp', down: false });
  ev.push({ type: 'key', site, count: 1000, code: 'ArrowLeft', down: true });
  ev.push({ type: 'key', site, count: 1300, code: 'ArrowLeft', down: false });
  ev.sort((a, b) => 0);
  return {
    id: `room-${n}`,
    description: `Intro, then room ${n} forced at alley pass 60; walk right, jump, walk left inside the room.`,
    exe: EXE,
    emulator: EMU,
    startState: 'program entry CS:0000 after a clean launch; environment values come from the capture stream',
    keyInjection: 'at sync points, by writing the memory effects of the game INT 9 handler (CS:14b3)',
    stateInjection: 'room choice forced by overwriting DS:0421-0431 and DS:041d-0420 and setting DS:0551 at alley pass 60 (same bytes written in capture and replay)',
    compare: {
      ds: '0000..7130 (data segment; code segment excluded)',
      vram: '0000..4000',
      dsExclude: PIT_EXCLUDE,
    },
    verify: `npm run verify -- --only=reference   (single: node tests/reference.mjs --scenario=room-${n})`,
    events: ev,
  };
}

const poke = (ev, site, count, addr, bytes, note) => ev.push({ type: 'poke', site, count, addr, bytes, ...(note ? { note } : {}) });
const forceRoom = (ev, count, n) => {
  poke(ev, '0155', count, '0421', String(n).padStart(2, '0').repeat(17), 'room-choice tables');
  poke(ev, '0155', count, '041d', 'ffffffff', 'last two rooms');
  poke(ev, '0155', count, '0418', '00');
  poke(ev, '0155', count, '0551', '01', 'entered a window');
};
const common = (id, description, ev, extra = {}) => ({
  id, description, exe: EXE, emulator: EMU,
  startState: 'program entry CS:0000 after a clean launch; environment values come from the capture stream',
  keyInjection: 'at sync points, by writing the memory effects of the game INT 9 handler (CS:14b3)',
  stateInjection: 'room choice and room outcomes forced by memory writes at sync points (same bytes written in capture and replay); see poke events',
  compare: { ds: '0000..7130 (data segment; code segment excluded)', vram: '0000..4000', dsExclude: PIT_EXCLUDE },
  verify: `npm run verify -- --only=reference   (single: node tests/reference.mjs --scenario=${id})`,
  maxTicks: 6000,
  ...extra,
  events: ev,
});

function exitsScenario() {
  const ev = [];
  intro(ev, 'KeyH'); // skill 1, so the dog-bite path (CS:5be0) is reachable
  forceRoom(ev, 60, 3);
  for (let c = 50; c <= 200; c += 50) ev.push({ type: 'checkpoint', site: '03b2', count: c });
  poke(ev, '03b2', 200, '0553', '01', 'room 3 solved -> bonus animation CS:38b0');
  for (let c = 70; c <= 115; c += 15) ev.push({ type: 'checkpoint', site: '0155', count: c });
  forceRoom(ev, 120, 1);
  for (let c = 50; c <= 150; c += 50) ev.push({ type: 'checkpoint', site: '03fa', count: c });
  poke(ev, '03fa', 150, '0554', '01', 'fish bowl reached -> room 2');
  for (let c = 50; c <= 200; c += 50) ev.push({ type: 'checkpoint', site: '0478', count: c });
  poke(ev, '0478', 200, '0552', 'dd', 'thrown out by the dog -> bite animation CS:5be0');
  for (let c = 140; c <= 215; c += 15) ev.push({ type: 'checkpoint', site: '0155', count: c });
  poke(ev, '0155', 220, '1f80', '01', 'one life left');
  forceRoom(ev, 240, 5);
  for (let c = 25; c <= 100; c += 25) ev.push({ type: 'checkpoint', site: '0319', count: c });
  poke(ev, '0319', 100, '0552', '01', 'thrown out on the last life -> game over');
  for (let c = 220; c <= 280; c += 20) ev.push({ type: 'checkpoint', site: '5d71', count: c });
  return common('room-exits', 'Room exits: room 3 solved (bonus), room 1 -> room 2 via the fish bowl, dog bite, last life lost -> attract title.', ev);
}

function room7WinScenario() {
  const ev = [];
  intro(ev);
  forceRoom(ev, 60, 7);
  for (let c = 50; c <= 300; c += 50) ev.push({ type: 'checkpoint', site: '027e', count: c });
  poke(ev, '027e', 300, '0553', '01', 'room 7 solved -> CS:528b and CS:5313');
  for (let c = 70; c <= 400; c += 15) ev.push({ type: 'checkpoint', site: '0155', count: c });
  return common('room7-win', 'Room 7 solved: win sequences CS:528b and CS:5313, back to the alley.', ev);
}

function hotkeysScenario() {
  const ev = [];
  intro(ev, 'KeyT'); // skill 2
  const key = (site, count, code, down) => ev.push({ type: 'key', site, count, code, down });
  const cp = (site, count, extra) => ev.push({ type: 'checkpoint', site, count, ...(extra || {}) });
  cp('0155', 90);
  key('0155', 100, 'Escape', true); // pause: INT 1Ah AH=0 save, box, wait at CS:5faa
  cp('5faa', 60, { vram: false });
  key('5faa', 70, 'Escape', false);
  key('5faa', 90, 'Space', true); // resume: screen restored, INT 1Ah AH=1
  key('0155', 102, 'Space', false);
  cp('0155', 105);
  for (let c = 120; c <= 300; c += 60) cp('0155', c);
  key('0155', 310, 'ControlLeft', true); // Ctrl+S: sound off
  key('0155', 312, 'KeyS', true);
  key('0155', 314, 'KeyS', false);
  key('0155', 316, 'ControlLeft', false);
  key('0155', 330, 'ArrowRight', true);
  key('0155', 900, 'ArrowRight', false);
  key('0155', 950, 'ArrowUp', true);
  key('0155', 980, 'ArrowUp', false);
  for (let c = 320; c <= 1200; c += 80) cp('0155', c);
  key('0155', 1210, 'ControlLeft', true); // Ctrl+R: restart
  key('0155', 1212, 'KeyR', true);
  key('0155', 1214, 'KeyR', false);
  key('0155', 1216, 'ControlLeft', false);
  for (let c = 1230; c <= 1400; c += 85) cp('0155', c);
  key('0155', 1410, 'ControlLeft', true); // Ctrl+M: back to the menu
  key('0155', 1412, 'KeyM', true);
  key('5ef7', 60, 'KeyM', false);
  key('5ef7', 65, 'ControlLeft', false);
  key('5ef7', 100, 'KeyN', true);
  key('5f29', 70, 'KeyN', false);
  key('5f29', 100, 'KeyA', true); // skill 3
  key('5faa', 120, 'KeyA', false);
  cp('5faa', 125, { vram: false });
  key('5faa', 160, 'Space', true);
  key('0155', 1430, 'Space', false);
  for (let c = 1440; c <= 1800; c += 90) cp('0155', c);
  return common('hotkeys', 'Skill T; Esc pause and resume (INT 1Ah AH=1); Ctrl+S sound off and play; Ctrl+R restart; Ctrl+M menu, skill A, new game.', ev);
}

// Natural play: a policy (tools/bots/policies.mjs) climbs onto a clothes line and drops
// into an open window. Its key presses are logged by the capture and become the
// scenario's input stream; no state is injected.
function naturalWindowScenario() {
  const ev = [];
  intro(ev);
  for (let c = 300; c <= 30000; c += 300) ev.push({ type: 'checkpoint', site: '0155', count: c });
  for (const site of Object.values(LOOP_HEAD)) {
    for (const c of [1, 50, 100, 150, 200]) ev.push({ type: 'checkpoint', site, count: c, ...(c === 200 ? { final: true } : {}) });
  }
  const m = common('natural-window', 'Natural play: the enterWindow policy climbs the cans, fence and a clothes line and drops into an open window; the capture logs its key presses; checkpoints in the alley and the first 200 passes of the room it reaches.', ev, {
    policy: { name: 'enterWindow', site: '0155', start: 10, every: 8 },
    maxIdleTicks: 1500,
  });
  m.stateInjection = 'none';
  return m;
}

function naturalRoom1Scenario() {
  const ev = [];
  intro(ev);
  forceRoom(ev, 60, 1);
  for (let c = 1; c <= 3000; c += 25) ev.push({ type: 'checkpoint', site: '03fa', count: c });
  for (const c of [1, 25, 50, 100, 150, 200]) ev.push({ type: 'checkpoint', site: '0478', count: c, ...(c === 200 ? { final: true } : {}) });
  const m = common('natural-room1', 'Room 1 chosen by state injection; then the room1 policy plays: lands on the chair, jumps onto the table into the fish bowl, and the original hands over to room 2 (DS:0554).', ev, {
    policy: { name: 'play', site: '03fa', start: 2, every: 8 },
    maxIdleTicks: 900,
  });
  m.stateInjection = 'room choice only (DS:0421-0431, 041d-0420, 0551 at alley pass 60); the room goal is reached by play';
  return m;
}

function naturalRoom6Scenario() {
  const ev = [];
  intro(ev);
  forceRoom(ev, 60, 6);
  // under capture a room-6 pass takes ~8 ms of emulated time (speaker breakpoint stops end
  // DOSBox's 1 ms slices), so the policy runs every 2 passes and checkpoints are sparse
  for (let c = 1; c <= 9001; c += 150) ev.push({ type: 'checkpoint', site: '02c5', count: c });
  for (const c of [100, 200, 300, 400]) ev.push({ type: 'checkpoint', site: '0155', count: c, ...(c === 400 ? { final: true } : {}) });
  const m = common('natural-room6', 'Room 6 chosen by state injection; the room6 policy holds Alt and steps between the floor rows so the room walks the cat to every bowl; the outcome (goal or a life lost to the chaser) is whatever the original produced, see the manifest note.', ev, {
    policy: { name: 'play', site: '02c5', start: 2, every: 2 },
    maxIdleTicks: 1500,
  });
  m.stateInjection = 'room choice only (DS:0421-0431, 041d-0420, 0551 at alley pass 60); the room is played by the policy';
  return m;
}

// Real keyboard: DOSBox presses the keys, the original INT 9 handler (CS:14b3, including
// the hot-key routine CS:1572) runs, and the scan-code bytes it reads become the replay
// input. Keypad arrows send single bytes (grey arrows add an E0 prefix whose second IRQ
// lands at an arbitrary instruction, so it could not be placed exactly).
function realKeyboardScenario() {
  const ev = [];
  const hk = (site, count, key, down) => ev.push({ type: 'hostkey', site, count, key, down });
  const cp = (site, count) => ev.push({ type: 'checkpoint', site, count });
  cp('5d71', 1);
  hk('5d71', 200, 'KBD_space', true);
  hk('5ef7', 5, 'KBD_space', false);
  hk('5ef7', 50, 'KBD_n', true);
  hk('5f29', 10, 'KBD_n', false);
  hk('5f29', 50, 'KBD_k', true);
  hk('5faa', 10, 'KBD_k', false);
  hk('5faa', 50, 'KBD_space', true);
  hk('0155', 5, 'KBD_space', false);
  hk('0155', 300, 'KBD_kp6', true);
  hk('0155', 2300, 'KBD_kp6', false);
  hk('0155', 2400, 'KBD_kp8', true);
  hk('0155', 2450, 'KBD_kp8', false);
  hk('0155', 2600, 'KBD_leftctrl', true); // Ctrl+S: sound off (hot-key routine CS:1572)
  hk('0155', 2610, 'KBD_s', true);
  hk('0155', 2620, 'KBD_s', false);
  hk('0155', 2630, 'KBD_leftctrl', false);
  hk('0155', 2700, 'KBD_kp4', true);
  hk('0155', 3500, 'KBD_kp4', false);
  for (let c = 100; c <= 4000; c += 100) cp('0155', c);
  const m = common('real-keyboard', 'Menu, walking, jumping and Ctrl+S with real DOSBox key presses handled by the original INT 9 handler; the recorded scan-code bytes drive the port\'s translated handler.', ev);
  m.keyInjection = 'real key presses in DOSBox at sync points (hostkey events); the scan-code bytes read by the original INT 9 handler are recorded with their exact position as scan events and replayed into the translated handler';
  return m;
}

const extraScenarios = [exitsScenario(), room7WinScenario(), hotkeysScenario(), naturalWindowScenario(), naturalRoom1Scenario(), naturalRoom6Scenario(), realKeyboardScenario()];

const wanted = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const reset = process.argv.includes('--reset');
for (let n = 1; n <= 7; n++) {
  const id = `room-${n}`;
  if (wanted.length && !wanted.includes(id)) continue;
  const path = join(ROOT, 'scenarios', `${id}.json`);
  const m = roomScenario(n);
  if (!reset && existsSync(path)) {
    const old = JSON.parse(readFileSync(path, 'utf8'));
    if (old.capture && JSON.stringify(old.events) === JSON.stringify(m.events)) m.capture = old.capture;
  }
  writeFileSync(path, `${JSON.stringify(m, null, 2)}\n`);
  console.log('wrote', path, m.capture ? '(capture kept)' : '(needs capture)');
}
for (const m of extraScenarios) {
  if (wanted.length && !wanted.includes(m.id)) continue;
  const path = join(ROOT, 'scenarios', `${m.id}.json`);
  if (!reset && existsSync(path)) {
    const old = JSON.parse(readFileSync(path, 'utf8'));
    if (old.capture) {
      console.log('kept', path);
      continue;
    }
  }
  writeFileSync(path, `${JSON.stringify(m, null, 2)}\n`);
  console.log('wrote', path, '(needs capture)');
}

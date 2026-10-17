#!/usr/bin/env node
// Exploratory: force the game into a room and run it headless (virtual-clock env).
//   node tools/room-sandbox.mjs --room 3 --ms 6000 [--keys "500:ArrowRight:800;300:ArrowUp"] [--every 500] [--seed 1234]
// The room is forced the same way reference scenarios do it: at alley loop iteration
// --at (default 50) the room-choice tables DS:0421..0431 are overwritten with the room
// number, DS:041d/041f reset, and DS:0551 ("entered a window") set.
// Frames (PNG) go to local/frames/room<N>-*.png. Not an acceptance test.
import { writeFileSync } from 'node:fs';
import { localPath, loadCatExe } from './lib/fixtures.mjs';
import { encodePng } from './lib/png.mjs';
import { parseMZ } from '../src/machine/exe.js';
import { Game } from '../src/game/game.js';

const args = {};
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (a.startsWith('--')) args[a.slice(2)] = process.argv[i + 1]?.startsWith('--') || process.argv[i + 1] === undefined ? true : process.argv[++i];
}
const room = Number(args.room || 1);
const at = Number(args.at || 50);
const ms = Number(args.ms || 5000);
const every = args.every ? Number(args.every) : 0;

export function forceRoom(g, n) {
  for (let a = 0x421; a <= 0x431; a++) g.wb(a, n);
  g.ww(0x41d, 0xffff);
  g.ww(0x41f, 0xffff);
  g.wb(0x418, 0);
  g.wb(0x551, 1);
}

function frame(g, name) {
  const rgba = new Uint8Array(320 * 200 * 4);
  g.cga.render(g.mem.vram, rgba);
  writeFileSync(localPath('frames', name), encodePng(320, 200, rgba));
}

const g = new Game(parseMZ(loadCatExe()).image, { rngSeed: args.seed ? parseInt(args.seed, 16) : 0x1234 });
const cpm = g.clock.cyclesPerMs;
let t = 0;
for (const [d, code] of [[3000, 'Space'], [1000, 'KeyN'], [1000, 'KeyK'], [1000, 'Space']]) {
  t += d;
  g.keyboard.push(t * cpm, code, true);
  g.keyboard.push((t + 120) * cpm, code, false);
}
let alleyHits = 0;
let forcedAt = null;
try {
  // run until forced into the room
  while (forcedAt === null) {
    g.serviceInterrupts();
    const site = g.step();
    if (g.exited) throw new Error('program exited');
    if (site === 0x0155 && ++alleyHits === at) {
      forceRoom(g, room);
      forcedAt = g.clock.cycles;
    }
    if (g.clock.ms() > 60000) throw new Error('did not reach the alley');
  }
  // schedule room keys relative to the moment of forcing
  if (args.keys) {
    let k = forcedAt / cpm;
    for (const step of String(args.keys).split(';').filter(Boolean)) {
      const [delay, code, hold = '150'] = step.split(':');
      k += Number(delay);
      g.keyboard.push(k * cpm, code, true);
      g.keyboard.push((k + Number(hold)) * cpm, code, false);
    }
  }
  let n = 0;
  for (let done = 0; done < ms && !g.exited; ) {
    const step = every || ms;
    g.runMs(Math.min(step, ms - done));
    done += step;
    if (every) frame(g, `room${room}-${String(n++).padStart(3, '0')}.png`);
  }
  if (!every) frame(g, `room${room}.png`);
  console.log(JSON.stringify({ ok: true, room: g.rw(4), virtualMs: Math.round(g.clock.ms()), catX: g.rw(0x579), catY: g.rb(0x57b), lives: g.rb(0x1f80) }));
} catch (e) {
  frame(g, `room${room}-error.png`);
  console.log(JSON.stringify({ ok: false, room: g.rw(4), virtualMs: Math.round(g.clock.ms()), error: e.message }));
  if (e.name !== 'UnsupportedPath') console.error(e.stack);
  process.exitCode = 1;
}

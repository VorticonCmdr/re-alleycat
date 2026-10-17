#!/usr/bin/env node
// Exploratory: run a play policy on the port (virtual-clock env) to develop it.
//   node tools/bot-run.mjs --policy enterWindow --site 0155 --every 8 --seconds 60 [--seed 1234]
// Keys are applied at sync points exactly as reference captures/replays apply them.
import { writeFileSync } from 'node:fs';
import { loadCatExe, localPath } from './lib/fixtures.mjs';
import { encodePng } from './lib/png.mjs';
import { parseMZ } from '../src/machine/exe.js';
import { Game } from '../src/game/game.js';
import { keyboardInterrupt } from '../src/game/input.js';
import { keyBytes } from './dosbox/capture.mjs';
import { policies, ROOM_SITES } from './bots/policies.mjs';

const args = {};
for (let i = 2; i < process.argv.length; i++) {
  if (process.argv[i].startsWith('--')) args[process.argv[i].slice(2)] = process.argv[++i];
}
const policy = policies[args.policy || 'enterWindow'];
const until = args.until || 'room'; // 'room': stop on entering a room; 'solved': stop when DS:0553 is set
const site = parseInt(args.site || '0155', 16);
const every = Number(args.every || 8);
const seconds = Number(args.seconds || 60);

export function runBot(seed) {
  const g = new Game(parseMZ(loadCatExe()).image, { rngSeed: seed });
  const cpm = g.clock.cyclesPerMs;
  let t = 0;
  for (const [d, code] of [[3000, 'Space'], [1000, 'KeyN'], [1000, 'KeyK'], [1000, 'Space']]) {
    t += d;
    g.keyboard.push(t * cpm, code, true);
    g.keyboard.push((t + 120) * cpm, code, false);
  }
  const held = new Set();
  let hits = 0;
  const log = [];
  const mem = { rb: (a) => g.rb(a), rw: (a) => g.rw(a), scratch: {} };
  while (g.clock.ms() < seconds * 1000 && !g.exited) {
    g.serviceInterrupts();
    const s = g.step();
    if (until === 'room' && g.rw(0x0004) !== 0) return { ok: true, g, hits, log, ms: g.clock.ms(), room: g.rw(0x0004) };
    if (until === 'solved' && g.rb(0x553)) return { ok: true, g, hits, log, ms: g.clock.ms(), room: g.rw(0x0004) };
    if (s !== site && !(until === 'solved' && ROOM_SITES[s])) continue;
    hits++;
    if (hits % every) continue;
    const want = policy(mem);
    for (const k of [...held]) if (!want.has(k)) {
      for (const b of keyBytes(k, false)) keyboardInterrupt(g, b);
      held.delete(k);
      log.push({ count: hits, code: k, down: false });
    }
    for (const k of want) if (!held.has(k)) {
      for (const b of keyBytes(k, true)) keyboardInterrupt(g, b);
      held.add(k);
      log.push({ count: hits, code: k, down: true });
    }
  }
  return { ok: false, g, hits, log, ms: g.clock.ms() };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const seeds = (args.seeds || '1234').split(',').map((s) => parseInt(s, 16));
  for (const seed of seeds) {
    const r = runBot(seed);
    const rgba = new Uint8Array(320 * 200 * 4);
    r.g.cga.render(r.g.mem.vram, rgba);
    writeFileSync(localPath('frames', `bot-${seed.toString(16)}.png`), encodePng(320, 200, rgba));
    console.log(JSON.stringify({ seed: seed.toString(16), ok: r.ok, room: r.room ?? r.g.rw(4), prev: r.g.rw(6), score: [...r.g.mem.ds.subarray(0x1f82,0x1f89)].join(''), passes: r.hits, keyEvents: r.log.length, secs: (r.ms / 1000).toFixed(1),
      x: r.g.rw(0x579), y: r.g.rb(0x57b), lives: r.g.rb(0x1f80), window: r.g.rb(0x1665) }));
  }
}

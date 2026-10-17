// Shared helpers for headless tests.
import { createHash } from 'node:crypto';
import { loadCatExe } from '../tools/lib/fixtures.mjs';
import { parseMZ } from '../src/machine/exe.js';
import { Game } from '../src/game/game.js';

let image = null;
export function catImage() {
  if (!image) image = parseMZ(loadCatExe()).image;
  return image;
}

export function newGame(opts = {}) {
  return new Game(catImage(), opts);
}

// Schedule taps: [[delayMs, code, holdMs?], ...] relative to each other, from time 0.
export function schedule(game, taps) {
  const cpm = game.clock.cyclesPerMs;
  let t = 0;
  for (const [delay, code, hold = 120] of taps) {
    t += delay;
    game.keyboard.push(t * cpm, code, true);
    game.keyboard.push((t + hold) * cpm, code, false);
  }
  return t;
}

export function stateHash(game) {
  const h = createHash('sha256');
  h.update(game.mem.ds.subarray(0, 0x7130));
  h.update(game.mem.vram.subarray(0, 0x4000));
  return h.digest('hex').slice(0, 16);
}

export class Checks {
  constructor(title) {
    this.title = title;
    this.results = [];
  }
  ok(name, cond, detail = '') {
    this.results.push({ name, ok: !!cond });
    console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
  }
  eq(name, actual, expected) {
    this.ok(name, actual === expected, `got ${fmt(actual)}, expected ${fmt(expected)}`);
  }
  done() {
    const failed = this.results.filter((r) => !r.ok).length;
    console.log(`${this.title}: ${this.results.length - failed}/${this.results.length} passed`);
    if (this.results.length === 0 || failed) process.exit(1);
  }
}

function fmt(v) {
  return typeof v === 'number' ? `${v} (0x${v.toString(16)})` : JSON.stringify(v);
}

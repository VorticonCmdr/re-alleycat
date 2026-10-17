#!/usr/bin/env node
// Exploratory headless runner (not an acceptance test).
//   node tools/run.mjs --ms 3000 --png title.png
//   node tools/run.mjs --script "1500:KeyN;300:KeyK;300:Space" --ms 8000 --png alley.png
// --script: ';'-separated "<delay ms>:<KeyboardEvent.code>[:hold ms]" taps, relative.
// PNGs are written under local/frames/.
import { writeFileSync } from 'node:fs';
import { loadCatExe, localPath, SetupError } from './lib/fixtures.mjs';
import { encodePng } from './lib/png.mjs';
import { parseMZ } from '../src/machine/exe.js';
import { Game } from '../src/game/game.js';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, arr) => {
    if (a.startsWith('--')) acc.push([a.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : true]);
    return acc;
  }, []),
);

function frame(game, name) {
  const rgba = new Uint8Array(320 * 200 * 4);
  game.cga.render(game.mem.vram, rgba);
  const p = localPath('frames', name);
  writeFileSync(p, encodePng(320, 200, rgba));
  return p;
}

try {
  const exe = loadCatExe();
  const mz = parseMZ(exe);
  const opts = {};
  if (args.seed) opts.rngSeed = parseInt(args.seed, 16);
  const game = new Game(mz.image, opts);
  const cpm = game.clock.cyclesPerMs;
  let t = 0;
  if (args.script) {
    for (const step of String(args.script).split(';').filter(Boolean)) {
      const [delay, code, hold = '120'] = step.split(':');
      t += Number(delay);
      game.keyboard.push(t * cpm, code, true);
      game.keyboard.push((t + Number(hold)) * cpm, code, false);
    }
  }
  const ms = Number(args.ms || 2000);
  const every = args.every ? Number(args.every) : 0;
  let n = 0;
  const started = Date.now();
  for (let done = 0; done < ms && !game.exited; ) {
    const step = every || ms;
    game.runMs(Math.min(step, ms - done));
    done += step;
    if (every && args.png) frame(game, `${args.png.replace(/\.png$/, '')}-${String(n++).padStart(4, '0')}.png`);
  }
  if (args.png && !every) console.log('frame', frame(game, args.png));
  console.log(JSON.stringify({
    virtualMs: Math.round(game.clock.ms()),
    hostMs: Date.now() - started,
    exited: game.exited,
    yields: game.yields,
    room: game.rw(4),
    catX: game.rw(0x579),
    catY: game.rb(0x57b),
    lives: game.rb(0x1f80),
    seed: game.rw(0x2ae5).toString(16),
  }));
} catch (e) {
  if (e instanceof SetupError) {
    console.error(`SETUP FAILURE: ${e.message}`);
    process.exit(2);
  }
  console.error(e.stack);
  process.exit(1);
}

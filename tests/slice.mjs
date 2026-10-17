// Playable-slice scenario through the real program flow (headless, virtual-clock env).
// Evidence level: independent runtime scenario (port's own environment providers).
// Includes determinism and a negative control.
import { Checks, newGame, schedule, stateHash } from './harness.mjs';

const c = new Checks('slice');
const SEED = 0x1234;

const TAPS = [
  [3000, 'Space'], // leave the title
  [1000, 'KeyN'], // no joystick
  [1000, 'KeyK'], // skill: kitten
  [1000, 'Space'], // start
];

function play(taps, extra = () => {}) {
  const g = newGame({ rngSeed: SEED });
  schedule(g, taps);
  const marks = {};
  const step = (ms, name) => {
    g.runMs(ms);
    if (name) marks[name] = { x: g.rw(0x579), y: g.rb(0x57b), room: g.rw(4), lives: g.rb(0x1f80), menuLine: g.rw(0x6d8f), hash: stateHash(g) };
  };
  step(2500, 'title');
  step(1000, 'menu');
  step(4500, 'alley');
  extra(g, step);
  return { g, marks };
}

// main run: walk right, then jump
const run = play(TAPS, (g, step) => {
  const cpm = g.clock.cyclesPerMs;
  const t = g.clock.cycles;
  g.keyboard.push(t, 'ArrowRight', true);
  g.keyboard.push(t + 1500 * cpm, 'ArrowRight', false);
  step(1600, 'walked');
  const t2 = g.clock.cycles;
  g.keyboard.push(t2, 'ArrowUp', true);
  g.keyboard.push(t2 + 150 * cpm, 'ArrowUp', false);
  step(250, 'jumping');
  step(2500, 'landed');
});
const m = run.marks;
c.ok('title screen drawn (VRAM not empty)', run.g.mem.vram.some((b) => b !== 0));
c.ok('menu reached after a key (joystick question printed)', m.menu.menuLine === 2 && m.title.menuLine !== 2, `line ${m.title.menuLine} -> ${m.menu.menuLine}`);
c.eq('alley: three lives', m.alley.lives, 3);
c.eq('alley: room 0', m.alley.room, 0);
c.ok('alley: cat enters at the left edge', m.alley.x <= 8, `x=${m.alley.x}`);
c.ok('walking right moves the cat', m.walked.x > m.alley.x + 100, `x ${m.alley.x} -> ${m.walked.x}`);
c.ok('jump lifts the cat', m.jumping.y < m.walked.y, `y ${m.walked.y} -> ${m.jumping.y}`);
c.eq('cat lands back on the ground', m.landed.y, 0xb4);

// determinism: identical inputs give identical state
const again = play(TAPS);
c.eq('deterministic replay (DS+VRAM hash at alley start)', again.marks.alley.hash, m.alley.hash);

// negative control: drop the skill key -> the game must not start
const broken = play(TAPS.filter(([, code]) => code !== 'KeyK'));
c.ok('negative control: without the skill key the alley is not reached', broken.marks.alley.lives !== 3,
  `lives=${broken.marks.alley.lives}`);
c.ok('negative control: state hash differs', broken.marks.alley.hash !== m.alley.hash);
c.done();

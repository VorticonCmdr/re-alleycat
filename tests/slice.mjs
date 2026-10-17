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
// joystick mode: the original's own detection (CS:5fe5/600f) and stick reading (CS:122e)
{
  const g = newGame({ rngSeed: SEED });
  const cpm = g.clock.cyclesPerMs;
  g.gamePort.push(0, { connected: true, x: 0, y: 0, button: false });
  schedule(g, [[3000, 'Space'], [1000, 'KeyY'], [1500, 'KeyK']]);
  g.runMs(6500);
  c.eq('joystick detected and selected (DS:069b)', g.rb(0x69b), 1);
  const t = g.clock.cycles;
  g.gamePort.push(t, { connected: true, x: 0, y: 0, button: true }); // fire starts the game
  g.gamePort.push(t + 200 * cpm, { connected: true, x: 0, y: 0, button: false });
  g.runMs(4000);
  const x0 = g.rw(0x579);
  c.eq('fire button started the game (three lives)', g.rb(0x1f80), 3);
  g.gamePort.push(g.clock.cycles, { connected: true, x: 1, y: 0, button: false });
  g.runMs(1500);
  c.ok('stick right moves the cat through CS:122e', g.rw(0x579) > x0 + 40, `x ${x0} -> ${g.rw(0x579)}`);
  c.eq('stick right reads as DIR_X = +1', g.rb(0x698), 1);
  g.gamePort.push(g.clock.cycles, { connected: true, x: -1, y: 0, button: false });
  g.runMs(300);
  c.eq('stick left reads as DIR_X = -1 (0xFF)', g.rb(0x698), 0xff);
  g.gamePort.push(g.clock.cycles, { connected: true, x: 0, y: 0, button: false });
  g.runMs(300);
  c.eq('centred stick reads as DIR_X = 0', g.rb(0x698), 0);
}
// joystick requested without a stick: the original's "not found" path, back to the question
{
  const g = newGame({ rngSeed: SEED });
  schedule(g, [[3000, 'Space'], [1000, 'KeyY'], [1500, 'Space'], [800, 'KeyN']]);
  g.runMs(7000);
  c.eq('without a stick Y is refused and N continues (DS:069b)', g.rb(0x69b), 0);
  c.ok('...and the skill question is shown', g.rw(0x6d8f) >= 0x0c, `line ${g.rw(0x6d8f)}`);
}
c.done();

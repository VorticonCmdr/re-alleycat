// Unit checks. Evidence level: self-consistency of the machine layer and primitives against
// independently written definitions (not against the reference emulator; see reference.mjs).
import { Checks, newGame, catImage } from './harness.mjs';
import { parseMZ } from '../src/machine/exe.js';
import { loadCatExe } from '../tools/lib/fixtures.mjs';
import { VirtualClock } from '../src/machine/clock.js';
import { KeyboardController } from '../src/machine/keyboard.js';
import { xyAddr, blitOver, blitAnd, overlap, SEG_VRAM } from '../src/game/prims.js';
import { addScore } from '../src/game/score.js';
import { FONT8X8 } from '../src/machine/font8x8.js';

const c = new Checks('unit');

// --- executable identity / layout
const mz = parseMZ(loadCatExe());
c.eq('MZ header size', mz.headerSize, 0x200);
c.eq('MZ entry CS', mz.cs, 0x723);
c.eq('MZ entry IP', mz.ip, 0);
c.eq('MZ relocation count', mz.relocs.length, 9);
c.ok('all relocations are in the code segment', mz.relocs.every((r) => r.seg === 0x723));
c.eq('image length', mz.image.length, 55067 - 0x200);
const g = newGame();
c.eq('DS:06A1 is the scan-code table start (Alt)', g.rb(0x6a1), 0x38);
c.eq('DS:06A2 scan code Up', g.rb(0x6a2), 0x48);

// --- CGA addressing vs. definition: offset = (y&1)*0x2000 + (y>>1)*80 + x>>2
let bad = 0;
for (let y = 0; y < 200; y++) {
  for (let x = 0; x < 320; x += 7) {
    if (xyAddr(g, x, y) !== (y & 1) * 0x2000 + (y >> 1) * 80 + (x >> 2)) bad++;
  }
}
c.eq('CS:2cb0 xy -> offset matches CGA layout', bad, 0);

// --- transparent blit: 0 pixels keep background, others replace it
{
  const t = newGame();
  t.mem.vram.fill(0b11100100, 0, 4); // pixels 3,2,1,0
  t.wb(0x7000, 0b00011011); // pixels 0,1,2,3
  t.wb(0x7001, 0b00000000);
  blitOver(t, SEG_VRAM, 0, 0x7000, 0x7100, 1, 1);
  c.eq('CS:2ccc transparency byte 0', t.mem.vram[0], 0b11011011);
  c.eq('CS:2ccc transparency byte 1 (all clear)', t.mem.vram[1], 0b11100100);
  c.eq('CS:2ccc saves background', t.rb(0x7100), 0b11100100);
  t.mem.vram.fill(0xff, 0x10, 0x12);
  t.wb(0x7002, 0x0f);
  t.wb(0x7003, 0xf0);
  blitAnd(t, SEG_VRAM, 0x10, 0x7002, 0x7100, 1, 1);
  c.eq('CS:2d35 AND blit', t.mem.vram[0x10] << 8 | t.mem.vram[0x11], 0x0ff0);
}

// --- box overlap (CS:2e29) against a direct interval definition
{
  const t = newGame();
  let mism = 0;
  for (let ax = 0; ax < 80; ax += 3) {
    for (let bx = 0; bx < 80; bx += 5) {
      const r = overlap(t, ax, 16, bx, 24, 50, 14, 52, 14);
      const def = ax + 16 >= bx && Math.max(0, ax - 24) <= bx && 50 + 14 >= 52 && Math.max(0, 50 - 14) <= 52;
      if (r !== def) mism++;
    }
  }
  c.eq('CS:2e29 overlap matches interval definition', mism, 0);
}

// --- BCD score add with carries (CS:2706)
{
  const t = newGame();
  for (let i = 0; i < 7; i++) t.wb(0x1f82 + i, 0);
  t.wb(0x1f87, 9);
  t.wb(0x1f86, 9);
  addScore(t, 5);
  const digits = [...t.mem.ds.subarray(0x1f82, 0x1f89)].join('');
  c.eq('CS:2706 BCD add 0000990 + 5 tens', digits, '0001040');
}

// --- clock: BIOS ticks at 18.2065 Hz, PIT ch0 mode 3 counts down by 2
{
  const k = new VirtualClock({ cyclesPerMs: 3000 });
  k.cycles = 3000 * 1000;
  c.eq('BIOS ticks after 1 s', k.biosTicks(), 18);
  k.cycles = 3000 * 10000;
  c.eq('BIOS ticks after 10 s', k.biosTicks(), 182);
  k.setBiosTicks(1000);
  k.cycles += 3000 * 1000;
  c.ok('INT 1Ah AH=1 rebases the tick count', [1018, 1019].includes(k.biosTicks()), String(k.biosTicks()));
  c.ok('PIT ch0 mode-3 count is even', k.pitCounter0() % 2 === 0);
  const a = k.pitCounter0();
  k.cycles += 30;
  c.ok('PIT ch0 counts down', ((a - k.pitCounter0()) & 0xffff) > 0 && ((a - k.pitCounter0()) & 0xffff) < 100);
}

// --- typematic: 500 ms delay, then every 33 ms
{
  const k = new VirtualClock({ cyclesPerMs: 1000 });
  const kb = new KeyboardController(k);
  kb.push(0, 'ArrowRight', true);
  k.cycles = 0;
  const first = kb.due();
  k.cycles = 499 * 1000;
  const none = kb.due();
  k.cycles = 567 * 1000;
  const reps = kb.due();
  c.eq('make code with E0 prefix', JSON.stringify(first), JSON.stringify([0xe0, 0x4d]));
  c.eq('no repeat before 500 ms', none.length, 0);
  c.eq('repeats at 500 and 533 and 566 ms', reps.length, 6);
}

// --- substitute font is complete
c.eq('font covers 0x20..0x7e', FONT8X8.length, 95 * 8);
void catImage;
c.done();

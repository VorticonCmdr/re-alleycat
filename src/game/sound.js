// PC-speaker music and effects (CS:5400..5c5c). DS:0000 is the sound switch (Ctrl+S).
// Several effects busy-wait; with sound off those waits are skipped, so the switch
// changes game timing exactly as in the original.

import { random, copyRect, SEG_VRAM } from './prims.js';
import { speakerOff } from './input.js';

const on = (g) => g.rb(0x0000) !== 0;

// CS:5889 - program PIT ch2 with AX and enable the speaker.
export function tone(g, ax) {
  g.out42(ax & 0xff);
  g.out42((ax >> 8) & 0xff);
  g.out61(g.in61() | 3);
  g.c(3);
}

function toneB6(g, ax) {
  g.out43(0xb6);
  tone(g, ax);
}

// CS:13b7 - PIT channel 0 count (swapped into AX = hi:lo).
export function pitRead(g) {
  return g.pit0();
}

// Busy loop "MOV CX,n / LOOP $" (halved on the PCjr in the original).
function spin(g, cx) {
  if (g.rb(0x697) === 0xfd) cx >>= 1;
  g.c(cx + 3);
}

// CS:5450 - reset the chase sound.
export function chaseSoundInit(g) {
  g.wb(0x5b0f, 0x0c);
  g.ww(0x5b0c, 1);
  g.ww(0x5b12, 0x1ff);
  g.ww(0x5b0a, 0x0f);
  g.wb(0x5b0e, 1);
  g.c(6);
}

// CS:58bd - reset the alley tune.
export function musicReset(g) {
  g.wb(0x5927, 0x80);
  g.wb(0x5928, 0);
  g.wb(0x5929, 0);
  g.ww(0x592a, 0x500);
  g.wb(0x592c, 0xff);
  g.wb(0x592d, 0);
  g.wb(0x5920, 0);
  g.wb(0x5b07, 0);
  g.ww(0x5b08, 0);
  g.ww(0x5b0c, 1);
  g.wb(0x5b0e, 1);
  g.c(12);
}

// CS:5b28 - play [592a] for [592e] PIT counts (busy wait on PIT ch0).
export function blip(g) {
  toneB6(g, g.rw(0x592a));
  const start = g.pit0();
  for (let guard = 0; ; guard++) {
    const now = g.pit0();
    g.c(5);
    if (((start - now) & 0xffff) >= g.rw(0x592e)) break;
    if (guard > 1e6) throw new Error('CS:5b40 wait did not terminate');
  }
  g.out61(g.in61() & 0xfc);
  g.c(3);
}

// CS:546d - per-frame sound: chase sound while the dog chases, else the alley tune.
export function alleyMusic(g) {
  g.c(3);
  if (!on(g)) return;
  if (g.rb(0x1cb8) !== 0) {
    const dx = g.ticks();
    g.c(3);
    if (g.rb(0x5b0f) === 0) {
      if (dx === g.rw(0x5b10)) return;
      g.ww(0x5b10, dx);
      g.out43(0xb6);
      tone(g, ((g.rw(0x5b12) & 0x1ff) + 0xc8) & 0xffff);
      g.ww(0x5b12, g.rw(0x5b12) - 0x4b);
      g.c(6);
      return;
    }
    if (dx !== g.rw(0x5b10)) {
      g.ww(0x5b10, dx);
      g.wb(0x5b0f, g.rb(0x5b0f) - 1);
    }
    const n = (g.rb(0x5b0e) - 1) & 0xff;
    g.wb(0x5b0e, n);
    g.c(6);
    if (n !== 0) return;
    g.wb(0x5b0e, g.rb(0x697) === 0xfd ? 1 : 2);
    if ((random(g) & 0xff) <= 4) g.ww(0x5b0c, g.rw(0x5b0c) + 1);
    if (g.rw(0x5b0c) & 1) g.ww(0x5b0a, g.rw(0x5b0a) + 7);
    g.out43(0xb6);
    const dx2 = random(g);
    tone(g, ((dx2 & g.rw(0x5b0a) & 0x1ff) + 0x190) & 0xffff);
    g.c(12);
    return;
  }
  // L54f8 - alley tune / one-shot effects
  const dx = g.ticks();
  g.c(3);
  if (g.rb(0x5920) !== 0) {
    if (dx === g.rw(0x5921)) return;
    g.ww(0x5921, dx);
    const n = (g.rb(0x5920) - 1) & 0xff;
    g.wb(0x5920, n);
    g.c(4);
    if (n !== 0) {
      g.out43(0xb6);
      tone(g, g.rw(0x5923));
      return;
    }
    speakerOff(g);
    return;
  }
  if (dx === g.rw(0x5925)) return;
  let si = 3;
  if ((g.rb(0x1cbf) | g.rb(0x5b07)) === 0) {
    si = 1;
    if (g.rw(0x0004) === 0) {
      si = 0;
      if (g.rb(0x1673) !== 0) si = 2;
    }
  }
  const di = si << 1;
  g.c(10);
  if ((g.rb(0x584) | g.rb(0x5b07)) === 0) {
    if (((dx - g.rw(0x5925)) & 0xffff) < g.rw(0x59f2 + di)) return;
  }
  g.ww(0x5925, dx);
  g.c(3);
  if (g.rb(0x1cbf) !== 0 || g.rb(0x5b07) !== 0) {
    if (g.rb(0x1cbf) === 0) g.wb(0x5b07, g.rb(0x5b07) - 1);
    g.ww(0x592e, 0x1200);
    let bx = g.rw(0x59ba);
    if (bx >= 6) {
      bx = 0;
      g.ww(0x59ba, 0);
    }
    g.ww(0x59ba, g.rw(0x59ba) + 2);
    g.ww(0x592a, g.rw(0x5a44 + bx));
    g.c(10);
    blip(g);
    return;
  }
  if (si === 2) {
    g.ww(0x592a, ((g.rb(0x1673) << 4) + 0x200) & 0xffff);
    g.ww(0x592e, 0x1800);
    g.c(8);
    blip(g);
    return;
  }
  g.ww(0x592e, g.rw(0x5a02 + di));
  const cf = g.rb(0x5927) & 1;
  g.wb(0x5927, g.rb(0x5927) >> 1);
  g.c(4);
  if (cf) {
    g.ww(0x592e, 0x1000);
    g.wb(0x5927, 0x80);
    let al = (g.rb(0x5928) + 1) & 0xff;
    g.wb(0x5928, al);
    al &= g.rb(0x59fa + si);
    g.c(8);
    if (al === 0) {
      g.wb(0x5929, g.rb(0x5929) + g.rb(0x5a0a + si));
      const r = random(g) & 0xff;
      if (r <= g.rb(0x5a0c + si)) g.wb(0x592d, r & 7);
      let d = (random(g) & 0xff) << 1;
      let cl = 1;
      if (d & 2) {
        cl = 0xff;
        d += 0x300;
      }
      g.ww(0x592a, d);
      g.wb(0x592c, cl);
      g.c(14);
    }
    const ah = g.rb(0x5929) & g.rb(0x59fc + si);
    g.wb(0x5928, al | ah);
    g.c(4);
  }
  // L5623
  if (g.rb(0x592c) !== 0xff) {
    g.ww(0x5a54, g.rw(0x5a54) + 2);
    g.ww(0x592a, g.rw(0x5a44 + (g.rw(0x5a54) & 0x0e)));
    g.c(6);
  } else {
    if (g.rw(0x592a) <= 0xc8) g.ww(0x592a, 0x500);
    g.ww(0x592a, g.rw(0x592a) - 0x19);
    g.c(5);
  }
  if (g.rb(0x584) !== 0) {
    g.ww(0x592e, 0x2000);
    g.wb(0x592c, 0xff);
    g.c(3);
    blip(g);
    return;
  }
  const bx = (g.rb(0x5928) + g.rw(0x59fe + di)) & 0xffff;
  g.c(6);
  if (g.rb(0x59c2 + bx) & g.rb(0x5927)) {
    blip(g);
    return;
  }
  if (g.rb(0x592d) === 0) return;
  g.wb(0x592d, g.rb(0x592d) - 1);
  g.ww(0x592e, g.rw(0x5a06 + di));
  g.c(4);
  blip(g);
}

// CS:593b - start a two-tick effect: AX now, BX on the next tick (played by alleyMusic).
export function effect(g, ax, bx) {
  g.c(2);
  if (!on(g)) return;
  g.ww(0x5923, bx);
  g.out43(0xb6);
  tone(g, ax);
  g.wb(0x5920, 2);
  g.ww(0x5921, g.ticks());
  g.c(4);
}

// CS:595d
export function randomEffect(g) {
  g.c(2);
  if (!on(g) || g.rb(0x5920) !== 0) return;
  const ax = ((random(g) & 0x7f) + 0xaa) & 0xffff;
  effect(g, ax + 0x1e, ax);
}

// CS:597f - rising bubble effect (room 2).
export function bubbleEffect(g) {
  g.c(2);
  if (!on(g)) return;
  const ax = (0x1200 + g.rw(0x5b08)) & 0xffff;
  const bx = (0x1312 + g.rw(0x5b08)) & 0xffff;
  g.ww(0x5b08, g.rw(0x5b08) + 0x15e);
  effect(g, ax, bx);
  g.wb(0x5b07, 0x18);
  g.c(4);
}

// CS:59a3 - short tone BX for a CX-iteration busy loop.
export function beep(g, bx, cx) {
  g.c(2);
  if (!on(g)) return;
  g.out43(0xb6);
  tone(g, bx);
  spin(g, cx);
  speakerOff(g);
}

// CS:58f8 - jumping off a lid.
export function jumpOffSound(g) {
  if (g.rb(0x1cbf) === 0) beep(g, 0x390, 0x1800);
  g.wb(0x127c, 0);
  g.c(3);
}

// CS:590e - landing on a lid.
export function landSound(g) {
  g.c(2);
  if (g.rb(0x1cbf) === 0) beep(g, 0x400, 0x1800);
}

// CS:591f - three-note squeak.
export function squeak(g) {
  beep(g, 0x7d0, 0x1800);
  beep(g, 0xa6e, 0x1800);
  beep(g, 0xdec, 0x1800);
}

// CS:59cb - falling-off-the-screen noise, ~7 ticks of random clicks.
export function* fellSound(g) {
  g.out61(g.in61() & 0xfe);
  g.ww(0x5a40, g.ticks());
  g.ww(0x5a42, 0);
  g.c(4);
  for (;;) {
    let cx = g.rw(0x5a42) >> 6;
    if (cx === 0) cx = 1;
    let done = false;
    for (;;) {
      const d = (g.ticks() - g.rw(0x5a40)) & 0xffff;
      g.c(6);
      if (d < 2) {
        yield;
        continue;
      }
      if (d >= 7) {
        done = true;
        break;
      }
      cx = (cx - 1) & 0xffff;
      g.c(1);
      if (cx === 0) break;
      yield;
    }
    if (done) break;
    const dl = random(g) & 2 & g.rb(0x0000);
    g.out61(g.in61() ^ dl);
    g.ww(0x5a42, g.rw(0x5a42) + 7);
    g.c(6);
  }
  speakerOff(g);
}

// CS:5a1c - warbling "hit" sound, retuned whenever ~0x260 PIT counts have passed.
export function hitSound(g) {
  g.c(2);
  if (!on(g)) return;
  const ax = g.pit0();
  const d = g.rw(0x5a16) - ax;
  g.c(4);
  if (d >= 0 && d <= 0x260) return;
  g.ww(0x5a16, ax);
  g.out43(0xb6);
  g.ww(0x5a18, g.rw(0x5a18) + 1);
  const bx = g.rw(0x5a18) & 0x1e;
  let a = g.rw(0x5a3c) & 0x3ff;
  if (a >= 0x180) a = (0x180 - a) & 0xffff;
  a = ((a >> 2) + g.rw(0x5a1a + bx)) & 0xffff;
  let step = g.rb(0x697) === 0xfd ? 2 : 1;
  g.ww(0x5a3e, g.rw(0x5a3e) + step);
  step <<= 2;
  g.ww(0x5a3c, g.rw(0x5a3c) + step);
  a = (a + (g.rw(0x5a3e) >> 3)) & 0xffff;
  tone(g, a);
  g.c(20);
}

// CS:5a90 - random noise note, once per tick.
export function noiseNote(g) {
  g.c(2);
  if (!on(g)) return;
  const dx = g.ticks();
  if (dx === g.rw(0x5a14)) return;
  g.ww(0x5a14, dx);
  g.out43(0xb6);
  tone(g, ((random(g) & 0x70) + 0x200) & 0xffff);
  g.c(6);
}

// CS:5ac2 - landing thud: descending noise for 2 ticks.
export function* landThud(g) {
  g.ww(0x5a12, 0x338);
  g.ww(0x5a10, g.ticks());
  g.ww(0x5a0e, g.pit0());
  g.c(6);
  for (;;) {
    const dx = g.pit0();
    g.c(4);
    if (((dx - g.rw(0x5a0e)) & 0xffff) >= 0x9c40) {
      g.ww(0x5a0e, dx);
      if (on(g)) {
        g.out43(0xb6);
        const r = random(g);
        const ax = ((r & 0x7ff) + g.rw(0x5a12)) & 0xffff;
        g.ww(0x5a12, g.rw(0x5a12) - 2);
        tone(g, ax);
        g.c(8);
      }
    }
    const t = (g.ticks() - g.rw(0x5a10)) & 0xffff;
    g.c(3);
    if (t >= 2) break;
    yield;
  }
  speakerOff(g);
}

// CS:57d5 - start the "back in the alley" tune.
export function returnTuneInit(g) {
  g.ww(0x5a85, 0);
  g.ww(0x5a83, g.ticks());
  g.c(3);
}

// CS:57e4 - next note of the return tune every 2 ticks.
export function returnTune(g) {
  g.c(2);
  if (!on(g)) return;
  const dx = g.ticks();
  g.c(3);
  if (((dx - g.rw(0x5a83)) & 0xffff) < 2) return;
  g.ww(0x5a83, dx);
  const bx = g.rw(0x5a85);
  g.ww(0x5a85, bx + 2);
  let ax;
  g.c(5);
  if (g.rb(0x552) !== 0) {
    ax = g.rw(0x5aa3 + bx);
    if (ax === 0) {
      speakerOff(g);
      return;
    }
  } else {
    ax = g.rw(0x5a87 + bx);
  }
  g.out43(0xb6);
  tone(g, ax);
}

// CS:5829
export function twoToneInit(g) {
  g.ww(0x5a62, 0);
  g.wb(0x5a82, 0);
  g.c(2);
}

// CS:5835 - alternate between two notes of a pair each tick.
export function twoTone(g) {
  g.c(2);
  if (!on(g)) return;
  const dx = g.ticks();
  if (dx === g.rw(0x5a80)) return;
  g.ww(0x5a80, dx);
  g.wb(0x5a82, g.rb(0x5a82) + 1);
  g.out43(0xb6);
  let bx = g.rw(0x5a62);
  if (!(g.rb(0x5a82) & 1)) bx += 2;
  tone(g, g.rw(0x5a64 + bx));
  g.c(8);
}

// CS:5869 - advance to the next note pair and play its first note.
export function twoToneNext(g) {
  g.c(2);
  if (!on(g)) return;
  g.out43(0xb6);
  const bx = g.rw(0x5a62);
  g.ww(0x5a62, bx + 2);
  tone(g, g.rw(0x5a64 + bx));
  g.c(6);
}

// CS:5897 - wipe tick sound.
export function wipeTick(g) {
  g.c(2);
  if (!on(g)) return;
  g.out43(0xb6);
  const bx = g.rw(0x5a56) & 6;
  g.ww(0x5a56, g.rw(0x5a56) + 2);
  tone(g, g.rw(0x5a5a + bx));
  g.c(8);
}

// CS:5691 - flash the background (colour 4) with speaker clicks for 2 ticks.
export function* flashClicks(g) {
  speakerOff(g);
  g.bios.setPalette(0, 4);
  g.ww(0x5ae2, g.ticks());
  g.ww(0x5ae4, 0);
  g.wb(0x5b06, g.rb(0x697) === 0xfd ? 1 : 2);
  g.c(10);
  for (;;) {
    if (on(g)) {
      g.ww(0x5ae4, g.rw(0x5ae4) + 1);
      const bx = (g.rw(0x5ae4) >> g.rb(0x5b06)) & 0x1f;
      g.out61(g.in61() ^ g.rb(0x5ae6 + bx));
      g.c(8);
    }
    const d = (g.ticks() - g.rw(0x5ae2)) & 0xffff;
    g.c(3);
    if (d >= 2) break;
    yield;
  }
  g.bios.setPalette(0, 0);
  g.wb(0x5b07, 0x0c);
  speakerOff(g);
}

// CS:56f4
export function clickPatternInit(g) {
  g.ww(0x5ad0, g.rb(0x697) === 0xfd ? 0x400 : 0x200);
  g.c(4);
}

// CS:5704 - speaker-bit pattern tick.
export function clickPattern(g) {
  g.ww(0x5ad0, g.rw(0x5ad0) + 1);
  let bx = g.rw(0x5ad0);
  const cl = (bx >> 9) & 0x0f;
  bx = (bx >> cl) & 0x0f;
  const dl = g.rb(0x5ad2 + bx) & g.rb(0x0000);
  g.out61((g.in61() & 0xfc) | dl);
  g.c(16);
}

// CS:576e - one step of a sweep: delay, then tone [5acb].
function sweepStep(g) {
  spin(g, 0x1000);
  g.c(2);
  if (!on(g)) return;
  toneB6(g, g.rw(0x5acb));
}

// CS:572e - three frequency sweeps.
export function sweep(g) {
  g.ww(0x5acb, 0x1f4);
  do {
    sweepStep(g);
    g.ww(0x5acb, g.rw(0x5acb) - 0x1e);
    g.c(3);
  } while (g.rw(0x5acb) > 0xc8);
  g.ww(0x5acb, 0x1f4);
  do {
    sweepStep(g);
    g.ww(0x5acb, g.rw(0x5acb) - 0x14);
    g.c(3);
  } while (g.rw(0x5acb) > 0x12c);
  do {
    sweepStep(g);
    g.ww(0x5acb, g.rw(0x5acb) + 0x1e);
    g.c(3);
  } while (g.rw(0x5acb) < 0x320);
  speakerOff(g);
}

// CS:5797
export function pulseInit(g) {
  speakerOff(g);
  g.wb(0x5acf, 0);
  g.ww(0x5acd, 8);
  g.c(3);
}

// CS:57a6 - pulse-width speaker bit.
export function pulse(g) {
  g.wb(0x5acf, g.rb(0x5acf) + 1);
  const al = g.rb(0x5acf) & 0x3f;
  if (al === 0) g.ww(0x5acd, g.rw(0x5acd) + 1);
  const bl = (g.rw(0x5acd) >> 2) & 0x1f;
  const dl = (al < bl ? 0 : 2) & g.rb(0x0000);
  g.out61((g.in61() & 0xfd) | dl);
  g.c(14);
}

// CS:5b54
export function tuneInit(g) {
  g.ww(0x59be, 0);
  g.ww(0x59c0, g.ticks());
  g.c(3);
}

// CS:5b63 - one note of the tune at DS:5934 every 2 ticks.
export function tuneStep(g) {
  g.c(2);
  if (!on(g)) return;
  const dx = g.ticks();
  g.c(3);
  if (((dx - g.rw(0x59c0)) & 0xffff) < 2) return;
  g.ww(0x59c0, dx);
  let bx = g.rw(0x59be) & 0xfe;
  if (bx >= 0x86) {
    bx = 0;
    g.ww(0x59be, 0);
  }
  g.ww(0x59be, g.rw(0x59be) + 2);
  const ax = g.rw(0x5934 + bx);
  const prev = g.rw(0x59bc);
  g.ww(0x59bc, ax);
  g.c(10);
  if (ax === prev) {
    speakerOff(g);
    return;
  }
  toneB6(g, ax);
}

// CS:5bbf - play the tune until its end marker.
export function* tunePlay(g) {
  for (;;) {
    g.c(2);
    if (!on(g)) return;
    tuneStep(g);
    g.c(2);
    if (g.rw(0x59be) >= 0x7c) return;
    yield;
  }
}

// CS:5be0 - game-over animation with the return tune.
export function* gameOver(g) {
  g.ww(0x5f66, g.ticks());
  g.ww(0x5f60, 0);
  g.c(4);
  for (;;) {
    const bx = g.rw(0x5f60) & 2;
    g.ww(0x5f60, g.rw(0x5f60) + 2);
    copyRect(g, SEG_VRAM, 0x0a74, g.rw(0x5f62 + bx), 4, 0x44);
    let dx;
    for (;;) {
      returnTune(g);
      dx = g.ticks();
      g.c(3);
      if (((dx - g.rw(0x5f66)) & 0xffff) >= 4) break;
      yield;
    }
    g.ww(0x5f66, dx); // MOV [5f66],DX: the value from the loop's last INT 1Ah
    if (g.rw(0x5f60) === 4) copyRect(g, SEG_VRAM, 0x0668, 0x5f68, 4, 0x10);
    const b = g.rw(0x5f60) - 8;
    if (b >= 0 && b < 6) copyRect(g, SEG_VRAM, g.rw(0x60e4 + b), 0x5fe8, 6, 0x15);
    g.c(6);
    if (g.rw(0x5f60) >= 0x10) break;
  }
  speakerOff(g);
}

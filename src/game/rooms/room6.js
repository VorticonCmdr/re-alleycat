// Room 6 (jump-table entry 6 -> CS:02aa). Room-specific routines CS:47b0..CS:4c00.
// The room has twelve slots (DS:4441.. word tables, index BX*2) that the per-tick
// routine CS:47d6 checks against the cat, and twelve counters (DS:44c4.. byte tables,
// index BX) that CS:4943 works on while the cat stands next to them ([44bd] set).

import { registerRoom } from './hooks.js';
import * as CM from './common.js';
import { random, xyAddr, blitAnd, copyRect, overlap, SEG_VRAM } from '../prims.js';
import { hotKeys, pollInput } from '../input.js';
import * as T from '../title.js';
import * as S from '../sound.js';
import * as C from '../cat.js';
import * as A from '../alley.js';

// L4902 / L4aa2 - wait for vertical retrace (CALL 13d8 / JZ back).
function* waitRetrace(g) {
  while (!g.retrace()) {
    g.c(2);
    yield;
  }
  g.c(2);
}

// CS:47b0 - chaser vs. cat while [44bd] is set (called from CS:33ba). Returns CF.
function chaserTest(g) {
  let bx = g.rw(0x579) - 8;
  if (bx < 0) bx = 0;
  const dh = (g.rb(0x57b) + 3) & 0xff;
  g.c(10);
  return overlap(g, g.rw(0x327d), 0x10, bx, 0x28, g.rb(0x327f), 0x1e, dh, 0x0e);
}

// CS:47d6 - every few ticks: check the twelve slots against the cat.
function* slotsUpdate(g) {
  const dx = g.ticks();
  const ax = (dx - g.rw(0x44d7)) & 0xffff;
  let si = (g.rw(0x0008) << 1) & 0xffff;
  g.c(7);
  if (ax <= g.rw((si + 0x44dc) & 0xffff)) return;
  g.ww(0x44d7, dx);
  g.c(2);
  if (g.rb(0x1cb8) !== 0) return;
  g.wb(0x44fc, 0);
  g.c(2);
  for (let cx = 0x0c; cx !== 0; cx--) {
    const bx = ((cx - 1) << 1) & 0xff; // DEC BX / SHL BL,1 (CX <= 12)
    g.c(5);
    if (g.rw(0x4441 + bx) === 0) {
      g.c(1);
      continue; // L487d
    }
    let toL4870 = false;
    const al = g.rw(0x43f9 + bx) & 0xff;
    g.c(3);
    let near = false;
    if (al === g.rb(0x57b)) {
      let d = g.rw(0x43e1 + bx) - g.rw(0x579);
      if (d < 0) d = ~d;
      d &= 0xffff;
      si = (g.rw(0x0008) << 1) & 0xffff;
      g.c(8);
      near = d <= g.rw((si + 0x44ec) & 0xffff);
    }
    if (near) {
      g.c(2);
      if (g.rw(0x4459 + bx) >= 2) {
        g.ww(0x44da, g.rw(0x4411 + bx));
        g.c(3);
        eraseCatOrCounterCat(g);
        blankSlot(g);
        CM.drawChaser(g); // CS:3339
        C.drawCat(g); // CS:1145
        A.dogGrabsCat(g); // CS:2136
        return;
      }
      // L484c
      g.ww(0x4459 + bx, g.rw(0x4459 + bx) + 1);
      g.c(3);
      if (g.rw(0x4459 + bx) >= 2) {
        g.wb(0x44fc, g.rb(0x44fc) + 1);
        g.c(2);
      }
      toL4870 = true;
    } else {
      // L485d
      g.c(2);
      if (g.rw(0x4459 + bx) !== 0) {
        const dl = random(g) & 0xff;
        g.c(3);
        if (dl <= 0x38) {
          g.ww(0x4459 + bx, g.rw(0x4459 + bx) - 1);
          g.c(1);
        }
        toL4870 = true;
      }
    }
    if (toL4870) {
      // L4870
      g.c(5);
      yield* slotTouchesCat(g, bx);
      drawSlotCell(g, bx);
      redrawCatAfterSlot(g);
    }
    // L487d: LOOP
  }
  g.c(2);
  if (g.rb(0x44fc) !== 0) yield* S.flashClicks(g); // CS:5691
}

// CS:488d - erase the cat-at-counter sprite if shown (clearing DS:44bd), else the cat.
function eraseCatOrCounterCat(g) {
  g.c(2);
  if (g.rb(0x44bd) !== 0) {
    eraseCounterCat(g);
    g.wb(0x44bd, 0);
    g.c(2);
    return;
  }
  C.eraseCat(g); // CS:11e3
}

// CS:48a1 - fill DS:000e with 41h words AAAAh and copy it to [44da] (5 words x 13 rows).
function blankSlot(g) {
  g.df = 0; // CLD
  for (let i = 0; i < 0x41; i++) g.ww(0x0e + 2 * i, 0xaaaa);
  g.c(0x41 + 10);
  copyRect(g, SEG_VRAM, g.rw(0x44da), 0x0e, 5, 0x0d);
}

// CS:48c1 - after a slot hit (DS:44d9) redraw the cat or the cat-at-counter sprite.
function redrawCatAfterSlot(g) {
  g.c(2);
  if (g.rb(0x44d9) === 0) return;
  g.c(2);
  if (g.rb(0x44bd) === 0) {
    C.drawCat(g); // CS:1145
    return;
  }
  drawCounterCat(g);
}

// CS:48d7 - does slot BX (doubled) touch the cat? If so, wait for retrace and erase.
function* slotTouchesCat(g, bx) {
  g.wb(0x44d9, 0);
  const ax = (g.rw(0x43e1 + bx) - 0x14) & 0xffff;
  const dl = g.rw(0x43f9 + bx) & 0xff;
  g.c(10);
  if (!overlap(g, ax, 0x28, g.rw(0x579), 0x18, dl, 0x06, g.rb(0x57b), 0x0e)) return;
  g.wb(0x44d9, 1);
  g.c(1);
  yield* waitRetrace(g); // L4902
  g.c(2);
  if (g.rb(0x44bd) !== 0) {
    eraseCounterCat(g);
    return;
  }
  C.eraseCat(g); // CS:11e3
}

// CS:4916 - one 1x1-word cell for slot BX (doubled), picked by its counter.
function drawSlotCell(g, bx) {
  let ax = g.rw(0x4411 + bx);
  let si = ((g.rw(0x4459 + bx) << 1) + 0x4100) & 0xffff;
  ax = (ax + 0xa7) & 0xffff;
  g.c(6);
  if (g.rw(0x4429 + bx) !== 0x429c) {
    ax = (ax - 6) & 0xffff;
    si = (si + 6) & 0xffff;
    g.c(2);
  }
  g.c(4);
  copyRect(g, SEG_VRAM, ax, si, 1, 1);
}

// CS:4943 - per tick: the cat next to one of the twelve counters.
function* countersUpdate(g) {
  g.c(2);
  if (g.rb(0x1cb8) !== 0) return;
  g.c(2);
  if (g.rb(0x44be) !== 0) {
    g.wb(0x698, g.rb(0x44be));
    g.wb(0x699, 0);
    g.c(3);
  }
  // L495c
  const dx = g.ticks();
  g.c(3);
  if (dx === g.rw(0x44d3)) return;
  g.ww(0x44d3, dx);
  g.c(3);
  if (g.rb(0x584) !== 0) {
    g.c(2);
    if (g.rb(0x44bd) === 0) return;
    eraseCounterCat(g);
    CM.eraseChaser(g); // CS:33a0
    C.saveUnderCat(g); // CS:1124
    CM.drawChaser(g); // CS:3339
    g.wb(0x44bd, 0);
    g.wb(0x43e0, 1);
    g.wb(0x44be, 0);
    g.c(4);
    return;
  }
  // L4995
  g.c(2);
  let label;
  if (g.rb(0x69a) !== 0) {
    label = 'L49f9';
  } else {
    // L499f: nearest counter on the cat's row
    g.ww(0x44c1, 0xffff);
    g.ww(0x44bf, 0xffff);
    const si = g.rw(0x579);
    const dl = (g.rb(0x57b) + 8) & 0xff;
    g.c(7);
    for (let cx = 0x0c; cx !== 0; cx--) {
      const bx = cx - 1;
      g.c(4);
      if (g.rb(0x44c4 + bx) < 1) continue;
      g.c(2);
      if (dl !== g.rb(0x4499 + bx)) continue;
      const bx2 = (bx << 1) & 0xff;
      let ax = si - g.rw(0x4481 + bx2);
      let dh = 0xff;
      if (ax < 0) {
        ax = ~ax;
        dh = 1;
      }
      ax &= 0xffff;
      g.c(8);
      if (ax > g.rw(0x44bf)) continue;
      g.ww(0x44bf, ax);
      g.ww(0x44d1, g.rw(0x44a5 + bx2));
      g.ww(0x44c1, bx);
      g.wb(0x44c3, dh);
      g.c(6);
    }
    g.c(2);
    label = g.rw(0x44c1) < 0x0c ? 'L4a20' : 'L49f9';
  }
  if (label === 'L4a20') {
    g.c(2);
    if (g.rw(0x44bf) >= 4) {
      g.c(2);
      if (g.rw(0x44bf) <= 8) {
        g.wb(0x572, 4);
        g.c(1);
      }
      // L4a33
      const al = g.rb(0x44c3);
      g.wb(0x698, al);
      g.wb(0x56e, al);
      g.wb(0x44be, al);
      g.wb(0x699, 0);
      g.wb(0x571, 0);
      g.c(7);
      label = 'L49f9';
    } else {
      yield* catAtCounter(g);
      return;
    }
  }
  // L49f9
  g.c(2);
  if (g.rb(0x44bd) !== 0) {
    eraseCounterCat(g);
    C.drawCat(g); // CS:1145
    g.wb(0x69a, 0x10);
    g.c(1);
  }
  // L4a0b
  g.wb(0x44bd, 0);
  g.wb(0x43e0, 1);
  g.wb(0x44d0, 0);
  g.wb(0x44be, 0);
  g.c(5);
}

// CS:4a4b .. 4b02 - the cat is at counter [44c1].
function* catAtCounter(g) {
  g.wb(0x44be, 0);
  g.c(2);
  if (g.rb(0x44bd) === 0) {
    C.eraseCat(g); // CS:11e3
    C.saveUnderCat(g); // CS:1124
  }
  // L4a5d
  g.wb(0x44bd, 1);
  let al = 0;
  const sum = g.rb(0x44d0) + 0x30;
  g.wb(0x44d0, sum);
  if (sum > 0xff) al = 1;
  g.wb(0x44d5, al);
  let cx = g.rw(0x579) & 0x0ffc;
  const dl = (g.rb(0x57b) + 3) & 0xff;
  g.c(12);
  if (g.rw(0x44d1) === 0x410c) {
    // L4a95
    cx = cx < 8 ? 0 : cx - 8;
    g.c(2);
  } else {
    cx += 8;
    if (cx >= 0x127) cx = 0x126;
    g.c(4);
  }
  // L4a9c
  g.ww(0x43dc, xyAddr(g, cx, dl));
  g.c(1);
  yield* waitRetrace(g); // L4aa2
  eraseCounterCat(g);
  g.c(2);
  if (g.rb(0x44d5) !== 0) {
    const bx = g.rw(0x44c1);
    g.c(3);
    if (g.rb(0x44c4 + bx) !== 0) {
      const n = (g.rb(0x44c4 + bx) - 1) & 0xff;
      g.wb(0x44c4 + bx, n);
      g.c(2);
      if (n === 0) {
        S.effect(g, 0x08fd, 0x0723); // CS:593b
        g.wb(0x698, 0);
        g.wb(0x44be, 0);
        g.wb(0x69a, 0x10);
        const left = (g.rb(0x44d6) - 1) & 0xff;
        g.wb(0x44d6, left);
        g.c(8);
        if (left === 0) {
          g.wb(0x553, 1);
          g.c(1);
        }
      }
      // L4ae7
      g.c(2);
      if (chaserTest(g)) {
        CM.eraseChaser(g); // CS:33a0
        drawCounter(g, bx);
        CM.drawChaser(g); // CS:3339
        g.c(4);
      } else {
        drawCounter(g, bx); // L4afc
      }
    }
  }
  // L4aff
  drawCounterCat(g);
}

// CS:4b03 - restore the background under the cat-at-counter sprite.
function eraseCounterCat(g) {
  g.c(2);
  if (g.rb(0x43e0) !== 0) return;
  g.c(5);
  copyRect(g, SEG_VRAM, g.rw(0x43de), 0x43a0, 3, 0x0a);
}

// CS:4b1d - draw the cat-at-counter sprite at [43dc] (AND-blit, background to 43a0).
function drawCounterCat(g) {
  g.wb(0x43e0, 0);
  const di = g.rw(0x43dc);
  g.ww(0x43de, di);
  let si = g.rw(0x44d1);
  g.c(9);
  if (g.rb(0x44d0) >= 0x80) {
    si = (si + 0x3c) & 0xffff;
    g.c(1);
  }
  g.c(2);
  blitAnd(g, SEG_VRAM, di, si, 0x43a0, 3, 0x0a);
}

// CS:4b47 - room-specific background: place the slots and draw the counters.
function drawBackground(g) {
  // REP STOSW at 4b51 without CLD: honours the direction flag
  let di = 0x4441;
  for (let i = 0; i < 0x0c; i++) {
    g.ww(di, 0);
    di = (di + (g.df ? -2 : 2)) & 0xffff;
  }
  g.c(0x0c + 6);
  let cx = g.rb(0x4471 + g.rw(0x0008));
  g.c(5);
  if (cx === 0) {
    g.unsupported('room 6 slot count 0: LOOP from CX=0 (CS:4b93)');
    return;
  }
  do {
    let bx;
    for (;;) {
      // L4b62
      bx = random(g) & 0x1e;
      g.c(5);
      if (bx >= 0x18) continue;
      g.c(2);
      if (g.rw(0x4441 + bx) !== 0) continue;
      break;
    }
    g.ww(0x4459 + bx, 0);
    g.ww(0x4441 + bx, 1);
    g.c(6);
    copyRect(g, SEG_VRAM, g.rw(0x4411 + bx), g.rw(0x4429 + bx), 5, 0x0d);
    cx--;
    g.c(2);
  } while (cx !== 0);
  for (let c = 0x0c; c !== 0; c--) {
    // L4b98
    const bx = c - 1;
    g.wb(0x44c4 + bx, g.rb(0x4479 + g.rw(0x0008)));
    g.c(7);
    drawCounter(g, bx);
    g.c(2);
  }
  g.wb(0x44d0, 0);
  g.wb(0x44bd, 0);
  g.wb(0x43e0, 1);
  g.wb(0x44d6, 0x0c);
  g.wb(0x44be, 0);
  g.c(5);
}

// CS:4bc8 - draw counter BX (0..11) with its current value.
function drawCounter(g, bx) {
  const di = counterAddr(g, bx);
  const si = ((g.rb(0x44c4 + bx) << 5) + 0x41fc) & 0xffff;
  g.c(9);
  copyRect(g, SEG_VRAM, di, si, 2, 8);
}

// CS:4be8 - screen offset of counter BX.
function counterAddr(g, bx) {
  const dl = g.rb(0x4499 + bx);
  const cx = g.rw(0x4481 + ((bx << 1) & 0xff));
  g.c(6);
  return xyAddr(g, cx, dl);
}

registerRoom(6, {
  // CS:02aa - room 6 entry and loop (loop head CS:02c5).
  *loop(g) {
    g.ww(0x0004, 6);
    g.c(1);
    yield* CM.roomTransition(g); // CS:1bf0
    CM.roomBackground(g); // CS:2790 (calls drawBackground, CS:4b47)
    g.c(1); // CS:4c00 is a bare RET
    C.placeCatFromRoom(g); // CS:07a1
    CM.floorInit(g); // CS:3405
    A.dogInit(g); // CS:1e40
    S.musicReset(g); // CS:58bd
    for (;;) {
      yield 0x02c5; // loop head (sync point)
      yield* hotKeys(g, T.pauseScreen); // CS:1338
      pollInput(g); // CS:1200
      S.alleyMusic(g); // CS:546d
      yield* countersUpdate(g); // CS:4943
      yield* slotsUpdate(g); // CS:47d6
      yield* C.catUpdate(g); // CS:08e5
      g.c(2);
      if (g.rb(0x1cb8) !== 0) A.dogUpdate(g); // CS:1e63
      else CM.chaserUpdate(g); // CS:3150
      g.c(6);
      if ((g.rb(0x551) | g.rb(0x552) | g.rb(0x553) | g.rb(0x41b) | g.rb(0x41c)) !== 0) return;
    }
  },
  drawBackground, // CS:4b47
  chaserTest, // CS:47b0
});

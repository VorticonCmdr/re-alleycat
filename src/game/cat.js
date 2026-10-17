// The cat: placement, per-tick update (CS:08e5), movement, animation and platform tests.

import { random, xyAddr, blitAnd, blitOver, copyRect, saveRect, copyStride, overlap, SEG_DS, SEG_VRAM } from './prims.js';
import * as S from './sound.js';
import * as A from './alley.js';
import * as R from './rooms.js';
import { speakerOff } from './input.js';

// Cat variables (data segment).
export const CAT = {
  X: 0x579, // word, pixel x
  Y: 0x57b, // byte, top y
  Y2: 0x57c, // byte, y + 0x32 (bottom reference used by the physics)
  DIR: 0x56e, // horizontal: 0, 1 right, 0xff left
  PREV_DIR: 0x56f,
  VDIR: 0x571, // vertical: 0 on ground, 1 falling/down, 0xff rising
  PREV_VDIR: 0x570,
  SPEED: 0x572, // word, horizontal step
  VSPEED: 0x576,
  VACC: 0x578,
  VACC_ACC: 0x577,
  SCREEN: 0x55f, // word, CGA offset of the sprite
  NEXT_SCREEN: 0x563,
  SPRITE: 0x55d, // word, sprite data address
  SIZE: 0x565, // word, rows<<8 | words
  SAVED_SIZE: 0x561,
  NOT_DRAWN: 0x583,
  LAST_TICK: 0x57d,
  POLLS: 0x684,
};

// CS:0700
export function resetCatTimer(g) {
  g.ww(0x57d, 0);
  g.ww(0x684, 0);
  g.c(3);
}

function resetCatFlags(g) {
  g.wb(0x550, 0);
  g.wb(0x55c, 0);
  g.wb(0x55a, 0);
  g.wb(0x583, 0);
  g.wb(0x698, 0);
  g.wb(0x699, 0);
  g.wb(0x551, 0);
  g.wb(0x584, 0);
  g.wb(0x552, 0);
  g.ww(0x554, 0);
  g.wb(0x553, 0);
  g.wb(0x127c, 0);
  g.c(12);
}

// CS:070d - cat enters the alley from the left or right edge.
export function placeCatInAlley(g) {
  let cx = 0;
  let ah = 1;
  if (g.rw(0x579) >= 0xa0) {
    cx = 0x128;
    ah = 0xff;
  }
  g.wb(0x56e, ah);
  g.wb(0x558, 3);
  g.wb(0x559, 0x0c);
  g.ww(0x579, cx);
  g.wb(0x57b, 0xb4);
  g.wb(0x57c, 0xe6);
  g.ww(0x55f, xyAddr(g, cx, 0xb4));
  g.ww(0x561, 0x0b03);
  saveUnderCat(g);
  g.wb(0x571, 0);
  g.ww(0x572, 2);
  g.wb(0x576, 1);
  g.wb(0x55b, 0);
  resetCatFlags(g);
  resetCatTimer(g);
  g.c(16);
}

// CS:07a1 - cat appears at its saved alley position (or a room's entry point).
export function placeCatFromRoom(g) {
  const room = g.rw(0x0004);
  let cx;
  let dl;
  if (room === 0) {
    cx = g.rw(0x0001);
    dl = g.rb(0x0003);
  } else {
    dl = g.rb(0x5e9 + room);
    cx = g.rw(0x5d9 + ((room << 1) & 0xff));
  }
  g.ww(0x579, cx);
  g.wb(0x57b, dl);
  g.wb(0x57c, dl + 0x32);
  g.ww(0x55f, xyAddr(g, cx, dl));
  g.ww(0x569, g.rw(0xfb2));
  g.ww(0x567, g.rw(0xfbe));
  g.ww(0x561, g.rw(0xfbe));
  saveUnderCat(g);
  g.wb(0x571, 1);
  g.wb(0x56e, 0);
  g.wb(0x576, 1);
  g.wb(0x578, 0x40);
  g.wb(0x55b, room === 7 ? 0 : 0x0a);
  resetCatFlags(g);
  resetCatTimer(g);
  g.c(20);
  if (room === 2) {
    g.wb(0x576, 0x10);
    g.ww(0x574, 0x10);
    g.ww(0x5f1, g.ticks());
    g.wb(0x5f3, 0);
    g.wb(0x5f4, 5);
    g.wb(0x5f5, 1);
    g.c(8);
  }
}

// CS:1124 - save the screen under the cat (VRAM -> DS:05fa).
export function saveUnderCat(g) {
  const cx = g.rw(0x561);
  saveRect(g, 0x5fa, g.rw(0x55f), cx & 0xff, cx >> 8);
  g.wb(0x583, 0);
  g.c(10);
}

// CS:1112
export function saveUnderCatAt(g) {
  g.ww(0x55f, xyAddr(g, g.rw(0x579), g.rb(0x57b)));
  saveUnderCat(g);
}

// CS:1145 - draw the cat sprite (AND-blit), saving what was under it.
export function drawCat(g) {
  const cx = g.rw(0x565);
  g.ww(0x561, cx);
  g.wb(0x583, 0);
  blitAnd(g, SEG_VRAM, g.rw(0x55f), g.rw(0x55d), 0x5fa, cx & 0xff, cx >> 8);
  g.c(10);
}

// CS:11e3 - restore the background under the cat.
export function eraseCat(g) {
  const cx = g.rw(0x561);
  copyRect(g, SEG_VRAM, g.rw(0x55f), 0x5fa, cx & 0xff, cx >> 8);
  g.c(6);
}

// CS:0fc9 - horizontal move by SPEED in DIR, clamped to the room. Returns CF (hit edge).
export function moveX(g) {
  g.ww(0x5f6, 8);
  g.ww(0x5f8, 0x123);
  if (g.rw(0x0004) === 7) {
    g.ww(0x5f6, 0x24);
    g.ww(0x5f8, 0x10f);
  }
  let ax = g.rw(0x579);
  const dir = g.rb(0x56e);
  g.c(9);
  if (dir === 0) return false;
  if (dir === 1) {
    ax = (ax + g.rw(0x572)) & 0xffff;
    g.c(3);
    if (ax < g.rw(0x5f8)) {
      g.ww(0x579, ax);
      return false;
    }
    g.ww(0x579, g.rw(0x5f8) - 1);
    return true;
  }
  const sp = g.rw(0x572);
  g.c(3);
  if (ax >= sp) {
    ax -= sp;
    if (ax >= g.rw(0x5f6)) {
      g.ww(0x579, ax);
      return false;
    }
  }
  g.ww(0x579, g.rw(0x5f6));
  return true;
}

// CS:1020 - advance the walk cycle; returns the sprite address (BX).
function walkFrame(g) {
  if (g.rb(0x56e) !== g.rb(0x56f)) g.ww(0x572, 2);
  g.c(4);
  if (g.rw(0x572) < 8) {
    const a = (g.rb(0x577) - 1) & 0xff;
    g.wb(0x577, a);
    if ((a & 3) === 0) g.ww(0x572, g.rw(0x572) + 1);
    g.c(5);
  }
  let bl = g.rb(0x56b) + 1;
  if (bl >= 6) bl = 0;
  g.wb(0x56b, bl);
  if (g.rb(0x56e) === 0xff) bl += 6;
  g.c(10);
  return g.rw(0xf7a + 2 * bl);
}

// CS:0f87 - sprite for the "squeezing in at the edge" entry animation.
function edgeEntryFrame(g, al, ah) {
  g.ww(0x565, 0x0b03 - al);
  if (ah === 0xff) {
    g.ww(0x579, ((al << 3) & 0xff) + 0x128);
  } else {
    g.ww(0x55d, g.rw(0x55d) + ((al << 1) & 0xff));
    g.ww(0x579, 0);
  }
  const cx = g.rw(0x565);
  copyStride(g, SEG_DS, 0x0e, g.rw(0x55d), cx & 0xff, cx >> 8, 3);
  g.ww(0x55d, 0x0e);
  g.c(16);
}

// CS:1069 - idle: occasionally redraw the sitting cat with a random head/tail frame.
function idle(g) {
  g.ww(0x572, 2);
  g.wb(0x577, 8);
  g.c(4);
  if (g.rw(0x561) === 0x0c02) {
    const n = (g.rb(0x56d) + 1) & 0xff;
    g.wb(0x56d, n);
    g.c(3);
    if (n & 7) return false;
  }
  eraseCat(g);
  return true; // caller continues with the collision checks (generator part)
}

function* idleRest(g) {
  if (yield* A.thrownHitsCat(g)) return;
  if (A.dogMeetsCat(g)) return;
  let bx = random(g) & 0x0e;
  blitAnd(g, SEG_VRAM, g.rw(0x55f), g.rw(0xf92 + bx), 0x5fa, 2, 6);
  g.ww(0x561, 0x0c02);
  bx = random(g) & 0x06;
  blitAnd(g, SEG_VRAM, (g.rw(0x55f) + 0xf0) & 0xffff, g.rw(0xfa2 + bx), 0x612, 2, 6);
  g.wb(0x583, 0);
  g.c(20);
}

// CS:10dd - knocked off: start falling.
export function startFall(g) {
  g.wb(0x55c, 0);
  g.wb(0x571, 1);
  g.wb(0x576, 2);
  g.wb(0x578, 1);
  g.wb(0x577, 0xff);
  g.wb(0x56e, 0);
  g.wb(0x55a, 1);
  g.ww(0x569, g.rw(0xfac));
  g.ww(0x567, g.rw(0xfb8));
  g.wb(0x550, 2);
  g.c(11);
}

// CS:1166 - the cat is hit: show the hit sprite with its sound for 10 ticks.
export function* catHit(g) {
  let cx = g.rw(0x579) - 0x0c;
  if (cx < 0) cx = 0;
  if (cx >= 0x10f) cx = 0x10e;
  const di = xyAddr(g, cx, g.rb(0x57b));
  g.ww(0x581, di);
  blitOver(g, SEG_VRAM, di, 0x1679, 0x0e, 5, 0x12);
  const t0 = g.ticks();
  g.ww(0x57f, t0);
  g.ww(0x5a3c, 0);
  g.ww(0x5a3e, 0);
  g.c(14);
  do {
    S.hitSound(g); // CS:5a1c
    yield;
    g.c(3);
  } while (((g.ticks() - g.rw(0x57f)) & 0xffff) < 0x0a);
  speakerOff(g);
  copyRect(g, SEG_VRAM, g.rw(0x581), 0x0e, 5, 0x12);
  g.wb(0x583, 0);
  g.c(6);
  if (g.rb(0x1678) !== 0 && g.rb(0x1f80) !== 0) g.wb(0x1f80, g.rb(0x1f80) - 1);
}

// CS:1608 - landing test for the current room. Returns CF.
export function landing(g) {
  const room = g.rw(0x0004);
  g.c(3);
  if (room === 7) return R.room7Landing(g); // CS:30fa
  if (room !== 0) return roomLanding(g); // CS:16c6
  const al = g.rb(0x57b) & 0xf8;
  g.c(4);
  if (al === 0x60) {
    g.c(2);
    if (g.rb(0x550) >= 2) return false;
    g.wb(0x57b, al);
    g.wb(0x57c, al + 0x32);
    if (g.rb(0x550) !== 1) {
      g.wb(0x550, 1);
      g.ww(0x556, g.ticks());
    }
    g.c(8);
    return true;
  }
  if (fenceLanding(g)) return true;
  return lineLanding(g);
}

// CS:1657 - fence-top / trash-can lids from the per-skill table at DS:0ff0.
function fenceLanding(g) {
  const cl = (g.rb(0x57b) + 2) & 0xf8;
  let bx = g.rb(0x1006 + g.rw(0x0008));
  g.c(8);
  for (;;) {
    const al = g.rb(0xff0 + bx);
    g.c(3);
    if (al === 0) {
      g.wb(0x127c, 0);
      return false;
    }
    bx = (bx + 1) & 0xffff;
    const ch = al & 0x80 ? 0x88 : 0x90;
    g.c(5);
    if (cl !== ch) continue;
    const ax = (al & 0x7f) << 2;
    g.c(8);
    if ((g.rw(0x579) & 0xfff8) < ax) continue;
    if ((((g.rw(0x579) - 0x0f) & 0xffff) & 0xfff8) > ax) continue;
    g.wb(0x57b, ch - 2);
    g.wb(0x57c, ch - 2 + 0x32);
    g.c(8);
    if (g.rb(0x127c) === 0) {
      g.wb(0x127c, 1);
      S.landSound(g); // CS:590e
    }
    return true;
  }
}

// CS:1799 - BX -> byte index (BX>>6) and bit mask (0x80 >> ((BX>>3)&7)).
function bitPos(bx) {
  return { index: bx >> 6, mask: 0x80 >> ((bx >> 3) & 7) };
}

// CS:17ad - clothes lines: walkable where the line bitmap at DS:1016 has a bit set.
function lineLanding(g) {
  const dl = g.rb(0x57b) & 0xf8;
  let bx;
  if (dl === 0x08) bx = 0;
  else if (dl === 0x28) bx = 1;
  else if (dl === 0x48) bx = 2;
  else {
    g.c(10);
    return false;
  }
  let ax = g.rw(0x579);
  g.c(10);
  if (bx === g.rw(0x52f) && g.rb(0x525) <= 3) {
    if (bx === 1) ax = (ax - (((g.rb(0x525) + 1) << 2) & 0xff)) & 0xffff;
    else ax = (ax + (((4 - g.rb(0x525)) << 2) & 0xff)) & 0xffff;
    g.c(8);
  }
  const si = g.rb(0x1025 + bx);
  const p = bitPos((ax + 0x0a) & 0xffff);
  g.c(16);
  if (!(g.rb(0x1016 + p.index + si) & p.mask)) return false;
  g.wb(0x57b, dl);
  g.wb(0x57c, dl + 0x32);
  g.ww(0x579, g.rw(0x579) & 0xfff8);
  g.wb(0x55c, 1);
  g.c(6);
  return true;
}

// CS:16c6 - landing/goal test inside rooms 1..6 (table-driven).
function roomLanding(g) {
  g.wb(0x39e0, 0);
  g.c(3);
  if (g.rb(0x571) === 1) {
    const hit = overlap(g, (g.rw(0x2650) - 4) & 0xffff, 0x0c, g.rw(0x579), 0x18,
      (g.rb(0x2652) - 8) & 0xff, 0x10, g.rb(0x57b), 0x0e);
    g.c(10);
    if (hit) {
      g.wb(0x551, 1); // reached the room's goal
      return false;
    }
  }
  if (g.rw(0x0004) === 3 && R.room3Landing(g)) {
    g.wb(0x55c, 1);
    return true;
  }
  const cl = g.rb(0x57b) & 0xf8;
  let bx = g.rw(0x1269 + 2 * g.rw(0x0004));
  g.c(8);
  for (;;) {
    const ch = g.rb(0x1029 + bx);
    g.c(3);
    if (ch === 0) return false;
    g.wb(0x127b, g.rb(0x1089 + bx));
    const bx2 = (bx & 0xff00) | ((bx << 1) & 0xff); // SHL BL,1
    g.ww(0x1279, g.rw(0x11a9 + bx2));
    const ax = g.rw(0x10e9 + bx2);
    bx = (bx2 & 0xff00) | ((bx2 & 0xff) >> 1); // SHR BL,1
    bx = (bx + 1) & 0xffff;
    g.c(10);
    if (cl !== ch) continue;
    g.c(4);
    if ((g.rw(0x579) & 0xfff8) < ax) continue;
    let dx = g.rw(0x579) - g.rw(0x1279);
    if (dx < 0) dx = 0;
    dx &= 0xfffc;
    g.c(6);
    if (dx > ax) continue;
    g.wb(0x57b, ch);
    g.wb(0x57c, ch + 0x32);
    const al = g.rb(0x127b);
    g.wb(0x55c, al);
    if (al !== 0) g.ww(0x579, g.rw(0x579) & 0xfffc);
    g.c(10);
    if (g.rw(0x0004) === 4) {
      let b = (bx - 1) & 0xffff;
      if (b >= 0x27) {
        b -= 0x27;
        if (b < 0x10) g.wb(0x39e0, b + 1);
      }
      g.c(6);
    }
    return true;
  }
}

// CS:08e5 - cat update. Runs on a new BIOS tick, or after 32 calls within a tick.
export function* catUpdate(g) {
  const dx = g.ticks();
  g.c(3);
  let ax = 0; // AX after INT 1Ah AH=0: AH=0, AL=midnight flag (0)
  if (dx === g.rw(0x57d)) {
    const n = g.rw(0x684);
    g.c(3);
    if (n === 0) return;
    g.ww(0x684, n - 1);
    if (n - 1 !== 0) return;
  } else {
    ax = g.rb(0x697) === 0xfd ? 0x10 : 0x20;
    g.ww(0x684, ax);
    g.c(5);
  }
  // L090c
  const room = g.rw(0x0004);
  g.c(4);
  if (room === 2 || (g.rb(0x571) | g.rb(0x56e)) === 0) {
    if (!g.retrace()) return;
  }
  g.ww(0x57d, dx);
  g.ww(0x57f, ax);
  g.c(4);
  if (room === 4 && g.rb(0x39e1) !== 0) return;
  if (room === 6 && g.rb(0x44bd) !== 0) return;
  g.c(4);
  if (room === 2) {
    yield* R.room2Swim(g); // CS:0953 .. 0bab
    return;
  }
  yield* catNormal(g);
}

// CS:0bac .. 0f86
function* catNormal(g) {
  if (yield* A.thrownHitsCat(g)) return; // CS:1b7a
  g.c(3);
  if (g.rb(0x1cb8)) return;
  if (g.rb(0x558) !== 0) {
    g.c(3);
    if (g.rb(0x559) !== 0) {
      if (g.rb(0x1cbf) === 0) g.wb(0x559, g.rb(0x559) - 1);
      g.c(3);
      return;
    }
    const n = (g.rb(0x558) - 1) & 0xff;
    g.wb(0x558, n);
    g.c(2);
    if (n === 0) {
      g.ww(0x572, 8);
      moveX(g);
      // fall through to L0c1c
    } else {
      g.ww(0x55d, walkFrame(g));
      edgeEntryFrame(g, g.rb(0x558), g.rb(0x56e));
      if (g.rb(0x558) !== 2) eraseCat(g);
      if (yield* A.thrownHitsCat(g)) return;
      if (A.dogMeetsCat(g)) return;
      g.ww(0x55f, xyAddr(g, g.rw(0x579), g.rb(0x57b)));
      drawCat(g);
      return;
    }
  }
  // L0c1c
  const lock = g.rb(0x55c);
  g.c(3);
  if (lock >= 1) {
    if (lock === 1) {
      g.wb(0x55c, 2);
      g.ww(0x572, 6);
      g.ww(0x563, xyAddr(g, g.rw(0x579), g.rb(0x57b)));
      eraseCat(g);
      if (yield* A.thrownHitsCat(g)) return;
      if (A.dogMeetsCat(g)) return;
      g.ww(0x55f, g.rw(0x563));
      g.ww(0x565, 0x0e03);
      g.ww(0x55d, 0x09da);
      drawCat(g);
    }
    g.c(3);
    if (g.rb(0x699) === 0) return;
    yield* intent(g); // L0e78
    return;
  }
  // L0c6a
  if (g.rb(0x571) === 0) {
    yield* onGround(g); // L0e23
    return;
  }
  yield* airborne(g);
}

// L0c74 .. L0e22: falling or jumping.
function* airborne(g) {
  if (moveX(g)) {
    g.wb(0x56e, 0);
    g.wb(0x576, 2);
    g.wb(0x571, 1);
    g.wb(0x55b, 0);
    g.c(4);
  } else {
    const a = g.rb(0x577) - g.rb(0x578);
    g.wb(0x577, a & 0xff);
    g.c(4);
    if (a < 0) {
      if (g.rb(0x571) === 1) {
        if (g.rb(0x576) < 4) g.wb(0x576, g.rb(0x576) + 1);
      } else if (g.rb(0x576) > 1) {
        g.wb(0x576, g.rb(0x576) - 1);
      } else {
        g.wb(0x571, 1);
      }
      g.c(4);
    }
  }
  // L0cc1
  let al;
  let landed = false;
  g.c(3);
  if (g.rb(0x55a) === 0) {
    let check = true;
    if (g.rb(0x55b) !== 0) {
      const n = (g.rb(0x55b) - 1) & 0xff;
      g.wb(0x55b, n);
      g.c(2);
      if (n !== 0) check = false;
    }
    if (check && g.rb(0x571) === 1 && landing(g)) {
      al = g.rb(0x57c);
      landed = true;
    }
  }
  if (!landed) {
    // L0ce7
    al = g.rb(0x57c);
    g.c(4);
    if (g.rb(0x571) === 1) {
      al = (al + g.rb(0x576)) & 0xff;
      g.c(3);
      if (al > 0xe6) {
        if (g.rw(0x0004) === 7) {
          if (al >= 0xf8) {
            al = 0xf8;
            g.wb(0x551, 1);
          }
        } else {
          al = 0xe6;
          g.wb(0x550, 0);
          landed = true;
        }
      }
    } else {
      const v = al - g.rb(0x576);
      g.c(2);
      if (v < 0) {
        al = 0;
        g.wb(0x571, 1);
        g.wb(0x576, 1);
      } else al = v;
    }
  }
  if (landed) {
    // L0d29
    g.wb(0x571, 0);
    g.wb(0x584, 0);
    g.ww(0x572, 2);
    g.wb(0x55b, 0);
    g.wb(0x55a, 0);
    g.c(7);
    if (g.rb(0x55c) !== 0) yield* S.landThud(g); // CS:5ac2
  }
  // L0d4f
  g.wb(0x57c, al);
  g.wb(0x57b, al < 0x32 ? 0 : al - 0x32);
  g.ww(0x563, xyAddr(g, g.rw(0x579), g.rb(0x57b)));
  g.c(8);
  if (g.rb(0x583) === 0) eraseCat(g);
  if ((yield* A.thrownHitsCat(g)) || A.dogMeetsCat(g)) {
    g.wb(0x583, 1);
    return;
  }
  g.ww(0x55f, g.rw(0x563));
  let spr;
  let size;
  if (g.rb(0x584) !== 0) {
    g.ww(0x585, g.rw(0x585) + 2);
    const bx = g.rw(0x585) & 0x0e;
    spr = g.rw(0xfc2 + bx);
    size = g.rw(0xfd2 + bx);
  } else {
    spr = g.rw(0x569);
    size = g.rw(0x567);
  }
  g.ww(0x55d, spr);
  g.ww(0x565, size);
  g.c(10);
  const top = 0x32 - g.rb(0x57c);
  if (top > 0) {
    // partially above the screen: clip rows off the top
    g.c(0x168 + 4); // LOOP $ delay with CX=168h
    const rows = (size >> 8) - top;
    if (rows <= 0) {
      g.wb(0x583, 1);
      return;
    }
    const bx = ((rows & 0xff) << 8) | (size & 0xff);
    g.ww(0x565, bx);
    const mul = ((top & 0xff) * (((size & 0xff) << 1) & 0xff)) & 0xffff;
    g.ww(0x55d, (mul + g.rw(0x569)) & 0xffff);
    g.c(8);
    drawCat(g);
    return;
  }
  // L0dde: clip rows at the bottom when sinking into the floor
  let over;
  if (g.rw(0x0004) === 7) {
    over = g.rb(0x57b) - 0xbb;
  } else {
    if (g.rb(0x550) !== 2) {
      drawCat(g);
      return;
    }
    over = g.rb(0x57b) - 0x5e;
  }
  g.c(4);
  if (over < 0) {
    drawCat(g);
    return;
  }
  const rows = (size >> 8) - over;
  g.c(3);
  if (rows <= 0) {
    if (g.rw(0x0004) === 7) {
      g.wb(0x551, 1);
      return;
    }
    placeCatInAlley(g); // CS:070d
    yield* S.fellSound(g); // CS:59cb
    return;
  }
  g.ww(0x565, ((rows & 0xff) << 8) | (size & 0xff));
  g.wb(0x576, 2);
  g.c(3);
  drawCat(g);
}

// L0e23 .. L0e77: standing on something.
function* onGround(g) {
  const room = g.rw(0x0004);
  g.c(3);
  if (room === 7 || g.rb(0x57b) < 0xb4) {
    if (!landing(g)) {
      g.wb(0x56e, 0);
      g.wb(0x571, 1);
      g.c(3);
      startJump(g, 'fall'); // L0eb1
      return;
    }
    g.c(3);
    if (room === 0) {
      if (!A.critterTouches(g)) {
        // CS:22f7
        g.wb(0x56c, 0);
      } else {
        if (g.rb(0x56c) === 0) S.squeak(g); // CS:591f
        g.wb(0x699, 1);
        g.wb(0x56c, 1);
        const dl = random(g) & 1;
        g.wb(0x698, dl ? 1 : 0xff);
        g.c(8);
      }
    }
  }
  yield* intent(g);
}

// L0e78: apply the requested direction.
function* intent(g) {
  g.wb(0x56f, g.rb(0x56e));
  g.wb(0x56e, g.rb(0x698));
  const v = g.rb(0x699);
  g.wb(0x571, v);
  g.c(8);
  if (v !== 0) {
    if (v === 1) {
      if (g.rb(0x57b) >= 0xb4) {
        g.wb(0x571, 0);
        g.wb(0x584, 0);
        g.wb(0x699, 0);
        g.c(4);
        yield* walk(g); // L0f34
        return;
      }
      startJump(g, 'fall');
      return;
    }
    startJump(g, 'jump');
    return;
  }
  yield* walk(g);
}

// L0eb1 / L0ec9 .. L0f33: begin a fall (down) or a jump (up).
function startJump(g, kind) {
  let al;
  let ah;
  if (kind === 'fall') {
    ah = 1;
    al = 0x20;
    g.wb(0x55b, 8);
    if (g.rb(0x550) === 1) g.wb(0x550, 0);
    g.c(5);
  } else {
    g.wb(0x55b, 0);
    const sp = g.rw(0x572);
    const bl = sp & 0xff;
    let a = bl;
    if (a > 2) a -= 2;
    g.ww(0x572, (sp & 0xff00) | a);
    ah = 8;
    al = ((bl ^ 0x0f) << 4) & 0xff;
    if (g.rb(0x550) === 1) g.wb(0x550, 2);
    g.c(12);
  }
  // L0ef1
  g.wb(0x578, al);
  g.wb(0x576, ah);
  g.wb(0x577, 1);
  g.wb(0x55c, 0);
  let bl = ((g.rb(0x56e) + 1) << 1) & 0xff;
  if (g.rb(0x571) !== 0xff) bl = (bl + 6) & 0xff;
  g.ww(0x569, g.rw(0xfaa + bl));
  g.ww(0x567, g.rw(0xfb6 + bl));
  g.wb(0x39e0, 0);
  g.c(14);
  if (g.rb(0x127c) !== 0) S.jumpOffSound(g); // CS:58f8
}

// L0f34 .. L0f86: walking (or idling) on the ground.
function* walk(g) {
  const room = g.rw(0x0004);
  g.c(3);
  if (room !== 0 && room !== 7) R.roomWalkHook(g); // CS:3445
  moveX(g);
  g.ww(0x563, xyAddr(g, g.rw(0x579), g.rb(0x57b)));
  g.c(6);
  if ((g.rb(0x56e) | g.rb(0x571)) === 0) {
    if (idle(g)) yield* idleRest(g);
    return;
  }
  g.ww(0x55d, walkFrame(g));
  eraseCat(g);
  if (yield* A.thrownHitsCat(g)) return;
  if (A.dogMeetsCat(g)) return;
  g.ww(0x55f, g.rw(0x563));
  g.ww(0x565, 0x0b03);
  drawCat(g);
}

export { random, overlap, blitAnd };

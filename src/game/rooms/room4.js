// Room 4 (jump-table entry CS:0349). Room-specific routines CS:3e90..CS:431c.
// All tables, sprites and screen offsets are read from the data segment at runtime.

import { registerRoom } from './hooks.js';
import { random, xyAddr, copyRect, blitAnd, overlap, SEG_VRAM } from '../prims.js';
import { hotKeys, pollInput } from '../input.js';
import { pauseScreen } from '../title.js';
import * as S from '../sound.js';
import { placeCatFromRoom, catUpdate, eraseCat, saveUnderCat, saveUnderCatAt } from '../cat.js';
import { dogInit, dogUpdate, drawShapes } from '../alley.js';
import { roomTransition, roomBackground, floorInit, chaserUpdate, drawChaser, eraseChaser } from './common.js';

// CS:4065 - chaser touches the cat. Returns CF.
function chaserOnCat(g) {
  g.c(8);
  return overlap(g, g.rw(0x327d), 0x10, g.rw(0x579), 0x18, g.rb(0x327f), 0x1e, g.rb(0x57b), 0x0e);
}

// CS:3e90 - the cat has climbed onto something (DS:39e0 set by the landing code):
// once the chaser leaves it alone, it is carried over to another spot in a
// short 7-step animation (DS:39e1 counts down by 2 per BIOS tick).
function carryUpdate(g) {
  g.c(3);
  if (g.rb(0x39e1) !== 0) {
    const dx = g.ticks();
    g.c(3);
    if (dx === g.rw(0x3d16)) return;
  } else {
    g.c(6);
    if (g.rb(0x584) !== 0 || g.rb(0x69a) !== 0 || g.rb(0x39e0) === 0) return;
    if (chaserOnCat(g)) return; // CS:4065
    const dx = g.ticks();
    g.c(5);
    if (((dx - g.rw(0x3d18)) & 0xffff) < 0x0c) return;
    g.ww(0x3d18, dx);
    g.wb(0x55c, 0);
    let bx = (g.rb(0x39e0) - 1) & 0xff; // BH = 0
    let si = (bx << 2) & 0xffff;
    g.ww(0x39e2, g.rw(si + 0x3c5a));
    g.ww(0x39e4, bx < 3 ? 0x80 : 0);
    bx = g.rb(bx + 0x3ce3);
    si = (bx << 2) & 0xffff;
    g.ww(0x39e6, g.rw(si + 0x3c5a));
    g.ww(0x39e8, bx < 3 ? 0x80 : 0);
    g.wb(0x3d05, g.rb(bx + 0x1050));
    bx = (bx << 1) & 0xff; // SHL BL,1 (BH = 0)
    g.ww(0x3d03, g.rw(bx + 0x1137) + 8);
    g.c(30);
    eraseCat(g); // CS:11e3
    g.wb(0x39e1, 0x0e);
    g.wb(0x69a, 0x10);
  }
  // L3f35
  g.c(2);
  if (g.rb(0x1cbf) === 0) eraseChaser(g); // CS:33a0
  g.wb(0x39e1, g.rb(0x39e1) - 2);
  const bx = g.rb(0x39e1);
  let di;
  let ax;
  g.c(5);
  if (bx >= 8) {
    di = g.rw(0x39e2);
    ax = g.rw(0x39e4);
    g.c(3);
  } else {
    di = g.rw(0x39e6);
    const al = g.rb(0x3d05);
    g.wb(0x57b, al);
    g.wb(0x57c, al + 0x32);
    g.ww(0x579, g.rw(0x3d03));
    ax = g.rw(0x39e8);
    g.c(7);
  }
  const si = (ax + g.rw(bx + 0x3d06)) & 0xffff;
  g.c(5);
  copyRect(g, SEG_VRAM, di, si, 2, 0x10);
  g.c(2);
  if (g.rb(0x1cbf) === 0) drawChaser(g); // CS:3339
  g.ww(0x3d16, g.ticks());
  g.c(5);
  if (g.rb(0x39e1) === 0) saveUnderCatAt(g); // CS:1112
}

// CS:3f9e - room-specific part of the background (called from CS:2790), and the
// per-skill table at DS:3ce3 / 3ce4 (with DS:3cf3 / 3cf4 cleared).
function drawBackground(g) {
  g.wb(0x39e0, 0);
  g.wb(0x39e1, 0);
  g.ww(0x3cbf, 0x506);
  g.ww(0x3cc1, 0);
  g.c(8);
  do {
    let cx = g.rb(g.rw(0x3cc1) + 0x3cae); // CH = 0
    let bx = 0;
    g.c(6);
    if (cx === 0) g.unsupported('room 4 background row with count 0 (LOOP of 65536) (CS:3fee)');
    do {
      let si = 0x3aea;
      const dl = random(g) & 0xff;
      g.c(4);
      if (dl <= 0x30) {
        si = 0x3af8;
        g.c(3);
        if (!(dl & 4)) si = 0x3b02;
      }
      const di = (g.rw(0x3cbf) + bx) & 0xffff;
      copyRect(g, SEG_VRAM, di, si, 1, 8);
      bx = (bx + 2) & 0xffff;
      cx = (cx - 1) & 0xffff;
      g.c(9);
    } while (cx !== 0);
    g.ww(0x3cbf, g.rw(0x3cbf) + 0x140);
    g.ww(0x3cc1, g.rw(0x3cc1) + 1);
    g.c(4);
  } while (g.rw(0x3cc1) < 0x11);
  drawShapes(g, 0x3c22, 0);
  drawShapes(g, 0x3c3e, 0);
  drawShapes(g, 0x3c9a, 0);
  drawShapes(g, 0x3c56, 0);
  g.c(12);
  blitAnd(g, SEG_VRAM, 0x8ec, 0x3caa, 0x0e, 2, 1);
  let si = 0;
  let bx = g.rw(0x0008);
  bx = (bx & 0xff00) | (((bx & 3) << 3) & 0xff); // AND BL,3 / SHL BL,3
  g.c(6);
  do {
    const v = g.rb(bx + 0x3cc3);
    g.wb(si + 0x3ce3, v >> 4);
    g.wb(si + 0x3cf3, 0);
    g.wb(si + 0x3ce4, v & 0x0f);
    g.wb(si + 0x3cf4, 0);
    si += 2;
    bx = (bx + 1) & 0xffff;
    g.c(11);
  } while (si < 0x10);
}

// CS:42b4 - position of object BX (SI = 2*BX) from its spot index DS:3eba[SI].
function objectPlace(g, si, bx) {
  let di = g.rw(si + 0x3eba);
  let al = g.rb(di + 0x1050);
  const dl = di < 3 ? 0 : 0x0a;
  al = (al - dl + 3) & 0xff;
  g.wb(bx + 0x3ed4, al);
  di = (di << 1) & 0xffff;
  g.ww(si + 0x3ecc, g.rw(di + 0x1137) + 8);
  g.c(12);
}

// CS:42db - object touches the cat. Returns CF.
function objectOnCat(g, si, bx) {
  g.c(10);
  return overlap(g, g.rw(si + 0x3ecc), 0x10, g.rw(0x579), 0x18, g.rb(bx + 0x3ed4), 0x0c, g.rb(0x57b), 0x0e);
}

// CS:42fc - object touches the chaser. Returns CF.
function objectOnChaser(g, si, bx) {
  g.c(10);
  return overlap(g, g.rw(si + 0x3ecc), 0x10, g.rw(0x327d), 0x10, g.rb(bx + 0x3ed4), 0x0c, g.rb(0x327f), 0x1e);
}

// CS:431c - object within distance BP (|dx| + |dy|) of the cat. Returns CF.
function objectNearCat(g, si, bx, bp) {
  let ax = g.rw(si + 0x3ecc) - g.rw(0x579);
  if (ax < 0) ax = ~ax;
  ax &= 0xffff;
  let dl = g.rb(bx + 0x3ed4) - g.rb(0x57b);
  if (dl < 0) dl = ~dl;
  dl &= 0xff;
  ax = (ax + dl) & 0xffff;
  g.c(12);
  return ax < bp;
}

// CS:4277 - pick a free spot (0..15, not used by another object) for object BX;
// up to 0x20 retries to keep it away from the cat.
function objectNewSpot(g, si, bx) {
  g.wb(0x3ed9, 0x20);
  g.c(2);
  for (;;) {
    let dx;
    let clash;
    do {
      dx = random(g) & 0x0f;
      clash = false;
      g.c(3);
      for (let di = 0; di < 8; di += 2) {
        g.c(4);
        if (di === si) continue;
        g.c(2);
        if (dx === g.rw(di + 0x3eba)) {
          clash = true;
          break;
        }
      }
    } while (clash);
    g.ww(si + 0x3eba, dx);
    objectPlace(g, si, bx); // CS:42b4
    g.c(3);
    if (g.rb(0x3ed9) === 0) return;
    if (!objectNearCat(g, si, bx, 0x32)) return; // CS:431c
    g.wb(0x3ed9, g.rb(0x3ed9) - 1);
    g.c(2);
  }
}

// CS:4254 - restore the background under the current object (DS:3eda).
function objectErase(g) {
  const bx = g.rw(0x3eda);
  const si = (bx << 1) & 0xffff;
  g.c(5);
  if (g.rb(bx + 0x3eae) !== 0) return;
  copyRect(g, SEG_VRAM, g.rw(si + 0x3ea6), g.rw(si + 0x3ec2), 2, 0x0c);
}

// CS:4090 - initialise the four objects.
function objectsInit(g) {
  for (let cx = 4; cx !== 0; cx--) {
    const bx = cx - 1;
    const si = bx << 1;
    g.wb(bx + 0x3eae, 1);
    g.wb(bx + 0x3eb2, 0);
    g.c(6);
    objectNewSpot(g, si, bx); // CS:4277
    const dl = ((random(g) & 0x0f) + 0x14) & 0xff;
    g.wb(bx + 0x3eb6, dl);
    g.c(4);
  }
  g.ww(0x3eda, 0);
  g.wb(0x3ed8, 4);
  g.c(3);
}

// CS:40c2 - once per BIOS tick: advance one of the objects (round robin over
// DS:3eda), let the cat catch it, show / hide it.
function objectsUpdate(g) {
  const dx = g.ticks();
  g.c(3);
  if (dx === g.rw(0x3edc)) return;
  g.ww(0x3eda, g.rw(0x3eda) + 1);
  let bx = g.rw(0x3eda);
  g.c(5);
  if (bx <= 2) {
    g.ww(0x3edc, dx);
  } else if (bx >= 4) {
    bx = 0;
    g.ww(0x3eda, bx);
    g.ww(0x3edc, dx);
    g.c(3);
  }
  // L40e9
  let si = (bx << 1) & 0xffff;
  g.c(4);
  if (g.rb(bx + 0x3eb2) !== 0) return;
  let caught = objectOnCat(g, si, bx); // CS:42db
  if (!caught) {
    if (objectOnChaser(g, si, bx)) return; // CS:42fc
    g.c(3);
    if (g.rb(bx + 0x3eb6) === 0) {
      objectNewSpot(g, si, bx); // CS:4277
      const dl = ((random(g) & 7) + 0x14) & 0xff;
      g.wb(bx + 0x3eb6, dl);
      g.c(4);
    }
    g.wb(bx + 0x3eb6, g.rb(bx + 0x3eb6) - 1);
    caught = objectOnCat(g, si, bx); // CS:42db
  }
  if (caught) {
    // L4124
    g.c(3);
    if (g.rb(bx + 0x3eae) !== 0) return;
    g.c(2);
    if (g.rb(bx + 0x3eb6) >= 0x14) return;
    eraseCat(g); // CS:11e3
    objectErase(g); // CS:4254
    bx = g.rw(0x3eda);
    g.wb(bx + 0x3eb2, 1);
    saveUnderCat(g); // CS:1124
    g.wb(0x55c, 0);
    g.wb(0x3ed8, g.rb(0x3ed8) - 1);
    g.c(8);
    if (g.rb(0x3ed8) === 0) g.wb(0x553, 1);
    const al = ((4 - g.rb(0x3ed8)) << 2) & 0xff;
    const di = (al + 0x51) & 0xffff;
    g.c(12);
    blitAnd(g, SEG_VRAM, di, 0x3d20, 0x0e, 2, 0x0c);
    S.effect(g, 0x3e8, 0x2ee); // CS:593b
    return;
  }
  // L4181
  objectPlace(g, si, bx); // CS:42b4
  const bp = g.rw(((g.rw(0x0008) << 1) & 0xffff) + 0x3ede);
  g.c(4);
  if (objectNearCat(g, si, bx, bp)) {
    // CS:4191
    g.c(2);
    const v = g.rb(bx + 0x3eb6);
    if (v >= 2) {
      g.c(4);
      if (v <= 0x11) g.wb(bx + 0x3eb6, 1);
      else if (v < 0x14) g.wb(bx + 0x3eb6, 0);
    }
  }
  // L41b0
  const al = g.rb(bx + 0x3eb6);
  let ax;
  g.c(4);
  if (al <= 1) {
    // L41d8
    const add = g.rw(si + 0x3eba) >= 3 ? 1 : 3;
    g.wb(bx + 0x3ed4, g.rb(bx + 0x3ed4) + add);
    g.c(6);
    ax = g.rb(bx + 0x3eb6) >= 1 ? 0x3d80 : 0x3db0;
  } else if (al < 0x12) {
    // L41f8
    const di = ((al << 1) & 0xff) & 2;
    ax = g.rw(di + 0x3de0);
    g.c(4);
  } else {
    const add = g.rw(si + 0x3eba) >= 3 ? 1 : 3;
    g.wb(bx + 0x3ed4, g.rb(bx + 0x3ed4) + add);
    const v = g.rb(bx + 0x3eb6);
    g.c(7);
    if (v < 0x13) ax = 0x3d80;
    else if (v === 0x13) ax = 0x3db0;
    else ax = 0;
  }
  // L4204
  g.ww(0x3eca, ax);
  g.ww(0x3de4, xyAddr(g, g.rw(si + 0x3ecc), g.rb(bx + 0x3ed4)));
  g.c(4);
  objectErase(g); // CS:4254
  bx = g.rw(0x3eda);
  si = (bx << 1) & 0xffff;
  g.c(3);
  if (objectOnChaser(g, si, bx)) return; // CS:42fc
  g.c(2);
  if (g.rw(0x3eca) === 0) {
    g.wb(bx + 0x3eae, 1);
    return;
  }
  g.wb(bx + 0x3eae, 0);
  const di = g.rw(0x3de4);
  g.ww(si + 0x3ea6, di);
  g.c(8);
  blitAnd(g, SEG_VRAM, di, g.rw(0x3eca), g.rw(si + 0x3ec2), 2, 0x0c);
}

registerRoom(4, {
  // CS:0349
  *loop(g) {
    g.ww(0x0004, 4);
    g.c(1);
    yield* roomTransition(g); // CS:1bf0
    roomBackground(g); // CS:2790
    placeCatFromRoom(g); // CS:07a1
    floorInit(g); // CS:3405
    dogInit(g); // CS:1e40
    objectsInit(g); // CS:4090
    S.musicReset(g); // CS:58bd
    for (;;) {
      yield 0x0364; // loop head L0364 (sync point)
      yield* hotKeys(g, pauseScreen); // CS:1338
      pollInput(g); // CS:1200
      S.alleyMusic(g); // CS:546d
      yield* catUpdate(g); // CS:08e5
      carryUpdate(g); // CS:3e90
      objectsUpdate(g); // CS:40c2
      chaserUpdate(g); // CS:3150
      dogUpdate(g); // CS:1e63
      g.c(6);
      if ((g.rb(0x552) | g.rb(0x553) | g.rb(0x551) | g.rb(0x41c) | g.rb(0x41b)) !== 0) return;
    }
  },
  drawBackground, // CS:3f9e
});

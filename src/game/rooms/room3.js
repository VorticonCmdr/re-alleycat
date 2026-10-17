// Room 3 (jump table entry 3, CS:0394): three targets on the wall the cat has to hit,
// a creature moving around the room (DS:3964..), and ledges the cat can land on.
// Routines CS:3b30..CS:3e88.

import { registerRoom } from './hooks.js';
import { roomTransition, roomBackground, floorInit, chaserUpdate } from './common.js';
import { random, xyAddr, copyRect, blitOver, overlap, SEG_VRAM } from '../prims.js';
import { hotKeys, pollInput } from '../input.js';
import { pauseScreen } from '../title.js';
import * as S from '../sound.js';
import { catUpdate, placeCatFromRoom, eraseCat, saveUnderCat } from '../cat.js';
import { dogInit, dogUpdate } from '../alley.js';

// CS:3b30 - three targets, all active.
function targetsInit(g) {
  g.wb(0x37af, 3);
  g.ww(0x37b0, 1);
  g.ww(0x37b2, 1);
  g.ww(0x37b4, 1);
  g.c(5);
}

// CS:3ba3 - target BX is hit: clear it on screen; the last one completes the room.
function targetHit(g, bx) {
  g.ww(0x37b0 + bx, 0);
  g.df = 0; // CLD
  for (let i = 0; i < 0x20; i++) g.ww(0x0e + 2 * i, 0xaaaa);
  g.c(0x20 + 8);
  copyRect(g, SEG_VRAM, g.rw(0x37a9 + bx), 0x0e, 2, 0x10);
  g.wb(0x37af, g.rb(0x37af) - 1);
  g.c(3);
  if (g.rb(0x37af) !== 0) return;
  g.c(2);
  if (g.rb(0x552) !== 0) return;
  g.wb(0x553, 1);
}

// CS:3b42 - once per BIOS tick: does the cat touch one of the active targets?
function targetsUpdate(g) {
  const dx = g.ticks();
  g.c(4);
  if (dx === g.rw(0x37b8)) return;
  g.ww(0x37b8, dx);
  g.ww(0x37b6, 4);
  g.c(2);
  for (;;) {
    const bx = g.rw(0x37b6);
    g.c(3);
    if (g.rw(0x37b0 + bx) !== 0) {
      const ax = g.rw(0x37a3 + bx);
      g.c(8);
      if (overlap(g, ax, 0x10, g.rw(0x579), 0x18, 0x18, 0x10, g.rb(0x57b), 0x0e)) {
        S.effect(g, 0x0c00, 0x08fd); // CS:593b
        eraseCat(g); // CS:11e3
        creatureErase(g); // CS:3e38
        targetHit(g, g.rw(0x37b6)); // CS:3ba3
        saveUnderCat(g); // CS:1124
        creatureDraw(g); // CS:3e14
        g.c(8);
        return;
      }
    }
    // SUB word [37b6],2 / JNC
    const v = g.rw(0x37b6);
    g.ww(0x37b6, v - 2);
    g.c(2);
    if (v < 2) return;
  }
}

// CS:3bdb - room-specific background: 16 rows of 16 8x8 tiles from DS:3730+AL.
function drawBackground(g) {
  g.ww(0x37a0, 0x66a);
  let cx = 0x10;
  g.c(5);
  for (;;) {
    // L3be9
    let al = 0;
    let bx = 0;
    g.c(2);
    for (;;) {
      // L3bed
      g.wb(0x37a2, al);
      const si = (al + 0x3730) & 0xffff;
      const di = (g.rw(0x37a0) + bx) & 0xffff;
      g.c(10);
      copyRect(g, SEG_VRAM, di, si, 1, 8);
      bx += 2;
      g.c(4);
      if (bx < 0x1e) {
        // L3c1e
        g.c(2);
        let pick36 = true;
        if (g.rb(0x37a2) !== 0x50) {
          g.c(2);
          if (!(cx & 1)) {
            const dl = random(g) & 0xff;
            g.c(2);
            if (dl >= 0x40) {
              al = 0x10;
              g.c(2);
              pick36 = false;
            }
          }
        }
        if (pick36) {
          // L3c36
          const dl = random(g) & 0xff;
          al = ((((dl - (bx & 0xff)) & 0xff) & 0x30) + 0x30) & 0xff;
          g.c(5);
        }
        continue;
      }
      if (bx === 0x1e) {
        al = 0x20;
        g.c(2);
        continue;
      }
      break;
    }
    g.ww(0x37a0, g.rw(0x37a0) + 0x140);
    cx = (cx - 1) & 0xffff;
    g.c(2);
    if (cx === 0) return;
  }
}

// CS:3c43 - room 3 landing test (called from CS:1703 in CS:16c6): snap the cat onto a ledge.
// Returns CF.
function landing(g) {
  const ax = g.rw(0x579) & 0xfffc;
  g.c(3);
  if (ax < 0xa4) return false;
  g.c(2);
  if (ax > 0x118) return false;
  let dl = ((g.rb(0x57b) - 2) & 0xff) & 0xf8;
  g.c(4);
  if (!(dl & 8)) return false;
  g.c(2);
  if (dl < 0x28) return false;
  g.c(2);
  if (dl > 0xa0) return false;
  g.ww(0x579, ax);
  dl = (dl + 2) & 0xff;
  g.wb(0x57b, dl);
  g.wb(0x57c, (dl + 0x32) & 0xff);
  g.c(6);
  return true;
}

// CS:3c90 - creature start state.
function creatureInit(g) {
  g.wb(0x3966, 8);
  g.wb(0x396a, 1);
  g.wb(0x3967, 0);
  g.wb(0x396d, 2);
  g.ww(0x3964, 0x118);
  g.ww(0x396b, 0);
  g.c(7);
}

// CS:3e14 - draw the creature at DS:39ca (transparent blit, background to DS:396f).
function creatureDraw(g) {
  const di = g.rw(0x39ca);
  g.ww(0x3968, di);
  g.wb(0x396a, 0);
  const si = (g.rw(0x396b) + 0x38bc) & 0xffff;
  g.c(9);
  blitOver(g, SEG_VRAM, di, si, 0x396f, 3, 0x0e);
}

// CS:3e38 - restore the background under the creature (unless nothing was drawn).
function creatureErase(g) {
  g.c(4);
  if (g.rb(0x396a) !== 0) return;
  g.c(4);
  copyRect(g, SEG_VRAM, g.rw(0x3968), 0x396f, 3, 0x0e);
}

// CS:3e52 - creature touches the room chaser. Returns CF.
function creatureTouchesChaser(g) {
  g.c(7);
  return overlap(g, g.rw(0x3964), 0x18, g.rw(0x327d), 0x10, g.rb(0x3966), 0x0e, g.rb(0x327f), 0x1e);
}

// CS:3e6e - creature touches the cat. Returns CF.
function creatureTouchesCat(g) {
  g.c(7);
  return overlap(g, g.rw(0x3964), 0x18, g.rw(0x579), 0x18, g.rb(0x3966), 0x0e, g.rb(0x57b), 0x0e);
}

// CS:3d90 - the creature caught the cat: draw it over the cat, click for 9 ticks,
// and throw the cat out of the room.
function* creatureCatches(g) {
  g.c(2);
  if (g.rb(0x553) !== 0) return;
  let cx = g.rw(0x579);
  cx = cx < 0x0c ? 0 : cx - 0x0c;
  g.c(4);
  if (cx >= 0x10f) cx = 0x10e;
  let dl = g.rb(0x57b);
  dl = dl < 4 ? 0 : dl - 4;
  g.c(4);
  const di = xyAddr(g, cx, dl);
  g.c(6);
  blitOver(g, SEG_VRAM, di, 0x37c0, 0x0e, 6, 0x15);
  S.clickPatternInit(g); // CS:56f4
  g.ww(0x39c8, g.ticks());
  g.c(3);
  for (;;) {
    S.clickPattern(g); // CS:5704
    const dx = g.ticks();
    g.c(5);
    if (((dx - g.rw(0x39c8)) & 0xffff) >= 9) break;
    yield;
  }
  g.wb(0x552, 1);
  g.c(1);
}

// CS:3cb1 - creature update, every second BIOS tick.
function* creatureUpdate(g) {
  const dx = g.ticks();
  g.c(5);
  if (((dx - g.rw(0x39c8)) & 0xffff) < 2) return;
  g.ww(0x39c8, dx);
  if (creatureTouchesChaser(g)) return;
  g.c(1);
  if (creatureTouchesCat(g)) {
    yield* creatureCatches(g); // JMP L3d90
    return;
  }
  // L3cd2: speed by skill (SHL BL,1 keeps BH)
  let bx = g.rw(0x0008);
  bx = (bx & 0xff00) | ((bx << 1) & 0xff);
  g.ww(0x39c6, g.rw(0x39cc + bx));
  let ax = g.rw(0x3964);
  g.ww(0x39c3, ax);
  const dl0 = g.rb(0x3966);
  g.wb(0x39c5, dl0);
  g.c(10);
  let toL3d25 = true;
  if (dl0 === 8) {
    // on the floor line: walk toward the cat
    const a = ax & 0xfff8;
    const d = g.rw(0x579) & 0xfff8;
    g.c(5);
    if (a === d) {
      g.wb(0x3967, 1);
      g.wb(0x396e, 1);
      g.c(3);
    } else {
      // L3d0d (JC on CMP AX,DX)
      ax = g.rw(0x3964);
      if (a < d) {
        ax = (ax + g.rw(0x39c6)) & 0xffff;
      } else {
        const s = g.rw(0x39c6);
        ax = ax < s ? 0 : ax - s;
      }
      g.ww(0x3964, ax);
      g.c(6);
      toL3d25 = false;
    }
  }
  if (toL3d25) {
    // L3d25: vertical movement
    let al = g.rb(0x3966);
    g.wb(0x396e, g.rb(0x396e) + 1);
    const dl = ((g.rb(0x396e) >> 2) & 3) + 2;
    g.c(9);
    if (g.rb(0x3967) === 1) {
      // L3d52: going up/down toward the cat
      al = (al + dl) & 0xff;
      g.c(3);
      let turnBack = true;
      if (!(al > g.rb(0x57b))) {
        let b = g.rw(0x3964) - g.rw(0x579);
        if (b < 0) b = ~b;
        b &= 0xffff;
        g.c(6);
        if (!(b > 0x30)) {
          g.c(2);
          if (al < 0xa0) turnBack = false;
          else al = 0x9f;
        }
      }
      if (turnBack) {
        g.wb(0x3967, 0xff); // L3d71
        g.c(1);
      }
    } else {
      const r = al - dl;
      g.c(3);
      if (r < 0 || r < 9) {
        // L3d49
        al = 8;
        g.wb(0x3967, 0);
        g.c(3);
      } else {
        al = r;
      }
    }
    g.wb(0x3966, al); // L3d76
    g.c(1);
  }
  // L3d79
  if (creatureTouchesChaser(g)) {
    g.ww(0x3964, g.rw(0x39c3));
    g.wb(0x3966, g.rb(0x39c5));
    g.c(5);
    return;
  }
  // L3d8b
  g.c(1);
  if (creatureTouchesCat(g)) {
    yield* creatureCatches(g); // L3d90
    return;
  }
  // L3dee
  g.ww(0x39ca, xyAddr(g, g.rw(0x3964), g.rb(0x3966)));
  g.c(4);
  creatureErase(g); // CS:3e38
  g.wb(0x396d, g.rb(0x396d) - 1);
  g.c(2);
  if (g.rb(0x396d) === 0) {
    g.wb(0x396d, 2);
    g.ww(0x396b, g.rw(0x396b) ^ 0x54);
    g.c(2);
  }
  creatureDraw(g); // CS:3e14
}

// CS:0394 - room 3 entry and loop (loop head CS:03b2).
function* loop(g) {
  g.ww(0x0004, 3);
  g.c(1);
  yield* roomTransition(g); // CS:1bf0
  roomBackground(g); // CS:2790
  placeCatFromRoom(g); // CS:07a1
  floorInit(g); // CS:3405
  dogInit(g); // CS:1e40
  targetsInit(g); // CS:3b30
  creatureInit(g); // CS:3c90
  S.musicReset(g); // CS:58bd
  for (;;) {
    yield 0x03b2; // loop head L03b2 (sync point)
    yield* hotKeys(g, pauseScreen); // CS:1338
    pollInput(g); // CS:1200
    S.alleyMusic(g); // CS:546d
    yield* catUpdate(g); // CS:08e5
    yield* creatureUpdate(g); // CS:3cb1
    targetsUpdate(g); // CS:3b42
    chaserUpdate(g); // CS:3150
    dogUpdate(g); // CS:1e63
    g.c(7);
    if ((g.rb(0x552) | g.rb(0x553) | g.rb(0x551) | g.rb(0x41c) | g.rb(0x41b)) !== 0) return;
  }
}

registerRoom(3, { loop, drawBackground, landing });

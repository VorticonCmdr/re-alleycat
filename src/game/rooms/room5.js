// Room 5 (jump-table entry CS:02fe). Room routines CS:4340..CS:47a5.
//
// Two objects:
// - the "shelf object" (DS:40a8 x word, DS:40aa y byte, 3 words x 16 rows, sprite DS:3fbe,
//   background saved at DS:401e). The cat pushes it along the shelf; pushed past
//   x 0x78..0xa8 it falls to y >= 0xa4 and is replaced by the DS:3f36 sprite (4 x 17).
// - the "runner" (DS:40b2 x word, DS:40b4 y byte, 1 word x 5 rows, background at
//   DS:3f2c), released when the shelf object has landed. Touching it with the cat sets
//   DS:0553 (room success).

import { registerRoom } from './hooks.js';
import { random, xyAddr, blitAnd, blitOver, copyRect, overlap, SEG_VRAM } from '../prims.js';
import { hotKeys, pollInput, speakerOff } from '../input.js';
import { pauseScreen } from '../title.js';
import * as S from '../sound.js';
import { placeCatFromRoom, catUpdate, eraseCat, saveUnderCatAt } from '../cat.js';
import { dogInit, dogUpdate } from '../alley.js';
import { roomTransition, roomBackground, floorInit, chaserUpdate } from './common.js';

// RNG (CS:2dfd) low byte, i.e. DL.
const rndDL = (g) => random(g) & 0xff;

// CS:452d - runner touches the cat: success unless the room is already being left.
function runnerMeetsCat(g) {
  g.c(8);
  if (!overlap(g, g.rw(0x40b2), 8, g.rw(0x579), 0x18, g.rb(0x40b4), 0x05, g.rb(0x57b), 0x0e)) return;
  g.c(2);
  if (g.rb(0x552) !== 0) return;
  g.wb(0x553, 1);
}

// CS:4557 - runner touches the chaser: force its vertical direction up. Returns CF.
function runnerMeetsChaser(g) {
  g.c(8);
  if (!overlap(g, g.rw(0x40b2), 8, g.rw(0x327d), 0x10, g.rb(0x40b4), 0x05, g.rb(0x327f), 0x1e)) return false;
  g.wb(0x40b8, 0xff);
  g.c(1);
  return true;
}

// CS:44fb - direction away from the cat (DS:40ca x, DS:40cb y; 1 or 0xff) and a
// distance measure DS:40cc = |dx| + 2*|dy| (one's complement for negative differences).
function awayFromCat(g) {
  let ax = g.rw(0x40b2);
  let dl = 1;
  let d = ax - g.rw(0x579);
  g.c(3);
  if (d < 0) {
    d = ~d;
    dl = 0xff;
    g.c(2);
  }
  ax = d & 0xffff;
  g.wb(0x40ca, dl);
  g.ww(0x40cc, ax);
  dl = 1;
  let al = g.rb(0x40b4) - g.rb(0x57b);
  g.c(5);
  if (al < 0) {
    al = ~al;
    dl = 0xff;
    g.c(2);
  }
  al &= 0xff;
  g.wb(0x40cb, dl);
  g.ww(0x40cc, g.rw(0x40cc) + (al << 1));
  g.c(5);
}

// CMP a,b / MOV DL,0 ... JZ / INC DL / JC / MOV DL,0FFh  (INC keeps CF of the CMP)
const toward = (a, b) => (a === b ? 0 : a < b ? 1 : 0xff);

// CS:4340 - runner update (from the tick after the shelf object has landed).
function runnerUpdate(g) {
  const dx = g.ticks();
  g.c(3);
  if (dx === g.rw(0x40b5)) return;
  g.wb(0x40ff, g.rb(0x40ff) + 1);
  g.c(2);
  if (g.rb(0x40ff) & 3) {
    g.ww(0x40b5, dx);
    g.c(1);
  }
  g.c(2);
  if (g.rb(0x40aa) < 0xa4) return;
  runnerMeetsCat(g);
  if (runnerMeetsChaser(g)) return;
  let L = 'L439c';
  g.c(3);
  if (rndDL(g) <= 0x30) {
    awayFromCat(g);
    const si = (g.rw(0x0008) << 1) & 0xffff;
    g.c(5);
    if (!(g.rw(0x40cc) > g.rw((0x40ce + si) & 0xffff))) {
      // the cat is close: flee
      S.randomEffect(g); // CS:595d
      g.ww(0x40c8, 0xff);
      g.wb(0x40b7, g.rb(0x40ca));
      g.wb(0x40b8, g.rb(0x40cb));
      g.c(5);
      L = 'L442e';
    }
  }
  if (L === 'L439c') {
    g.c(2);
    if (g.rw(0x40c8) > 0x0a) {
      L = 'L4402';
    } else {
      g.c(2);
      if (rndDL(g) <= 6) {
        g.ww(0x40c8, 0xff);
        g.c(2);
        L = 'L4402';
      } else {
        // L43b4: head for target BX = [40c8]
        const bx = g.rw(0x40c8);
        const si = (bx << 1) & 0xffff;
        g.wb(0x40b7, toward(g.rw(0x40b2) & 0x0ffc, g.rw((0x40de + si) & 0xffff)));
        const dl = toward(g.rb(0x40b4) & 0xfe, g.rb((0x40f4 + bx) & 0xffff));
        g.wb(0x40b8, dl);
        g.c(16);
        if ((dl | g.rb(0x40b7)) !== 0) {
          L = 'L442e';
        } else if (rndDL(g) > 0x10) {
          g.c(2);
          L = 'L442e';
        } else {
          g.ww(0x40c8, 0xff);
          S.randomEffect(g); // CS:595d
          g.c(3);
          L = 'L4402';
        }
      }
    }
  }
  if (L === 'L4402') {
    g.c(2);
    let dl = rndDL(g);
    if (dl <= 0x30) {
      dl &= 1;
      if (dl === 0) dl = 0xff;
      g.wb(0x40b7, dl);
      dl = rndDL(g) & 1;
      if (dl === 0) dl = 0xff;
      g.wb(0x40b8, dl);
      g.c(10);
    }
    g.ww(0x40c8, random(g) & 0xff);
    g.c(3);
  }
  // L442e: vertical move
  let al = g.rb(0x40b4);
  const vy = g.rb(0x40b8);
  g.c(3);
  if (vy !== 0) {
    if (vy === 1) {
      al = (al + 2) & 0xff;
      g.c(3);
      if (al >= 0xa8) {
        al = 0xa7;
        g.wb(0x40b8, 0xff);
        g.c(3);
      }
    } else {
      al = (al - 2) & 0xff;
      g.c(3);
      if (al < 0x30) {
        al = 0x30;
        g.wb(0x40b8, 1);
        g.c(2);
      }
    }
    g.wb(0x40b4, al);
    g.c(1);
  }
  // L4459: horizontal move
  let ax = g.rw(0x40b2);
  const vx = g.rb(0x40b7);
  g.c(3);
  if (vx !== 0) {
    if (vx === 1) {
      ax = (ax + 4) & 0xffff;
      g.c(3);
      if (ax >= 0x136) {
        ax = 0x135;
        g.wb(0x40b7, 0xff);
        g.c(3);
      }
    } else {
      g.c(2);
      if (ax < 4) {
        ax = 0;
        g.wb(0x40b7, 1);
        g.c(2);
      } else {
        ax -= 4;
      }
    }
    g.ww(0x40b2, ax);
    g.c(1);
  }
  // L4486
  runnerMeetsCat(g);
  g.ww(0x40bc, xyAddr(g, g.rw(0x40b2), g.rb(0x40b4)));
  g.c(6);
  if (g.rb(0x40b9) === 0) {
    copyRect(g, SEG_VRAM, g.rw(0x40ba), 0x3f2c, 1, 5);
    g.c(3);
  }
  if (runnerMeetsChaser(g)) return;
  g.wb(0x40b9, 0);
  g.ww(0x40be, g.rw(0x40be) + 2);
  const bx = g.rw(0x40be) & 6;
  let si = g.rw(0x40c0 + bx);
  g.c(6);
  if (g.rb(0x40b7) === 0xff) {
    si = (si + 0x1e) & 0xffff;
    g.c(1);
  }
  const di = g.rw(0x40bc);
  g.ww(0x40ba, di);
  g.c(4);
  blitOver(g, SEG_VRAM, di, si, 0x3f2c, 1, 5);
}

// CS:44e7 - cat standing on the shelf (not airborne, y&f8 = 88h). Returns CF.
function catOnShelf(g) {
  g.c(2);
  if (g.rb(0x571) !== 0) return false;
  g.c(4);
  return (g.rb(0x57b) & 0xf8) === 0x88;
}

// CS:457a - place the shelf object.
function shelfInit(g) {
  const cx = 0x90;
  const dl = 0x86;
  g.ww(0x40a8, cx);
  g.wb(0x40aa, dl);
  g.c(4);
  g.ww(0x40ab, xyAddr(g, cx, dl));
  drawShelfObject(g);
  g.wb(0x40af, 0);
  g.wb(0x40b1, 0);
  g.wb(0x40b9, 1);
  g.wb(0x40b8, 0);
  g.ww(0x40c8, 0xff);
  g.c(6);
}

// CS:4759 - draw the shelf object at [40ab] (AND-blit), background to DS:401e.
function drawShelfObject(g) {
  const di = g.rw(0x40ab);
  g.ww(0x40a6, di);
  g.c(6);
  blitAnd(g, SEG_VRAM, di, 0x3fbe, 0x401e, 3, 0x10);
}

// CS:4773 - restore the background under the shelf object.
function eraseShelfObject(g) {
  g.c(5);
  copyRect(g, SEG_VRAM, g.rw(0x40a6), 0x401e, 3, 0x10);
}

// CS:473e - shelf object touches the cat. Returns CF.
function shelfMeetsCat(g) {
  g.c(8);
  return overlap(g, g.rw(0x40a8), 0x18, g.rw(0x579), 0x18, g.rb(0x40aa), 0x10, g.rb(0x57b), 0x0e);
}

// CS:4786 - chaser below the shelf object (y >= 66h, x within [40a8]-14h..[40a8]+1ch). Returns CF.
function chaserUnderShelf(g) {
  g.c(2);
  if (g.rb(0x327f) < 0x66) return false;
  let ax = (g.rw(0x40a8) - 0x14) & 0xffff;
  g.c(3);
  if (ax > g.rw(0x327d)) return false;
  ax = (ax + 0x30) & 0xffff;
  g.c(3);
  if (ax < g.rw(0x327d)) return false;
  return true;
}

// CS:45ab - shelf object: pushed by the cat, falls when pushed off the shelf.
function* shelfUpdate(g) {
  const dx = g.ticks();
  g.c(3);
  if (dx === g.rw(0x40ad)) return;
  g.ww(0x40ad, dx);
  g.c(2);
  if (g.rb(0x40aa) >= 0xa4) return;
  if (chaserUnderShelf(g)) {
    if (!catOnShelf(g)) return;
    g.wb(0x571, 1);
    g.wb(0x55b, 0x10);
    g.c(2);
    return;
  }
  // L45d6
  if (shelfMeetsCat(g)) {
    g.c(2);
    if (g.rb(0x40af) === 0) {
      let al = g.rb(0x56e);
      g.c(2);
      if (al === 0) {
        al = 1;
        g.c(4);
        if (!(g.rw(0x40a8) > g.rw(0x579))) al = 0xff;
      }
      g.wb(0x40b0, al);
    }
    // L45fa: push the cat back until it no longer touches the object (at most 20h steps)
    g.wb(0x40af, 1);
    let cx = 0x20;
    g.c(2);
    for (;;) {
      let ax = g.rw(0x579);
      let dl = 1;
      g.c(4);
      if (g.rb(0x40b0) === 1) {
        ax = (ax - 8) & 0xffff;
        dl = 0xff;
        g.c(3);
      } else {
        ax = (ax + 8) & 0xffff;
        g.c(1);
      }
      g.ww(0x579, ax);
      g.wb(0x56e, dl);
      let al = g.rb(0x57b);
      const vd = g.rb(0x571);
      g.c(4);
      if (vd !== 0) {
        al = vd === 1 ? (al - 3) & 0xff : (al + 3) & 0xff;
        g.wb(0x57b, al);
        g.wb(0x57c, (al + 0x32) & 0xff);
        g.c(5);
      }
      g.c(3);
      if (!shelfMeetsCat(g)) break;
      cx = (cx - 1) & 0xffff;
      g.c(1);
      if (cx === 0) break;
    }
    // L4642
    eraseCat(g); // CS:11e3
    saveUnderCatAt(g); // CS:1112
    return;
  }
  // L4649
  g.c(2);
  if (g.rb(0x40b1) === 0) {
    g.c(2);
    if (g.rb(0x40af) === 0) return;
    let ax = g.rw(0x40a8);
    g.c(3);
    if (g.rb(0x40b0) === 1) ax = (ax + 8) & 0xffff;
    else ax = (ax - 8) & 0xffff;
    g.ww(0x40a8, ax);
    g.c(2);
    if (shelfMeetsCat(g)) return;
    // L4672
    S.effect(g, 0x0c00, 0x0b54); // CS:593b
    g.wb(0x40af, 0);
    g.c(3);
    g.ww(0x40ab, xyAddr(g, g.rw(0x40a8), g.rb(0x40aa)));
    eraseShelfObject(g);
    drawShelfObject(g);
    const a = g.rw(0x40a8);
    g.c(4);
    if (a >= 0x78 && a <= 0xa8) return;
  }
  yield* shelfFall(g);
}

// L46a2 .. L473d - the shelf object falls, one 5-pixel step per BIOS tick (busy wait).
function* shelfFall(g) {
  for (;;) {
    // L46a2
    g.wb(0x40b1, 1);
    g.c(2);
    if (g.rb(0x1cbf) !== 0) {
      if (catOnShelf(g)) {
        g.wb(0x571, 1);
        g.wb(0x55b, 0x10);
        g.c(2);
      }
      return;
    }
    // L46be
    for (;;) {
      const dx = g.ticks();
      g.c(3);
      if (dx === g.rw(0x40ad)) break; // JZ L46a2
      g.ww(0x40ad, dx);
      g.c(2);
      if (g.rb(0x0000) !== 0) {
        g.out43(0xb6);
        const ax = (g.rb(0x40aa) << 2) & 0xffff;
        g.out42(ax & 0xff);
        g.out42(ax >> 8);
        g.out61(g.in61() | 3);
        g.c(11);
      }
      // L46ec
      let dl = g.rb(0x40aa);
      g.c(2);
      if (dl >= 0xa4) {
        // L470e: landed
        speakerOff(g); // CS:5b21
        eraseShelfObject(g);
        g.ww(0x40a6, g.rw(0x40a6) - 1);
        g.c(5);
        blitAnd(g, SEG_VRAM, g.rw(0x40a6), 0x3f36, 0x401e, 4, 0x11);
        g.ww(0x40b2, g.rw(0x40a8));
        g.wb(0x40b4, g.rb(0x40aa));
        g.c(4);
        awayFromCat(g);
        g.wb(0x40b7, g.rb(0x40ca));
        g.c(3);
        return;
      }
      dl = (dl + 5) & 0xff;
      g.wb(0x40aa, dl);
      g.c(3);
      g.ww(0x40ab, xyAddr(g, g.rw(0x40a8), dl));
      eraseShelfObject(g);
      drawShelfObject(g);
      g.c(1);
    }
    yield;
  }
}

registerRoom(5, {
  // CS:02fe - room 5 entry and loop.
  *loop(g) {
    g.ww(0x0004, 5);
    g.c(1);
    yield* roomTransition(g); // CS:1bf0
    roomBackground(g); // CS:2790
    shelfInit(g); // CS:457a
    placeCatFromRoom(g); // CS:07a1
    floorInit(g); // CS:3405
    dogInit(g); // CS:1e40
    S.musicReset(g); // CS:58bd
    for (;;) {
      yield 0x0319; // loop head L0319 (sync point)
      yield* hotKeys(g, pauseScreen); // CS:1338
      pollInput(g); // CS:1200
      S.alleyMusic(g); // CS:546d
      yield* shelfUpdate(g); // CS:45ab
      runnerUpdate(g); // CS:4340
      yield* catUpdate(g); // CS:08e5
      chaserUpdate(g); // CS:3150
      dogUpdate(g); // CS:1e63
      g.c(10);
      if ((g.rb(0x552) | g.rb(0x553) | g.rb(0x551) | g.rb(0x41c) | g.rb(0x41b)) !== 0) return;
    }
  },
});

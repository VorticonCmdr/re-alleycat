// Room 1 (jump-table entries 0 and 1 -> CS:03e2): the room whose exit (DS:0554) leads
// on into room 2, plus the bonus/success animation CS:38b0 shared by every room's
// success (called from the transition CS:1c41 and from room 7 at CS:5138).

import { registerRoom } from './hooks.js';
import { roomTransition, roomBackground, floorInit, chaserUpdate } from './common.js';
import { copyRect, saveRect, overlap, SEG_VRAM } from '../prims.js';
import { hotKeys, pollInput, speakerOff } from '../input.js';
import { pauseScreen } from '../title.js';
import { placeCatFromRoom, catUpdate } from '../cat.js';
import { dogInit, dogUpdate, drawShapes } from '../alley.js';
import { addBcd } from '../score.js';
import * as S from '../sound.js';

// CS:3850 - animate the room-1 object every 6 ticks; the cat touching it sets DS:0554.
function room1Update(g) {
  const dx = g.ticks();
  g.c(5);
  if (((dx - g.rw(0x35da)) & 0xffff) < 6) return;
  g.ww(0x35da, dx);
  g.ww(0x35d8, g.rw(0x35d8) + 2);
  const bx = g.rw(0x35d8) & 6;
  const si = g.rw(0x35d0 + bx);
  g.c(9);
  copyRect(g, SEG_VRAM, 0x15c9, si, 2, 0x0a); // CX=0A02h
  g.c(8);
  // CX=0E0Ah: CL=0Ah (first height), CH=0Eh (second height)
  if (overlap(g, 0xe4, 0x10, g.rw(0x579), 0x18, 0x8a, 0x0a, g.rb(0x57b), 0x0e)) {
    g.wb(0x554, 1);
    g.c(1);
  }
}

// CS:3af4 - convert the binary count AX into the 7-digit BCD number at DS:368d by adding
// the BCD powers of two (7-byte entries ending at DS:3684) for every set bit 12..0.
function bonusToBcd(g, ax) {
  g.ww(0x368b, ax);
  g.ww(0x368d, 0);
  g.ww(0x368f, 0);
  g.ww(0x3691, 0);
  g.ww(0x3693, 0);
  let bx = 0x3684;
  let dx = 0x1000;
  g.c(8);
  for (;;) {
    g.c(2);
    if (g.rw(0x368b) & dx) {
      addBcd(g, 0x368d, bx); // CS:271e preserves AX, BX, CX (DX untouched)
      g.c(2);
    }
    bx = (bx - 7) & 0xffff;
    const cf = dx & 1;
    dx >>= 1;
    g.c(3);
    if (cf) return;
  }
}

// CS:3a96 - copy 1Eh words DS:35e0 -> DS:000e, ANDed with the mask DX.
function maskPicture(g, dx) {
  g.df = 0; // CLD
  let si = 0x35e0;
  let di = 0x0e;
  for (let i = 0; i < 0x1e; i++) {
    g.ww(di, g.rw(si) & dx);
    si = (si + 2) & 0xffff;
    di = (di + 2) & 0xffff;
  }
  g.c(5 + 0x1e * 4);
}

// CS:3aac - draw the shape list DS:361c at 1b80h, 1900h, ... down to AX (steps of 280h);
// when DS:369f is set each step plays the next note pair and waits 2 ticks.
function* dropPicture(g, ax) {
  g.ww(0x369a, ax);
  S.twoToneInit(g); // CS:5829
  ax = 0x1b80;
  g.c(5);
  for (;;) {
    g.ww(0x369c, ax);
    drawShapes(g, 0x361c, ax); // CS:2b24
    g.c(3);
    if (g.rb(0x369f) !== 0) {
      S.twoToneNext(g); // CS:5869
      g.ww(0x3695, g.ticks());
      g.c(3);
      for (;;) {
        const dx = (g.ticks() - g.rw(0x3695)) & 0xffff;
        g.c(5);
        if (dx >= 2) break;
        yield;
      }
    }
    const a = g.rw(0x369c);
    g.c(4);
    if (a < 0x280) break; // SUB AX,280h borrows
    ax = a - 0x280;
    if (ax < g.rw(0x369a)) break;
  }
  speakerOff(g); // CS:5b21
}

// CS:3a1c - wait for vertical retrace, then set the background colour to DS:3699 or 0
// depending on bit 2 of the tick count read on entry. Returns that tick count (DX).
function* blinkBackground(g) {
  const dx = g.ticks();
  g.c(3);
  while (!g.retrace()) {
    g.c(2);
    yield;
  }
  let bl = 0;
  g.c(4);
  if (!(dx & 4)) {
    bl = g.rb(0x3699);
    g.c(1);
  }
  g.bios.setPalette(0, bl);
  g.c(3);
  return dx;
}

// CS:3a3a - print digits 3..6 of DS:368d at text row DS:369e/8, column 12h.
function printBonus(g) {
  g.bios.setCursor(g.rb(0x369e) >> 3, 0x12);
  g.ww(0x36a0, 3);
  g.c(8);
  do {
    const bx = g.rw(0x36a0);
    g.bios.teletype((g.rb(0x368d + bx) + 0x30) & 0xff, 3);
    g.ww(0x36a0, bx + 1);
    g.c(8);
  } while (g.rw(0x36a0) < 7);
}

// CS:3a6c - store the word DS:36ec+[370c] at DS:3720 (inside the text), then print the
// 20 characters at DS:370e from row 10, column 10.
function printMessage(g) {
  g.bios.setCursor(0x0a, 0x0a);
  g.ww(0x3720, g.rw(0x36ec + g.rw(0x370c)));
  g.c(9);
  for (let bx = 0; bx < 0x14; bx++) {
    g.bios.teletype(g.rb(0x370e + bx), 3);
    g.c(8);
  }
}

// CS:39fa - save two screen rectangles (B800:08e4 4x8 words, B800:0c94 14h x 8 words)
// to DS:000e and DS:004e.
function saveScreen(g) {
  g.c(4);
  saveRect(g, 0x0e, 0x8e4, 4, 8);
  saveRect(g, 0x4e, 0xc94, 0x14, 8);
  g.c(4);
}

// CS:38b0 - success: bonus from the time spent in the room (DS:0410; room 7 uses the
// game time DS:0412 and the skill), added to the score, with picture, tune and blinking
// background. The branch is chosen only by DS:0006 (the room just left).
function* successAnimation(g) {
  const prev = g.rw(0x0006);
  g.c(2);
  if (prev !== 7) {
    g.ww(0x414, g.rw(0x414) + 1);
    g.wb(0x418, 1);
    maskPicture(g, 0xaaaa);
    g.wb(0x369f, 0);
    g.c(5);
    yield* dropPicture(g, 0);
  }
  // L38d3
  let dx = g.ticks();
  let ax;
  g.c(3);
  if (g.rw(0x0006) === 7) {
    dx = (dx - g.rw(0x412)) & 0xffff;
    ax = dx > 0x2a30 ? 0 : 0x2a30 - dx;
    ax >>= 1;
    g.c(6);
  } else {
    dx = (dx - g.rw(0x410)) & 0xffff;
    ax = 0x546;
    g.c(4);
    if (g.rw(0x0006) === 6) ax <<= 1;
    ax = dx > ax ? 0 : ax - dx;
    g.c(4);
    if (g.rw(0x0006) !== 6) ax = (ax << 1) & 0xffff;
  }
  // L390e
  g.ww(0x3697, ax);
  bonusToBcd(g, ax);
  let bx = g.rw(0x0006);
  bx = (bx & 0xff00) | ((bx << 1) & 0xff); // SHL BL,1
  addBcd(g, 0x368d, g.rw(0x36cc + bx));
  g.c(8);
  if (g.rw(0x0006) === 7) {
    bx = g.rw(0x0008);
    bx = (bx & 0xff00) | ((bx << 1) & 0xff); // SHL BL,1
    ax = bx;
    let cx = g.rw(0x36dc + bx);
    g.c(6);
    if (g.rw(0x2e8d) < 8) {
      cx = (cx << 1) & 0xffff;
      ax = (ax + 0x10) & 0xffff;
      g.c(2);
    }
    g.ww(0x370c, ax);
    do {
      addBcd(g, 0x1f82, 0x368d);
      cx = (cx - 1) & 0xffff;
      g.c(6);
    } while (cx !== 0); // LOOP: CX=0 runs 65536 times
    saveScreen(g);
    g.wb(0x369e, 0x38);
    g.wb(0x3699, 1);
    g.ww(0x3722, 0x44);
    g.c(3);
    printBonus(g);
    printMessage(g);
  } else {
    addBcd(g, 0x1f82, 0x368d);
    g.wb(0x3699, 2);
    g.ww(0x3722, 0x1e);
    maskPicture(g, 0xffff);
    ax = (0xa8c - g.rw(0x3697)) & 0xffff;
    ax >>= 4;
    ax = (ax & 0xff00) | (ax & 0xf0); // AND AL,0F0h
    g.wb(0x369e, ax & 0xff);
    ax = (ax & 0xff) * 0x28; // MOV AH,28h / MUL AH
    g.wb(0x369f, 1);
    g.c(14);
    yield* dropPicture(g, ax);
    printBonus(g);
  }
  // L39a7
  g.ww(0x3695, g.ticks());
  g.c(3);
  for (;;) {
    g.c(3);
    if (g.rw(0x0006) === 7) S.tuneStep(g); // CS:5b63
    else S.twoTone(g); // CS:5835
    dx = yield* blinkBackground(g);
    g.c(3);
    if (((dx - g.rw(0x3695)) & 0xffff) >= g.rw(0x3722)) break;
  }
  g.bios.setPalette(0, 0);
  g.c(5);
  if (g.rw(0x0006) !== 7) {
    speakerOff(g); // CS:5b21
    return;
  }
  copyRect(g, SEG_VRAM, 0x8e4, 0x0e, 4, 8);
  copyRect(g, SEG_VRAM, 0xc94, 0x4e, 0x14, 8);
  g.c(6);
}

// CS:03e2 - room entry and loop (loop head CS:03fa).
function* loop(g) {
  g.ww(0x0004, 1);
  g.c(1);
  yield* roomTransition(g); // CS:1bf0
  roomBackground(g); // CS:2790
  placeCatFromRoom(g); // CS:07a1
  floorInit(g); // CS:3405
  dogInit(g); // CS:1e40
  S.musicReset(g); // CS:58bd
  for (;;) {
    yield 0x03fa; // loop head (sync point)
    yield* hotKeys(g, pauseScreen); // CS:1338
    pollInput(g); // CS:1200
    S.alleyMusic(g); // CS:546d
    yield* catUpdate(g); // CS:08e5
    chaserUpdate(g); // CS:3150
    dogUpdate(g); // CS:1e63
    room1Update(g); // CS:3850
    g.c(2);
    if (g.rb(0x554) !== 0) return 'room2'; // JNZ L0459 (room-2 entry)
    g.c(5);
    if ((g.rb(0x552) | g.rb(0x551) | g.rb(0x41b) | g.rb(0x41c)) !== 0) return; // L0427
  }
}

registerRoom(1, { loop, successAnimation });

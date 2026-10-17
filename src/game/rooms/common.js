// Code shared by the rooms behind the windows: the transition wipe between alley and
// rooms, the return-to-alley sequences, the room background dispatcher, and the room
// chaser that follows the cat around the floor and cleans up its footprints.

import { random, xyAddr, copyRect, overlap, SEG_VRAM } from '../prims.js';
import { speakerOff } from '../input.js';
import * as S from '../sound.js';
import { roomPalette, drawShapes } from '../alley.js';
import { roomHooks } from './hooks.js';

// ---------------------------------------------------------------- transitions

// CS:1c67 - expanding rectangle wipe around the cat, filled with the word at DS:1839.
export function wipe(g) {
  // CS:5896 is a bare RET
  g.ww(0x1835, 1);
  g.wb(0x1837, 8);
  let cx = (g.rw(0x579) + 0x0c) & 0xfff0;
  let dl = (g.rb(0x57b) + 8) & 0xff;
  g.wb(0x1838, 0);
  g.c(12);
  for (;;) {
    S.wipeTick(g); // CS:5897
    g.ww(0x1832, cx);
    g.wb(0x1834, dl);
    let di = xyAddr(g, cx, dl);
    let bl = g.rb(0x1837);
    g.c(6);
    do {
      const ax = g.rw(0x1839);
      const words = g.rw(0x1835) >> 3;
      for (let i = 0; i < words; i++) {
        g.mem.vwb(di, ax & 0xff);
        g.mem.vwb(di + 1, ax >> 8);
        di = (di + (g.df ? -2 : 2)) & 0xffff;
      }
      const back = (g.rw(0x1835) >> 2) & 0xfe;
      di = (di - back) & 0xffff;
      di ^= 0x2000;
      if (!(di & 0x2000)) di = (di + 0x50) & 0xffff;
      bl = (bl - 1) & 0xff;
      g.c(words + 16);
    } while (bl !== 0);
    g.c(3);
    if (g.rb(0x1838) === 0x0f) return;
    g.ww(0x1835, g.rw(0x1835) + 0x20);
    g.wb(0x1837, g.rb(0x1837) + 0x10);
    cx = g.rw(0x1832);
    dl = g.rb(0x1834);
    if (cx < 0x10) {
      cx = 0;
      g.wb(0x1838, g.rb(0x1838) | 1);
    } else cx -= 0x10;
    if (((g.rw(0x1835) + cx) & 0xffff) >= 0x140) {
      g.ww(0x1835, 0x140 - cx);
      g.wb(0x1838, g.rb(0x1838) | 2);
    }
    if (dl < 8) {
      dl = 0;
      g.wb(0x1838, g.rb(0x1838) | 4);
    } else dl -= 8;
    const al = g.rb(0x1837) + dl;
    if (al > 0xff || al >= 0xc8) {
      g.wb(0x1837, 0xc8 - dl);
      g.wb(0x1838, g.rb(0x1838) | 8);
    }
    g.c(30);
  }
}

// CS:1e17 - masked copy of a 12x8-word picture into the middle of the screen.
function maskedPicture(g) {
  g.df = 0; // CLD
  let si = g.rw(0x1c2e);
  const mask = g.rw(0x1c1b);
  for (let i = 0; i < 0x60; i++) {
    const v = g.rw(si) & mask;
    g.ww(0x0e + 2 * i, v);
    si = (si + 2) & 0xffff;
  }
  g.c(0x60 * 5 + 8);
  copyRect(g, SEG_VRAM, 0x0ed0, 0x0e, 8, 0x0c);
}

// CS:1d76 - back in the alley: fade a picture in with the return tune (and lose a
// life if the cat was thrown out of the room).
function* returnToAlley(g) {
  g.c(3);
  if (g.rw(0x0006) === 7) {
    yield* room7Return(g); // CS:6040
    return;
  }
  S.returnTuneInit(g); // CS:57d5
  let ax = 0x185b;
  g.c(4);
  if (g.rb(0x552) !== 0) {
    const bx = g.rw(0x1c30);
    g.ww(0x1c30, bx + 2);
    ax = g.rw(0x1c26 + (bx & 6));
    if (g.rb(0x1f80) !== 0) g.wb(0x1f80, g.rb(0x1f80) - 1);
    g.c(12);
    if (g.rb(0x552) === 0xdd && g.rw(0x0008) !== 0 && g.rb(0x1f80) >= 1) {
      yield* S.gameOver(g); // CS:5be0 (the dog's bite animation)
      speakerOff(g);
      return;
    }
  }
  g.ww(0x1c2e, ax);
  g.ww(0x1c1b, 0x8080);
  g.wb(0x1c1d, 0x1c);
  g.c(6);
  do {
    maskedPicture(g);
    g.ww(0x1830, g.ticks());
    for (;;) {
      S.returnTune(g); // CS:57e4
      const dx = g.ticks();
      g.c(3);
      if (dx !== g.rw(0x1830)) break;
      yield;
    }
    let m;
    if (g.rb(0x1c1d) <= 0x14) {
      m = g.rw(0x1c1e + (g.rb(0x1c1d) & 6));
    } else {
      const al = ((g.rb(0x1c1b) >> 1) | 0x80) & 0xff;
      m = (al << 8) | al;
    }
    g.ww(0x1c1b, m);
    g.wb(0x1c1d, g.rb(0x1c1d) - 1);
    g.c(12);
  } while (g.rb(0x1c1d) !== 0);
  speakerOff(g);
}

// CS:6040 - leaving room 7: an object drops down the middle with a falling tone.
function* room7Return(g) {
  g.df = 0; // CLD
  for (let i = 0; i < 0x48; i++) g.wb(0x0e + i, 0);
  g.ww(0x6f24, 0x25);
  g.c(0x24 + 10);
  for (;;) {
    while (!g.retrace()) {
      g.c(2);
      yield;
    }
    copyRect(g, SEG_VRAM, g.rw(0x6f24), 0x0e, 3, 0x0c);
    g.ww(0x6f24, g.rw(0x6f24) + 0x1e0);
    copyRect(g, SEG_VRAM, g.rw(0x6f24), 0x6e10, 3, 0x0c);
    let dx;
    for (;;) {
      dx = g.ticks();
      g.c(3);
      if (dx !== g.rw(0x6f26)) break;
      yield;
    }
    g.ww(0x6f26, dx);
    if (g.rb(0x0000) !== 0) {
      g.out43(0xb6);
      S.tone(g, g.rw(0x6f24) >> 1);
    }
    g.c(4);
    if (g.rw(0x6f24) >= 0x1a40) break;
  }
  copyRect(g, SEG_VRAM, g.rw(0x6f24), 0x6e58, 6, 0x11);
  for (;;) {
    let dx;
    for (;;) {
      dx = g.ticks();
      g.c(3);
      if (dx !== g.rw(0x6f28)) break;
      yield;
    }
    g.ww(0x6f28, dx);
    if (g.rb(0x0000) !== 0) {
      g.out43(0xb6);
      const ax = dx & 1 ? 0x0b54 : 0x0c00;
      g.out42(ax & 0xff);
      g.out42(ax >> 8);
    }
    g.c(6);
    if (((dx - g.rw(0x6f26)) & 0xffff) >= 0x12) break;
  }
  speakerOff(g);
}

// CS:1bf0 - wipe out of the current scene and into the next one.
export function* roomTransition(g) {
  g.bios.setPalette(0, 0);
  g.c(4);
  if (g.rw(0x0006) === 7 && g.rb(0x553) !== 0) {
    yield* roomHooks(7).leaveSuccess(g); // CS:528b (waits on ticks)
    g.ww(0x579, 0x98);
    g.wb(0x57b, 0x5f);
  }
  g.df = 0; // CLD at CS:1c17
  g.ww(0x1839, 0);
  wipe(g);
  speakerOff(g);
  roomPalette(g); // CS:1d31
  g.c(3);
  if (g.rw(0x0004) === 0) {
    if (g.rb(0x553) !== 0) {
      if (g.rw(0x0006) === 7) yield* roomHooks(7).successAnimation(g); // CS:5313
      else yield* roomHooks(1).successAnimation(g); // CS:38b0
    } else {
      yield* returnToAlley(g); // CS:1d76
    }
  }
  const room = g.rw(0x0004);
  g.ww(0x1839, room === 7 || room === 2 ? 0x5555 : 0xaaaa);
  g.c(6);
  wipe(g);
  speakerOff(g);
}

// ---------------------------------------------------------------- room backgrounds

// CS:29e1 - vertical line of one byte, 95 scan lines.
function vline(g, di, al) {
  for (let i = 0; i < 0x5f; i++) {
    g.mem.vwb(di, al);
    di ^= 0x2000;
    if (!(di & 0x2000)) di = (di + 0x50) & 0xffff;
  }
  g.c(0x5f * 6);
}

// CS:29a0 - room shell (walls, floor edges) at offset AX.
function roomShell(g, ax) {
  g.ww(0x267e, ax);
  drawShapes(g, 0x251c, ax);
  g.df = 0; // CLD at CS:29ab
  const base = g.rw(0x267e);
  for (const off of [0x284, 0x1184]) {
    for (let i = 0; i < 0x48; i++) g.mem.vwb(base + off + i, 0);
  }
  vline(g, (base + 0x2284) & 0xffff, 0x2a);
  vline(g, (base + 0x22cb) & 0xffff, 0xa8);
  g.c(0x48 + 20);
}

// CS:2945 / 2958 / 2970 / 2988 - groups of shape lists drawn at the same offset.
function shapes2945(g, ax) {
  g.ww(0x2634, ax);
  drawShapes(g, 0x2384, ax);
  drawShapes(g, 0x238c, g.rw(0x2634));
}
function shapeGroup(g, ax, table, first) {
  g.ww(0x2634, ax);
  for (let si = first; si > 0; si -= 2) {
    drawShapes(g, g.rw(table + si), g.rw(0x2634));
    g.c(6);
  }
}

// CS:2790 - draw the background of the room in DS:0004.
export function roomBackground(g) {
  const room = g.rw(0x0004);
  g.c(4);
  if (room === 2) {
    g.df = 0; // CLD at CS:279c
    const v = g.mem.vram;
    for (const base of [0, 0x2000]) {
      for (let i = 0; i < 0xa0; i++) v[base + i] = 0xaa;
    }
    g.ww(0x2654, 0);
    g.c(0xa0 + 10);
    do {
      let dl;
      do {
        dl = random(g) & 0x18;
        g.c(3);
      } while (dl === g.rb(0x2653));
      g.wb(0x2653, dl);
      const bx = g.rw(0x2654);
      g.wb(0x2656 + bx, dl);
      copyRect(g, SEG_VRAM, ((bx << 1) + 0xa0) & 0xffff, 0x2020 + dl, 1, 4);
      g.ww(0x2654, bx + 1);
      g.c(8);
    } while (g.rw(0x2654) < 0x28);
    return;
  }
  if (room === 7) {
    roomHooks(7).drawBackground(g); // CS:300f
    return;
  }
  if (room === 6) {
    roomShell(g, 0);
    drawShapes(g, 0x2570, 0x64a);
    g.ww(0x2650, 0x48);
    g.wb(0x2652, 0x38);
    shapeGroup(g, 0xdd2, 0x2634, 8);
    shapeGroup(g, 0xdf6, 0x263c, 0x0a);
    copyRect(g, SEG_VRAM, 0x67e, 0x1fa0, 2, 0x10);
    drawShapes(g, 0x2344, 0xb84);
    roomHooks(6).drawBackground(g); // CS:4b47
    return;
  }
  if (room === 5) {
    roomShell(g, 0x640);
    drawShapes(g, 0x2570, 0xcb6);
    g.ww(0x2650, 0xf8);
    g.wb(0x2652, 0x60);
    shapeGroup(g, 0x140e, 0x2634, 8);
    shapeGroup(g, 0x1434, 0x263c, 0x0a);
    shapeGroup(g, 0x143e, 0x263c, 0x0a);
    shapeGroup(g, 0x16a0, 0x2646, 8);
    drawShapes(g, 0x2344, 0x1184);
    copyRect(g, SEG_VRAM, 0xdd6, 0x1fe0, 2, 0x10);
    return;
  }
  if (room === 4) {
    roomShell(g, 0x640);
    drawShapes(g, 0x2570, 0xcba);
    g.ww(0x2650, 0x108);
    g.wb(0x2652, 0x60);
    shapeGroup(g, 0x1439, 0x2634, 8);
    shapes2945(g, 0x16c0);
    roomHooks(4).drawBackground(g); // CS:3f9e
    return;
  }
  if (room === 3) {
    roomShell(g, 0x640);
    drawShapes(g, 0x2570, 0xc90);
    g.ww(0x2650, 0x60);
    g.wb(0x2652, 0x60);
    shapeGroup(g, 0x140c, 0x2634, 8);
    shapeGroup(g, 0x1418, 0x263c, 0x0a);
    drawShapes(g, 0x2344, 0x1184);
    drawShapes(g, 0x2344, 0x11a2);
    drawShapes(g, 0x2624, 0);
    roomHooks(3).drawBackground(g); // CS:3bdb
    return;
  }
  roomShell(g, 0x640);
  drawShapes(g, 0x2570, 0xca0);
  g.ww(0x2650, 0xa0);
  g.wb(0x2652, 0x60);
  shapeGroup(g, 0x1406, 0x2634, 8);
  drawShapes(g, 0x2344, 0x11c4);
  shapeGroup(g, 0x1422, 0x263c, 0x0a);
  shapeGroup(g, 0x1690, 0x2646, 8);
  shapes2945(g, 0x16b6);
}

// ---------------------------------------------------------------- the room chaser

// CS:0872 - the cat is knocked away from the room's goal object (DS:2650/2652).
export function knockCat(g) {
  g.ww(0x592a, 0x400);
  g.c(3);
  if (g.rb(0x584) !== 0) return;
  g.wb(0x576, 8);
  g.wb(0x571, g.rb(0x57b) < g.rb(0x2652) ? 1 : 0xff);
  let ax = g.rw(0x579) - g.rw(0x2650);
  let dl = 0xff;
  if (ax <= 0) {
    dl = 1;
    ax = ~ax;
  }
  ax &= 0xffff;
  g.wb(0x56e, dl);
  if (ax >> 8) ax = 0xff;
  let al = (~ax) & 0xff;
  if (al < 0x30) al = 0x30;
  al -= al >> 2;
  g.wb(0x578, al);
  g.ww(0x572, al >> 5);
  g.wb(0x55c, 0);
  g.wb(0x39e0, 0);
  g.wb(0x577, 1);
  g.wb(0x55b, 0x10);
  g.wb(0x584, 1);
  g.c(30);
}

// CS:3405 - clear the floor marks and reset the chaser.
export function floorInit(g) {
  g.df = 0; // CLD
  for (let i = 0; i < 0x28; i++) g.wb(0x328e + i, 0);
  g.ww(0x32b6, 0xff);
  g.ww(0x327a, 0);
  g.ww(0x327d, 0);
  g.wb(0x327f, 0xa0);
  g.wb(0x3286, 1);
  g.wb(0x3280, 0);
  g.wb(0x3281, 0);
  g.wb(0x32eb, random(g) & 0xff);
  g.wb(0x32ea, 0x6c);
  g.c(0x14 + 14);
}

// CS:347f - draw floor cell BX with mark level AL (0..4).
function drawFloorCell(g, al, bx) {
  copyRect(g, SEG_VRAM, ((bx << 1) + 0x1e00) & 0xffff, (al * 10 + 0x32b8) & 0xffff, 1, 5);
  g.c(8);
}

// CS:3445 - the walking cat leaves a footprint on the floor cell under it.
export function floorMark(g) {
  g.c(4);
  if (g.rb(0x57b) < 0xb4 || g.rb(0x56e) === 0) return;
  const ax = (g.rw(0x579) + 0x0c) >> 3;
  g.c(6);
  if (ax > 0x27 || ax === g.rw(0x32b6)) return;
  g.ww(0x32b6, ax);
  const al = g.rb(0x328e + ax);
  g.c(5);
  if (al >= 4) return;
  g.wb(0x328e + ax, al + 1);
  drawFloorCell(g, al + 1, ax);
}

// CS:21e0 - chaser touches the dog. Returns CF.
function chaserTouchesDog(g) {
  g.c(4);
  if ((g.rb(0x1cbf) | g.rb(0x1cc0) | g.rb(0x1cc1)) === 0) return false;
  return overlap(g, g.rw(0x327d), 0x10, g.rw(0x1cc6), 0x20, g.rb(0x327f), 0x1e, g.rb(0x1cc8), 0x0f);
}

// CS:33ba - chaser touches the cat (room 6 has its own test). Returns CF.
function chaserTouchesCat(g) {
  g.c(3);
  if (g.rb(0x1cb8) !== 0) return false;
  if (g.rw(0x0004) === 6 && g.rb(0x44bd) !== 0) return roomHooks(6).chaserTest(g); // CS:47b0
  if (!overlap(g, g.rw(0x327d), 0x10, g.rw(0x579), 0x18, g.rb(0x327f), 0x1e, g.rb(0x57b), 0x0e)) return false;
  g.c(3);
  if (!(g.rw(0x0004) === 4 && g.rb(0x39e1) !== 0)) knockCat(g);
  return true;
}

// CS:33a0
export function eraseChaser(g) {
  g.c(3);
  if (g.rb(0x3286) !== 0) return;
  copyRect(g, SEG_VRAM, g.rw(0x3282), 0x31e8, 2, 0x1e);
}

// CS:3339 - draw the next chaser frame (OR-blit, background saved at DS:31e8).
export function drawChaser(g) {
  let bx = g.rw(0x327a);
  let ax = g.rw(0x3260 + bx);
  g.c(5);
  while (ax === 0) {
    g.ww(0x327a, 0);
    bx = 0;
    ax = g.rw(0x3260);
    g.c(5);
  }
  let si = ax;
  let di = g.rw(0x3284);
  g.ww(0x3282, di);
  let bp = 0x31e8;
  g.wb(0x3286, 0);
  g.df = 0; // CLD at CS:3365
  g.wb(0x3289, 0x1e);
  g.ww(0x3287, 2);
  const m = g.mem;
  do {
    for (let i = 0; i < 2; i++) {
      const b0 = m.vrb(di);
      const b1 = m.vrb(di + 1);
      m.wb(bp, b0);
      m.wb(bp + 1, b1);
      m.vwb(di, m.rb(si) | b0);
      m.vwb(di + 1, m.rb(si + 1) | b1);
      di = (di + 2) & 0xffff;
      si = (si + 2) & 0xffff;
      bp = (bp + 2) & 0xffff;
    }
    di = (di - 2 * g.rw(0x3287)) & 0xffff;
    di ^= 0x2000;
    if (!(di & 0x2000)) di = (di + 0x50) & 0xffff;
    g.wb(0x3289, g.rb(0x3289) - 1);
    g.c(2 * 7 + 10);
  } while (g.rb(0x3289) !== 0);
  g.c(14);
}

// CS:3150 - room chaser: wanders, homes in on footprints and on the cat.
export function chaserUpdate(g) {
  const dx = g.ticks();
  const cx = g.rw(0x32f2 + ((g.rw(0x0004) << 1) & 0xff));
  g.c(8);
  if (((dx - g.rw(0x328c)) & 0xffff) < cx) return;
  g.ww(0x328c, dx);
  if (chaserTouchesCat(g)) return;
  if (chaserTouchesDog(g)) return;
  g.wb(0x32ea, g.rb(0x32ea) + 1);
  const r = random(g) & 0xff;
  g.wb(0x32eb, g.rb(0x32eb) ^ (g.rb(0x32ea) & r));
  let ax = g.rw(0x327d) - g.rw(0x579);
  let dl = 0xff;
  if (ax < 0) {
    ax = ~ax;
    dl = 1;
  }
  ax &= 0xffff;
  g.wb(0x32ed, dl);
  dl = 0xff;
  // ADD BL,14h then SUB BL,[57b]: the borrow comes from the SUB on the wrapped sum
  const sum = (g.rb(0x327f) + 0x14) & 0xff;
  let bl = sum - g.rb(0x57b);
  if (bl < 0) {
    bl = ~bl & 0xff;
    dl = 1;
  }
  g.wb(0x32ee, dl);
  g.wb(0x32ec, (((ax >> 2) & 0xff) + (bl >> 1)) & 0xff);
  let bx = g.rw(0x328a);
  if (bx >= 0x27) {
    bx = 0x26;
    g.ww(0x328a, bx);
  }
  g.c(30);
  if (g.rb(0x328e + bx) === 0) {
    g.ww(0x328a, g.rw(0x328a) - 1);
    const d = ((g.ticks() - g.rw(0x410)) & 0xffff) >> 3;
    let al = g.rb(0x32ec) - (d & 0xff);
    if (al < 0) al = 0;
    g.c(8);
    if (al >= g.rb(0x32eb)) {
      g.wb(0x3281, 1);
      const d2 = random(g) & 0xff;
      if (d2 === 0) g.wb(0x3280, 0);
      else if (d2 <= 7) g.wb(0x3280, d2 & 1 ? 1 : 0xff);
      g.c(8);
    } else {
      const a = g.rb(0x32eb) & 0x2f;
      if (a === 0) {
        g.wb(0x3280, random(g) & 1 ? 1 : 0xff);
        g.wb(0x3281, random(g) & 1 ? 1 : 0xff);
      } else if ((a & 7) === 0) {
        g.wb(0x3280, g.rb(0x32ed));
        g.wb(0x3281, g.rb(0x32ee));
      }
      g.c(10);
    }
  } else {
    g.wb(0x3281, 1);
    const target = (bx << 3) & 0xffff;
    g.c(6);
    if (g.rw(0x327d) !== target) {
      g.wb(0x3280, g.rw(0x327d) < target ? 1 : 0xff);
    } else {
      g.wb(0x3280, 0);
      if (g.rb(0x327f) === 0xa5) {
        g.wb(0x3281, 0);
        const st = g.rw(0x327a);
        if (st === 6 || st === 0x12) {
          copyRect(g, SEG_VRAM, g.rw(0x3282), 0x31e8, 2, 0x1e);
          const v = (g.rb(0x328e + bx) - 1) & 0xff;
          g.wb(0x328e + bx, v);
          drawFloorCell(g, v, bx);
          g.wb(0x3286, 1);
          g.c(8);
        }
      }
    }
  }
  // L32ac: move
  let x = g.rw(0x327d);
  let y = g.rb(0x327f);
  g.ww(0x32ef, x);
  g.wb(0x32f1, y);
  const hx = g.rb(0x3280);
  if (hx === 1) {
    x += 8;
    if (x >= 0x131) x = 0x130;
  } else if (hx !== 0) {
    x = x < 8 ? 0 : x - 8;
  }
  x &= 0xfff8;
  g.ww(0x327d, x);
  const hy = g.rb(0x3281);
  if (hy === 1) {
    y += 2;
    if (y >= 0xa6) y = 0xa5;
  } else if (hy !== 0) {
    y = y < 2 ? 0 : y - 2;
  }
  g.wb(0x327f, y);
  g.ww(0x3284, xyAddr(g, x, y));
  g.c(20);
  if (chaserTouchesCat(g) || chaserTouchesDog(g)) {
    g.wb(0x3280, 0);
    g.wb(0x3281, 0);
    g.ww(0x327d, g.rw(0x32ef));
    g.wb(0x327f, g.rb(0x32f1));
    g.c(8);
    return;
  }
  eraseChaser(g);
  g.ww(0x327a, g.rw(0x327a) + 2);
  drawChaser(g);
}

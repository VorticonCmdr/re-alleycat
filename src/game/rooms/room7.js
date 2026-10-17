// Room 7 (jump table entry 7, CS:0260): the room with seven shelves of tiles, up to
// eight movable items the cat can pick up and put down (fire button), seven wandering
// creatures (one per shelf; touching number 6 wins the room), and a falling object that
// flips tiles. Routines: CS:2e60..3150, CS:4c10..53b0, CS:6100..62ea.
//
// Data used (all read at runtime from the original data segment):
//   DS:2bd4 (7 bytes)  shelf y per row          DS:2bdb (7 bytes) row offset into 2be2
//   DS:2be2            tile state per row/column (0 = solid; bit 1 = gap)
//   DS:2b4a/2b5a (words) item start/current x   DS:2b6a (bytes) item y
//   DS:2b72 (bytes)    item present             DS:2af0 item picture, DS:2b7a blank
//   DS:2e8d word       carried item (>= 8: none) DS:2e94 item just put down
//   DS:4548..4553      current creature record (12 bytes), records via DS:45a8
//   DS:45b6 word       current creature index (0..6)
//   DS:70f2..70fa      the falling object

import { random, xyAddr, copyRect, blitOver, overlap, SEG_VRAM } from '../prims.js';
import { registerRoom, roomHooks } from './hooks.js';
import { roomTransition, roomBackground, floorInit } from './common.js';
import { placeCatFromRoom, catUpdate, eraseCat, drawCat } from '../cat.js';
import { dogInit, drawShapes } from '../alley.js';
import { hotKeys, pollInput, speakerOff } from '../input.js';
import { pauseScreen } from '../title.js';
import * as S from '../sound.js';

// Inline in CS:4fdf and CS:5008 - next CGA row: DI -= back; DI ^= 2000h; if bank 0 -> DI += 50h.
function nextRow(di, back) {
  di = (di - back) & 0xffff;
  di ^= 0x2000;
  if (!(di & 0x2000)) di = (di + 0x50) & 0xffff;
  return di;
}

// Inline in CS:300f and CS:30fa - column index into DS:2be2 for x: (x>>4)-2 clamped to 0..0x11.
function column(ax) {
  ax >>= 4;
  ax = ax < 2 ? 0 : ax - 2;
  if (ax >= 0x12) ax = 0x11;
  return ax;
}

// ---------------------------------------------------------------- items and tiles

// CS:2e60 - fire pressed while carrying an item: put it down on the nearest shelf.
function putDown(g) {
  g.c(2);
  if (g.rw(0x2e8d) >= 8) return;
  g.c(2);
  if (g.rb(0x69a) !== 0) return;
  g.ww(0x2e92, 0xffff);
  g.wb(0x2e91, 0xff);
  g.c(3);
  for (let cx = 7; cx >= 1; cx--) {
    const bx = cx - 1;
    let al = g.rb(0x57b) - g.rb(0x2bd4 + bx);
    if (al < 0) al = ~al & 0xff;
    g.c(7);
    if (al > g.rb(0x2e91)) continue;
    g.wb(0x2e91, al);
    g.ww(0x2e92, bx);
    g.c(2);
  }
  g.c(2);
  if (g.rw(0x2e92) === 0xffff) g.ww(0x2e92, 0);
  let bx = g.rw(0x2e8d);
  const al = g.rb(0x2bd4 + g.rw(0x2e92));
  g.wb(0x2b6a + bx, al);
  g.wb(0x2e98, al);
  let ax = g.rw(0x579);
  bx = (bx & 0xff00) | ((bx << 1) & 0xff); // SHL BL,1
  if (ax >= 0x108) ax = 0x107;
  ax &= 0xffc;
  g.ww(0x2b5a + bx, ax);
  g.ww(0x2e96, ax);
  g.c(13);
  for (let cx = 8; cx >= 1; cx--) {
    const b = cx - 1;
    g.c(4);
    if (b === g.rw(0x2e8d)) continue;
    g.c(2);
    if (g.rb(0x2b72 + b) === 0) continue;
    const dl = g.rb(0x2b6a + b);
    const x = g.rw(0x2b5a + 2 * b);
    g.c(11);
    if (overlap(g, x, 0x18, g.rw(0x2e96), 0x18, dl, 0x0f, g.rb(0x2e98), 0x0f)) return;
  }
  eraseCat(g); // CS:11e3
  g.c(2);
  if (g.rb(0x70f2) !== 0) objectErase(g); // CS:622b
  bx = g.rw(0x2e8d);
  g.ww(0x2e94, bx);
  g.wb(0x2b72 + bx, 1);
  const dl = g.rb(0x2b6a + bx);
  const cx = g.rw(0x2b5a + 2 * bx);
  const di = xyAddr(g, cx, dl);
  copyRect(g, SEG_VRAM, di, 0x2af0, 3, 0x0f);
  g.ww(0x2e8d, 0xffff);
  g.bios.setPalette(0, 0);
  g.c(14);
  hideCreaturesUnderItems(g); // CS:4e3e
  g.c(2);
  if (g.rb(0x70f2) !== 0) objectDraw(g); // CS:61fa
  drawCat(g); // CS:1145
  S.effect(g, 0x3e8, 0x4a5); // CS:593b
}

// CS:2f66 - once per tick: when not carrying, the cat picks up an item it touches.
function pickUp(g) {
  const dx = g.ticks();
  g.c(2);
  if (dx === g.rw(0x2e8f)) return;
  g.ww(0x2e8f, dx);
  g.c(2);
  let hit = -1;
  if (g.rw(0x2e8d) >= 8) {
    g.c(1);
    for (let cx = 8; cx >= 1; cx--) {
      const bx = cx - 1;
      g.c(4);
      if (g.rb(0x2b72 + bx) === 0) continue;
      const dl = g.rb(0x2b6a + bx);
      const ax = g.rw(0x2b5a + 2 * bx);
      g.c(11);
      if (overlap(g, ax, 0x18, g.rw(0x579), 0x18, dl, 0x0f, g.rb(0x57b), 0x0e)) {
        hit = bx;
        break;
      }
    }
  }
  if (hit < 0) {
    g.ww(0x2e94, 0xffff);
    return;
  }
  // L2fb3
  const bx = hit;
  g.c(3);
  if (bx === g.rw(0x2e94)) return;
  eraseCat(g); // CS:11e3
  g.c(2);
  if (g.rb(0x70f2) !== 0) objectErase(g); // CS:622b
  g.wb(0x2b72 + bx, 0);
  const dl = g.rb(0x2b6a + bx);
  g.ww(0x2e8d, bx);
  const cx = g.rw(0x2b5a + 2 * bx);
  const di = xyAddr(g, cx, dl);
  copyRect(g, SEG_VRAM, di, 0x2b7a, 3, 0x0f);
  g.c(12);
  if (g.rb(0x70f2) !== 0) objectDraw(g); // CS:61fa
  drawCat(g); // CS:1145
  g.bios.setPalette(0, 1);
  S.effect(g, 0x3e8, 0x349); // CS:593b
  g.c(4);
}

// CS:30e3 - draw tile picture BX (0 or 2) at (CX, DL).
function drawTile(g, cx, dl, bx) {
  const di = xyAddr(g, cx, dl);
  copyRect(g, SEG_VRAM, di, g.rw(0x2e20 + bx), 2, 8);
  g.c(7);
}

// CS:300f - room 7 background (called by CS:2790): shelves of random tiles, items.
function drawBackground(g) {
  drawShapes(g, 0x2e24, 0); // CS:2b24
  g.wb(0x2e8a, 0xbf);
  g.ww(0x2e8b, 0);
  g.c(4);
  do {
    g.ww(0x2e88, 0x20);
    do {
      let bx = 0;
      g.c(2);
      if (g.rb(0x2e8a) !== 0xbf) {
        bx = random(g) & 2; // MOV BL,DL / AND BL,2 (BH = 0)
        g.c(3);
      }
      drawTile(g, g.rw(0x2e88), g.rb(0x2e8a), bx);
      const si = g.rw(0x2e8b);
      const ax = (column(g.rw(0x2e88)) + g.rb(0x2bdb + si)) & 0xffff;
      g.wb(0x2be2 + ax, bx);
      g.ww(0x2e88, g.rw(0x2e88) + 0x10);
      g.c(20);
    } while (g.rw(0x2e88) < 0x111);
    g.ww(0x2e8b, g.rw(0x2e8b) + 1);
    g.wb(0x2e8a, g.rb(0x2e8a) - 0x18);
    g.c(4);
  } while (g.rb(0x2e8a) >= 0x2f);
  g.ww(0x2e8d, 0xffff);
  g.ww(0x2e94, 0xffff);
  g.ww(0x2b72, 0);
  g.ww(0x2b74, 0);
  g.ww(0x2b76, 0);
  g.ww(0x2b78, 0);
  let cx = g.rw(0x414);
  g.c(10);
  if (cx === 0) {
    cx = 1;
    g.ww(0x414, cx);
    g.c(2);
  }
  if (cx > 8) cx = 8;
  for (; cx >= 1; cx--) {
    const bx = cx - 1;
    g.wb(0x2b72 + bx, 1);
    g.wb(0x2b6a + bx, 0xb0);
    const x = g.rw(0x2b4a + 2 * bx);
    g.ww(0x2b5a + 2 * bx, x);
    const di = xyAddr(g, x, 0xb0);
    copyRect(g, SEG_VRAM, di, 0x2af0, 3, 0x0f);
    g.c(13);
  }
}

// CS:30fa - landing test in room 7 (called by CS:1608). Returns CF.
function landing(g) {
  const al = (g.rb(0x57b) - 5) & 0xf8;
  g.c(4);
  let bx = -1;
  for (let cx = 7; cx >= 1; cx--) {
    g.c(4);
    if (al === g.rb(0x2bd4 + cx - 1)) {
      bx = cx - 1;
      break;
    }
  }
  if (bx < 0) return false;
  const ch = al;
  const ax = column((g.rw(0x579) + 7) & 0xffff);
  const si = (ax + g.rb(0x2bdb + bx)) & 0xffff;
  g.c(14);
  if (g.rb(0x2be2 + si) !== 0) return false;
  g.wb(0x57b, ch + 5);
  g.wb(0x57c, ch + 5 + 0x32);
  g.c(6);
  return true;
}

// ---------------------------------------------------------------- creatures

// CS:4fbb - store the current creature record (DS:4548, 12 bytes) as number BX.
function storeCreature(g, bx) {
  g.df = 0; // CLD
  const di = g.rw(0x45a8 + ((bx << 1) & 0xff));
  for (let i = 0; i < 0x0c; i++) g.wb(di + i, g.rb(0x4548 + i));
  g.c(0x0c + 7);
}

// CS:4fcd - load creature record BX into DS:4548.
function loadCreature(g, bx) {
  g.df = 0; // CLD
  const si = g.rw(0x45a8 + ((bx << 1) & 0xff));
  for (let i = 0; i < 0x0c; i++) g.wb(0x4548 + i, g.rb(si + i));
  g.c(0x0c + 7);
}

// CS:4fdf - OR a 3-word x 12-row picture DS:SI onto the screen at DI.
function orPicture(g, di, si) {
  g.df = 0; // CLD
  const m = g.mem;
  for (let row = 0; row < 0x0c; row++) {
    for (let i = 0; i < 3; i++) {
      m.vwb(di, m.rb(si) | m.vrb(di));
      m.vwb(di + 1, m.rb(si + 1) | m.vrb(di + 1));
      di = (di + 2) & 0xffff;
      si = (si + 2) & 0xffff;
    }
    di = nextRow(di, 6);
    g.c(3 * 6 + 8);
  }
  g.c(4);
}

// CS:5008 - fill a 3-word x 12-row block at DI with 5555h.
function clearBlock(g, di) {
  g.df = 0; // CLD
  const m = g.mem;
  for (let row = 0; row < 0x0c; row++) {
    for (let i = 0; i < 3; i++) {
      m.vwb(di, 0x55);
      m.vwb(di + 1, 0x55);
      di = (di + 2) & 0xffff;
    }
    di = nextRow(di, 6);
    g.c(3 + 8);
  }
  g.c(5);
}

// CS:4f10 - draw the current creature at DS:45ba.
function drawCreature(g) {
  g.wb(0x454e, 0);
  let si = 0x4500;
  g.c(3);
  if (g.rb(0x454a) !== 0) {
    let bx = g.rw(0x4551);
    g.c(2);
    if (g.rb(0x4553) !== 0) {
      bx = (bx & 0xff00) | (((bx & 2) + 0x0c) & 0xff);
      g.c(2);
    }
    g.c(2);
    if (g.rb(0x454a) === 0xff) bx = (bx + 0x10) & 0xffff;
    si = g.rw(0x4a60 + bx);
    g.c(1);
  }
  const di = g.rw(0x45ba);
  g.ww(0x454c, di);
  g.c(2);
  orPicture(g, di, si);
}

// CS:4f4a - erase the current creature (unless it is hidden).
function eraseCreature(g) {
  g.c(2);
  if (g.rb(0x454e) !== 0) return;
  clearBlock(g, g.rw(0x454c));
}

// CS:502d - current creature touches the falling object. Returns CF.
function creatureMeetsObject(g) {
  g.c(2);
  if (g.rb(0x70f2) === 0) return false;
  g.c(7);
  return overlap(g, g.rw(0x70f3), 0x10, g.rw(0x4548), 0x18, g.rb(0x70f5), 0x08, g.rb(0x454b), 0x0c);
}

// CS:4dd0 - current creature touches the cat. Returns CF.
function creatureMeetsCat(g) {
  g.c(8);
  if (!overlap(g, g.rw(0x579), 0x18, g.rw(0x4548), 0x18, g.rb(0x57b), 0x0e, g.rb(0x454b), 0x0c)) return false;
  g.c(2);
  if (g.rw(0x45b6) === 6) {
    g.wb(0x553, 1); // reached the goal
    eraseCat(g); // CS:11e3
    eraseCreature(g);
    g.c(2);
    return true;
  }
  eraseCat(g); // CS:11e3
  eraseCreature(g);
  drawCat(g); // CS:1145
  g.wb(0x55b, 4);
  g.wb(0x571, 1);
  g.wb(0x576, 4);
  g.wb(0x578, 8);
  g.wb(0x4553, 4);
  let dl = 1;
  g.c(9);
  if (!(g.rw(0x4548) > g.rw(0x579))) dl = 0xff;
  g.wb(0x454a, dl);
  S.effect(g, 0x0ce4, 0x123b); // CS:593b
  g.c(4);
  return true;
}

// CS:4e75 - the current creature hides when it touches an item (the item is removed).
function creatureMeetsItem(g) {
  g.c(1);
  let hit = -1;
  for (let cx = 8; cx >= 1; cx--) {
    const bx = cx - 1;
    g.c(4);
    if (g.rb(0x2b72 + bx) === 0) continue;
    const dl = g.rb(0x2b6a + bx);
    const ax = g.rw(0x2b5a + 2 * bx);
    g.c(11);
    if (overlap(g, ax, 0x18, g.rw(0x4548), 0x18, dl, 0x0f, g.rb(0x454b), 0x0c)) {
      hit = bx;
      break;
    }
  }
  if (hit < 0) return;
  // L4ea6
  g.c(3);
  if (g.rb(0x45be) === 0) {
    eraseCat(g); // CS:11e3
    g.c(2);
    if (g.rb(0x70f2) !== 0) objectErase(g); // CS:622b
  }
  eraseCreature(g);
  const bx = hit;
  g.wb(0x2b72 + bx, 0);
  const dl = g.rb(0x2b6a + bx);
  const cx = g.rw(0x2b5a + 2 * bx);
  const di = xyAddr(g, cx, dl);
  copyRect(g, SEG_VRAM, di, 0x2b7a, 3, 0x0f);
  g.c(14);
  if (g.rb(0x45be) === 0) {
    g.c(2);
    if (g.rb(0x70f2) !== 0) objectDraw(g); // CS:61fa
    drawCat(g); // CS:1145
  }
  let dx = 0;
  g.c(3);
  if (g.rw(0x45b6) !== 6) {
    dx = g.ticks();
    g.c(2);
    if (dx === 0) dx = 0xffff;
  }
  g.ww(0x454f, dx);
}

// CS:4e3e - after an item was put down: every visible creature under an item hides.
function hideCreaturesUnderItems(g) {
  g.wb(0x45be, 1);
  const saved = g.rw(0x45b6);
  g.ww(0x45b6, 0);
  g.c(4);
  do {
    loadCreature(g, g.rw(0x45b6));
    g.c(3);
    if (g.rw(0x454f) === 0) {
      creatureMeetsItem(g);
      storeCreature(g, g.rw(0x45b6));
      g.c(2);
    }
    g.ww(0x45b6, g.rw(0x45b6) + 1);
    g.c(3);
  } while (g.rw(0x45b6) < 7);
  g.ww(0x45b6, saved);
  g.c(2);
}

// CS:4f59 - initialise the seven creatures.
function creaturesInit(g) {
  g.ww(0x45b6, 0);
  g.c(1);
  do {
    const r = random(g);
    g.ww(0x4548, ((r & 0x7f) + 0x60) & 0xffff);
    g.wb(0x454a, 0);
    g.wb(0x454e, 1);
    g.ww(0x4551, 0);
    g.wb(0x4553, 0);
    let dx = 0;
    g.c(9);
    if (g.rw(0x45b6) === 0) {
      dx = g.ticks();
      g.c(2);
      if (dx === 0) dx = 0xffff;
    }
    g.ww(0x454f, dx);
    const bx = g.rw(0x45b6);
    g.wb(0x454b, g.rb(0x2bd4 + bx) + 3);
    g.c(5);
    storeCreature(g, bx);
    g.ww(0x45b6, g.rw(0x45b6) + 1);
    g.c(3);
  } while (g.rw(0x45b6) < 7);
  g.ww(0x45b6, 0);
  g.c(1);
}

// CS:4c10 - per tick: move one creature (index cycles 0..6 within ticks).
function creaturesUpdate(g) {
  let dx = g.ticks();
  g.c(2);
  if (dx === g.rw(0x45b8)) return;
  g.ww(0x45b6, g.rw(0x45b6) + 1);
  let bx = g.rw(0x45b6);
  g.c(4);
  let store = true;
  if (bx !== 1 && bx !== 4) {
    g.c(4);
    if (bx < 7) store = false;
    else {
      bx = 0;
      g.ww(0x45b6, bx);
      g.c(2);
    }
  }
  if (store) g.ww(0x45b8, dx);
  // L4c3c
  loadCreature(g, bx);
  if (creatureMeetsObject(g)) return;
  g.c(2);
  if (g.rw(0x454f) !== 0) {
    dx = (g.ticks() - g.rw(0x454f)) & 0xffff;
    let ax = g.rw(0x45c7 + ((g.rw(0x0008) << 1) & 0xff));
    g.c(6);
    if (g.rw(0x45b6) === 0) ax = (ax << 1) & 0xffff;
    g.c(2);
    if (dx < ax) return;
    g.ww(0x454f, 0);
    g.wb(0x454e, 1);
    let x = 0x24;
    g.c(5);
    if (!(g.rw(0x579) > 0xa0)) x = 0x108;
    g.ww(0x4548, x);
    g.wb(0x454a, 0);
    g.c(2);
  }
  // L4c8c
  if (creatureMeetsCat(g)) {
    storeCreature(g, g.rw(0x45b6));
    g.c(2);
    return;
  }
  let L = 'decide';
  g.c(2);
  if (g.rb(0x4553) !== 0) {
    const n = (g.rb(0x4553) - 1) & 0xff;
    g.wb(0x4553, n);
    g.c(2);
    if (n === 0) {
      g.wb(0x454a, g.rb(0x454a) === 0xff ? 1 : 0xff);
      g.c(4);
    }
    L = 'move';
  }
  if (L === 'decide') {
    // L4cb8
    g.c(3);
    if (!(g.rb(0x454b) > g.rb(0x57b))) {
      let chase = false;
      g.c(2);
      if (g.rw(0x45b6) === 6 && g.rb(0x57b) < 0x28) {
        chase = true;
        g.c(2);
      } else {
        const r = random(g) & 0xff;
        g.c(4);
        if (!(r > g.rb(0x45bf + g.rw(0x0008)))) chase = true;
      }
      if (chase) {
        // L4cdc
        let dl = 0;
        const ax = g.rw(0x4548) & 0xff8;
        const cx = g.rw(0x579) & 0xff8;
        g.c(7);
        if (ax !== cx) dl = ax < cx ? 1 : 0xff;
        g.wb(0x454a, dl);
        g.c(3);
        if (g.rb(0x57b) >= 0x28 && g.rw(0x45b6) === 6) {
          g.wb(0x454a, dl === 0xff ? 1 : 0xff);
          g.c(5);
        }
      }
    }
  }
  // L4d14
  g.ww(0x45bc, 8);
  g.c(2);
  if (g.rb(0x4553) !== 0) g.ww(0x45bc, 4);
  let ax = g.rw(0x4548);
  const dir = g.rb(0x454a);
  g.c(3);
  let moved = true;
  if (dir < 1) {
    const r = random(g) & 0xff;
    g.c(3);
    if (!(r > 0x10)) {
      g.wb(0x454a, r & 1 ? 1 : 0xff);
      g.c(4);
    }
    moved = false;
  } else if (dir === 1) {
    ax += g.rw(0x45bc);
    g.c(3);
    if (ax >= 0x10b) {
      ax = 0x10a;
      g.wb(0x454a, 0xff);
      g.wb(0x4553, 0);
      g.c(4);
    }
  } else {
    ax -= g.rw(0x45bc);
    g.c(3);
    if (ax < 0 || ax <= 0x24) {
      ax = 0x25;
      g.wb(0x454a, 1);
      g.wb(0x4553, 0);
      g.c(4);
    }
  }
  if (moved) {
    // L4d78
    g.ww(0x4548, ax);
    g.ww(0x4551, g.rw(0x4551) + 2);
    g.c(4);
    if (g.rw(0x4551) >= 0x0c) g.ww(0x4551, 0);
    g.c(2);
    if (g.rb(0x4553) === 0) {
      const r = random(g) & 0xff;
      g.c(3);
      if (!(r > 8)) g.wb(0x454a, 0);
    }
  }
  // L4da1
  g.ww(0x45ba, xyAddr(g, g.rw(0x4548), g.rb(0x454b)));
  g.c(4);
  if (creatureMeetsObject(g)) return;
  if (!creatureMeetsCat(g)) {
    eraseCreature(g);
    drawCreature(g);
    g.wb(0x45be, 0);
    creatureMeetsItem(g);
  }
  // L4dc8
  storeCreature(g, g.rw(0x45b6));
  g.c(2);
}

// ---------------------------------------------------------------- falling object

// CS:6100 - no falling object yet.
function objectInit(g) {
  g.wb(0x70f2, 0);
  g.c(1);
}

// CS:61fa - draw the falling object at DS:70fa (transparent, background to DS:70cc).
function objectDraw(g) {
  g.wb(0x70f7, 0);
  let ax = ((g.rw(0x70f0) & 0x1e0) + 0x6f30) & 0xffff;
  g.c(5);
  if (g.rb(0x70f6) !== 0xff) ax = (ax + 0xc0) & 0xffff;
  const di = g.rw(0x70fa);
  g.ww(0x70f8, di);
  g.c(5);
  blitOver(g, SEG_VRAM, di, ax, 0x70cc, 2, 8);
}

// CS:622b - restore the background under the falling object.
function objectErase(g) {
  g.c(2);
  if (g.rb(0x70f7) !== 0) return;
  g.c(5);
  copyRect(g, SEG_VRAM, g.rw(0x70f8), 0x70cc, 2, 8);
}

// CS:62a6 - falling object hits the cat: knock it down. Returns CF.
function objectMeetsCat(g) {
  g.c(2);
  if (g.rb(0x70f2) === 0) return false;
  g.c(8);
  if (!overlap(g, g.rw(0x70f3), 0x10, g.rw(0x579), 0x18, g.rb(0x70f5), 0x08, g.rb(0x57b), 0x0e)) return false;
  g.wb(0x571, 1);
  g.wb(0x576, 2);
  g.wb(0x578, 0x20);
  g.wb(0x55b, 8);
  S.effect(g, 0x091d, 0x0ce4); // CS:593b
  g.c(7);
  return true;
}

// CS:6245 - the falling object flips the tile it passes through.
function objectFlipsTile(g) {
  const al = (g.rb(0x70f5) - 8) & 0xf8;
  g.c(4);
  let bx = -1;
  for (let cx = 7; cx >= 1; cx--) {
    g.c(4);
    if (al === g.rb(0x2bd4 + cx - 1)) {
      bx = cx - 1;
      break;
    }
  }
  if (bx < 0) return;
  let ax = g.rw(0x70f3) >> 4;
  g.c(5);
  if (ax < 2) return;
  ax -= 2;
  g.c(2);
  if (ax >= 0x10) return;
  const di = ax;
  ax = (ax + g.rb(0x2bdb + bx)) & 0xffff;
  g.c(5);
  if (ax === g.rw(0x70ec)) return;
  g.ww(0x70ec, ax);
  const si = ax;
  g.wb(0x2be2 + si, g.rb(0x2be2 + si) ^ 2);
  const tile = g.rb(0x2be2 + si);
  const cx = g.rw(0x70fc + 2 * di);
  const dl = g.rb(0x7120 + bx);
  g.c(12);
  objectErase(g); // CS:622b
  g.c(3);
  drawTile(g, cx, dl, tile); // CS:30e3
  objectDraw(g); // CS:61fa
}

// CS:6106 - per tick: launch, move and draw the falling object.
function objectUpdate(g) {
  const dx = g.ticks();
  g.c(2);
  if (dx === g.rw(0x70ee)) return;
  g.ww(0x70ee, dx);
  if (objectMeetsCat(g)) {
    eraseCat(g); // CS:11e3
    objectErase(g);
    drawCat(g); // CS:1145
    g.wb(0x70f2, 0);
    g.c(2);
    return;
  }
  g.c(2);
  if (g.rb(0x70f2) === 0) {
    // L6130: launch a new one from the top or from a side
    for (;;) {
      const r = random(g);
      let bx = r & 0x1f;
      g.c(4);
      if (bx >= 0x10) {
        bx -= 0x10;
        g.c(3);
        if (bx > 9) continue;
        g.wb(0x70f6, bx >= 5 ? 0xff : 1);
        g.wb(0x70f5, 6);
        g.ww(0x70f3, (g.rw(0x70b8 + 2 * bx) + 4) & 0xffff);
        g.c(10);
      } else {
        let ax = 0x0c;
        let dl = 1;
        g.c(4);
        if (bx & 8) {
          ax = 0x120;
          dl = 0xff;
          g.c(2);
        }
        g.ww(0x70f3, ax);
        g.wb(0x70f6, dl);
        bx &= 7;
        g.wb(0x70f5, g.rb(0x70b0 + bx) + 8);
        g.c(6);
      }
      break;
    }
    // L6188
    g.wb(0x70f2, 1);
    g.wb(0x70f7, 1);
    g.ww(0x70f0, 0);
    g.ww(0x70ec, 0xffff);
    g.c(4);
  }
  // L619e
  g.c(2);
  if (g.rw(0x70f0) < 0xa0) g.ww(0x70f0, g.rw(0x70f0) + 4);
  g.wb(0x70f5, g.rb(0x70f5) + 2);
  g.c(4);
  let gone = false;
  if (g.rb(0x70f5) > 0xbf) gone = true;
  else if (g.rb(0x70f6) === 1) {
    const x = g.rw(0x70f3) + 5;
    g.ww(0x70f3, x);
    g.c(3);
    if ((x & 0xffff) >= 0x12c) gone = true;
  } else {
    const x = g.rw(0x70f3) - 5;
    g.ww(0x70f3, x);
    g.c(3);
    if (x < 0) gone = true;
  }
  if (!gone) {
    // L61dd
    g.ww(0x70fa, xyAddr(g, g.rw(0x70f3), g.rb(0x70f5)));
    g.c(4);
    if (!objectMeetsCat(g)) {
      objectFlipsTile(g);
      objectErase(g);
      objectDraw(g);
      return;
    }
  }
  // L61d4
  g.wb(0x70f2, 0);
  g.c(1);
  objectErase(g);
}

// ---------------------------------------------------------------- winning the room

// CS:522a - move animation sprite BX (word index) towards its limit; counts arrivals.
function moveSprite(g, bx) {
  let ax = g.rw(0x4d4a + bx);
  let d = g.rw(0x4d6f + bx);
  g.c(3);
  if (d >= 1) {
    if (d === 1) {
      ax = (ax + g.rw(0x4d6a)) & 0xffff;
      g.c(3);
      if (ax > g.rw(0x4dd0)) {
        ax = g.rw(0x4dd0);
        g.wb(0x4d6e, g.rb(0x4d6e) + 1);
        g.c(3);
      }
    } else {
      ax -= g.rw(0x4d6a);
      g.c(2);
      if (ax < 0) {
        ax = 0;
        g.wb(0x4d6e, g.rb(0x4d6e) + 1);
        g.c(2);
      }
    }
    g.ww(0x4d4a + bx, ax);
  }
  ax = g.rw(0x4d5a + bx);
  d = g.rw(0x4d7f + bx);
  g.c(3);
  if (d < 1) return;
  if (d === 1) {
    ax = (ax + g.rw(0x4d6c)) & 0xffff;
    g.c(3);
    if (ax > g.rw(0x4dd2)) {
      ax = g.rw(0x4dd2);
      g.wb(0x4d6e, g.rb(0x4d6e) + 1);
      g.c(3);
    }
  } else {
    ax -= g.rw(0x4d6c);
    g.c(2);
    if (ax < 0) {
      ax = 0;
      g.wb(0x4d6e, g.rb(0x4d6e) + 1);
      g.c(2);
    }
  }
  g.ww(0x4d5a + bx, ax);
}

// CS:519b - eight sprites fly out from one point until they reach their limits.
function* burst(g) {
  g.wb(0x4d91, 1);
  g.c(2);
  for (let cx = 8; cx >= 1; cx--) {
    S.tuneStep(g); // CS:5b63
    const bx = (cx - 1) * 2;
    g.ww(0x4d4a + bx, g.rw(0x4dcc));
    g.ww(0x4d5a + bx, g.rw(0x4dce));
    g.c(10);
  }
  g.wb(0x4d6e, 0);
  g.c(3);
  do {
    // L51c7
    g.ww(0x4a80, g.ticks());
    g.c(2);
    for (let cx = 8; cx >= 1; cx--) {
      S.tuneStep(g); // CS:5b63
      const bx = (cx - 1) * 2;
      g.c(9);
      if (g.rb(0x4d91) === 0 || cx === 8) {
        const di = xyAddr(g, g.rw(0x4d4a + bx), g.rb(0x4d5a + bx));
        const sz = g.rw(0x4dd4);
        g.c(6);
        blitOver(g, SEG_VRAM, di, g.rw(0x4dca), 0x0e, sz & 0xff, sz >> 8);
      }
      moveSprite(g, bx); // CS:522a
      g.c(3);
    }
    for (;;) {
      // L520c
      S.tuneStep(g); // CS:5b63
      const d = (g.ticks() - g.rw(0x4a80)) & 0xffff;
      g.c(4);
      if (d >= g.rw(0x4dc8)) break;
      yield;
    }
    g.wb(0x4d91, 0);
    g.c(3);
  } while (g.rb(0x4d6e) === 0);
}

// CS:514a - three bursts with parameters from the tables at DS:4d92..4dc2.
function* bursts(g) {
  for (let cx = 3; cx >= 1; cx--) {
    const bx = (3 - cx) << 1;
    g.ww(0x4d6a, g.rw(0x4da4 + bx));
    g.ww(0x4d6c, g.rw(0x4daa + bx));
    g.ww(0x4dcc, g.rw(0x4d98 + bx));
    g.ww(0x4dce, g.rw(0x4d9e + bx));
    g.ww(0x4dd0, g.rw(0x4db0 + bx));
    g.ww(0x4dd2, g.rw(0x4db6 + bx));
    g.ww(0x4dd4, g.rw(0x4dbc + bx));
    g.ww(0x4dca, g.rw(0x4d92 + bx));
    g.ww(0x4dc8, g.rw(0x4dc2 + bx));
    g.c(24);
    yield* burst(g); // CS:519b
    g.c(2);
  }
}

// CS:5060 - the cat rises from the top of the screen towards the middle.
function* catRises(g) {
  let ax = g.rw(0x579);
  g.c(5);
  if (ax >= 0x117) ax = 0x116;
  ax = ax < 0x10 ? 0 : ax - 0x10;
  ax &= 0xff0;
  g.ww(0x579, ax);
  g.wb(0x57b, 0x14);
  if (ax < 0x80) ax = ~(ax - 0x80) & 0xffff;
  else ax -= 0x80;
  ax >>= 3;
  if (ax > 0x0d) ax = 0x0d;
  g.ww(0x4d6a, ax + 2);
  g.ww(0x4dd6, 0x0a);
  g.c(16);
  for (;;) {
    // L50a1
    g.c(2);
    if (g.rw(0x4dd6) !== 0x0a) S.tuneStep(g); // CS:5b63
    g.ww(0x4a80, g.ticks());
    let x = g.rw(0x579);
    const cx = x & 0xff0;
    g.c(6);
    if (cx === 0x80) x = cx;
    else if (cx > 0x80) x = (x - g.rw(0x4d6a)) & 0xffff;
    else x = (x + g.rw(0x4d6a)) & 0xffff;
    g.ww(0x579, x);
    g.c(4);
    if (g.rb(0x57b) >= 0x54) return;
    g.wb(0x57b, g.rb(0x57b) + 8);
    const di = xyAddr(g, (g.rw(0x579) + 4) & 0xffff, g.rb(0x57b));
    g.ww(0x4dd8, di);
    g.c(8);
    blitOver(g, SEG_VRAM, di, 0x4b8a, 0x0e, 7, 0x20);
    copyRect(g, SEG_VRAM, (g.rw(0x4dd8) + 0xf3) & 0xffff, 0x4a82, 4, 0x0d);
    g.c(8);
    if (g.rw(0x4dd6) === 0x0a) {
      S.sweep(g); // CS:572e
      S.tuneInit(g); // CS:5b54
    }
    for (;;) {
      // L5120
      S.tuneStep(g); // CS:5b63
      const d = (g.ticks() - g.rw(0x4a80)) & 0xffff;
      g.c(4);
      if (d >= g.rw(0x4dd6)) break;
      yield;
    }
    g.c(2);
    if (g.rw(0x4dd6) === 0x0a) {
      // CS:38b0 (room 1's routine; its room-7 path ends with ES = B800)
      yield* roomHooks(1).successAnimation(g);
      g.bios.setPalette(0, 0);
      g.c(3);
    }
    g.ww(0x4dd6, 2);
    g.c(2);
  }
}

// CS:528b - leaving room 7 after reaching the goal (called by CS:1bf0). Generator.
function* leaveSuccess(g) {
  S.tuneInit(g); // CS:5b54
  g.c(2);
  if (g.rb(0x697) !== 0xfd) g.bios.setPalette(1, 1);
  yield* catRises(g); // CS:5060
  yield* bursts(g); // CS:514a
  yield* S.tunePlay(g); // CS:5bbf
  g.c(2);
  if (g.rb(0x1f80) < 9) g.wb(0x1f80, g.rb(0x1f80) + 1);
  g.c(2);
  if (g.rw(0x0008) < 7) g.ww(0x0008, g.rw(0x0008) + 1);
  g.ww(0x414, 0);
  g.ww(0x412, g.ticks());
  g.c(3);
  speakerOff(g); // CS:5b21
}

// CS:52d0 - next note of the success tune, once per tick (sound on only).
function successNote(g) {
  g.c(2);
  if (g.rb(0x0000) === 0) return;
  const dx = g.ticks();
  g.c(2);
  if (dx === g.rw(0x52c4)) return;
  g.ww(0x52c4, dx);
  const bx = g.rw(0x52c6);
  g.ww(0x52c6, g.rw(0x52c6) + 2);
  const ax = g.rw(0x52ca + bx);
  g.c(5);
  if (ax === g.rw(0x52c8)) {
    speakerOff(g); // CS:5b21
    return;
  }
  g.ww(0x52c8, ax);
  g.out43(0xb6);
  S.tone(g, g.rw(0x52c8));
  g.c(3);
}

// CS:5368 - draw the skill's success pictures (list of (screen, flags) pairs).
function successFrame(g) {
  g.ww(0x5010, g.rw(0x52ae + ((g.rw(0x0008) << 1) & 0xffff)));
  g.c(6);
  for (;;) {
    let bx = g.rw(0x5010);
    const di = g.rw(bx);
    g.c(4);
    if (di === 0) return;
    bx = (g.rw(bx + 2) ^ g.rw(0x5016)) & 2;
    copyRect(g, SEG_VRAM, di, g.rw(0x5012 + bx), 4, 0x23);
    successNote(g); // CS:52d0
    g.ww(0x5010, g.rw(0x5010) + 4);
    g.c(8);
  }
}

// CS:5313 - back in the alley after room 7 (skill >= 2): blinking pictures, tune.
function* successAnimation(g) {
  g.c(2);
  if (g.rw(0x0008) < 2) return;
  g.ww(0x5016, 0);
  const dx = g.ticks();
  g.ww(0x52c0, dx);
  g.ww(0x52c2, dx);
  g.ww(0x52c4, dx);
  g.ww(0x52c6, 0);
  g.ww(0x52c8, 0);
  g.c(7);
  for (;;) {
    // L533c
    successFrame(g); // CS:5368
    g.ww(0x5016, g.rw(0x5016) ^ 2);
    g.c(1);
    let d;
    for (;;) {
      // L5345
      successNote(g); // CS:52d0
      d = g.ticks();
      g.c(4);
      if (((d - g.rw(0x52c0)) & 0xffff) >= 5) break;
      yield;
    }
    g.ww(0x52c0, d);
    g.c(3);
    if (((d - g.rw(0x52c2)) & 0xffff) >= 0x28) break;
  }
  speakerOff(g); // CS:5b21
}

// ---------------------------------------------------------------- room loop

// CS:0260 - room 7 entry and loop (loop head CS:027e).
function* loop(g) {
  g.ww(0x0004, 7);
  g.c(1);
  yield* roomTransition(g); // CS:1bf0
  roomBackground(g); // CS:2790 (-> CS:300f)
  placeCatFromRoom(g); // CS:07a1
  dogInit(g); // CS:1e40
  floorInit(g); // CS:3405
  objectInit(g); // CS:6100
  creaturesInit(g); // CS:4f59
  S.musicReset(g); // CS:58bd
  g.c(8);
  for (;;) {
    yield 0x027e; // loop head L027e (sync point)
    yield* hotKeys(g, pauseScreen); // CS:1338
    pollInput(g); // CS:1200
    S.alleyMusic(g); // CS:546d
    yield* catUpdate(g); // CS:08e5
    objectUpdate(g); // CS:6106
    pickUp(g); // CS:2f66
    putDown(g); // CS:2e60
    creaturesUpdate(g); // CS:4c10
    g.c(13);
    if ((g.rb(0x551) | g.rb(0x553) | g.rb(0x41c) | g.rb(0x41b)) !== 0) return;
  }
}

registerRoom(7, { loop, drawBackground, landing, leaveSuccess, successAnimation });

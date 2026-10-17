// The alley scene: background construction, moving clothes lines, windows and thrown
// objects, the dog, the critter popping out of the cans, and the mice.

import { random, xyAddr, blitAnd, blitOver, copyRect, saveRect, copyStride, overlap, SEG_DS, SEG_VRAM } from './prims.js';
import * as S from './sound.js';
import { speakerOff } from './input.js';
import { addScore } from './score.js';
import { eraseCat, saveUnderCat, startFall, catHit, placeCatInAlley } from './cat.js';

// ---------------------------------------------------------------- background

// CS:1d31 - per-room CGA palette (INT 10h AH=0Bh BH=1), background black.
export function roomPalette(g) {
  if (g.rb(0x697) === 0xfd) g.unsupported('PCjr palette registers (CS:1d48)');
  g.bios.setPalette(1, g.rb(0x1853 + g.rw(0x0004)));
  g.bios.setPalette(0, 0);
  g.c(12);
}

function fillScreen(g, word) {
  g.df = 0; // CLD
  const v = g.mem.vram;
  for (const base of [0, 0x2000]) {
    for (let i = 0; i < 0x1f40; i += 2) {
      v[base + i] = word & 0xff;
      v[base + i + 1] = word >> 8;
    }
  }
  g.c(2 * 0xfa0 + 10);
}

// CS:2b24 - draw a shape list: header (rows<<8 | bytes), then (src, dst) pairs, FFFF ends.
export function drawShapes(g, bx, ax) {
  g.df = 0; // CLD at CS:2b40
  const cx = g.rw(bx);
  g.ww(0x2ac7, cx);
  g.ww(0x2acc, ax);
  bx += 2;
  g.c(6);
  for (;;) {
    let si = g.rw(bx);
    g.c(3);
    if (si === 0xffff) return;
    let di = (g.rw(bx + 2) + g.rw(0x2acc)) & 0xffff;
    const c = g.rw(0x2ac7);
    g.wb(0x2ad0, c >> 8);
    g.ww(0x2ace, c & 0xff);
    g.c(6);
    do {
      const n = g.rw(0x2ace);
      for (let i = 0; i < n; i++) {
        g.mem.vwb(di, g.rb(si));
        di = (di + 1) & 0xffff;
        si = (si + 1) & 0xffff;
      }
      di = (di - n) & 0xffff;
      di ^= 0x2000;
      if (!(di & 0x2000)) di = (di + 0x50) & 0xffff;
      g.wb(0x2ad0, g.rb(0x2ad0) - 1);
      g.c(n + 9);
    } while (g.rb(0x2ad0) !== 0);
    bx += 4;
  }
}

// CS:2b9e - brick wall: random bricks, the fence band, random wall details.
function drawWall(g) {
  g.ww(0x2ac2, 0x103e);
  for (;;) {
    g.ww(0x2ac2, g.rw(0x2ac2) + 2);
    const di = g.rw(0x2ac2);
    g.c(4);
    if (di >= 0x1090) break;
    let dl;
    do {
      dl = random(g) & 0x30;
      g.c(3);
    } while (dl === g.rb(0x2ac4));
    g.wb(0x2ac4, dl);
    copyRect(g, SEG_VRAM, di, 0x2904 + dl, 1, 8);
  }
  g.df = 0; // CLD at CS:2bdb
  const v = g.mem.vram;
  for (const base of [0x1180, 0x3180]) {
    for (let i = 0; i < 0xa00; i += 2) {
      v[base + i] = 0x55;
      v[base + i + 1] = 0x56;
    }
  }
  g.c(2 * 0x500 + 8);
  g.ww(0x2ac2, 0x2944);
  do {
    g.wb(0x2ac4, 9);
    do {
      const di = ((random(g) & 0x776) + 0x12c0) & 0xffff;
      copyRect(g, SEG_VRAM, di, g.rw(0x2ac2), 1, 5);
      g.wb(0x2ac4, g.rb(0x2ac4) - 1);
      g.c(4);
    } while (g.rb(0x2ac4) !== 0);
    g.ww(0x2ac2, g.rw(0x2ac2) + 0x0a);
    g.c(3);
  } while (g.rw(0x2ac2) < 0x296c);
  g.wb(0x2ac4, 5);
  do {
    const di = ((random(g) & 0x3e) + 0x3a98) & 0xffff;
    copyRect(g, SEG_VRAM, di, 0x296c, 1, 5);
    g.wb(0x2ac4, g.rb(0x2ac4) - 1);
    g.c(4);
  } while (g.rb(0x2ac4) !== 0);
}

// CS:2a68 - skill indicator.
function drawSkillMark(g) {
  const bx = (g.rw(0x6df8) & 3) << 1;
  copyRect(g, SEG_VRAM, 0x1902, g.rw(0x2ad1 + bx), 1, 8);
  g.c(6);
}

// CS:2c3d - one window column (top, middle sections, bottom).
function drawWindowColumn(g, di) {
  g.ww(0x2ac2, di);
  g.wb(0x2ac4, di >= 0x1720 ? 2 : 3);
  g.ww(0x2ac2, g.rw(0x2ac2) + 0x1e0);
  copyRect(g, SEG_VRAM, di, 0x2976, 5, 0x0c);
  g.c(10);
  do {
    const d = g.rw(0x2ac2);
    g.ww(0x2ac2, d + 0x140);
    copyRect(g, SEG_VRAM, d, 0x29ee, 4, 8);
    g.wb(0x2ac4, g.rb(0x2ac4) - 1);
    g.c(6);
  } while (g.rb(0x2ac4) !== 0);
  copyRect(g, SEG_VRAM, g.rw(0x2ac2), 0x2a2e, 4, 0x0b);
}

// CS:2c84 - the cans for the current skill (list of screen offsets, 0 ends).
function drawCans(g) {
  let bx = g.rb(0x2ab2 + g.rw(0x0008));
  g.c(4);
  for (;;) {
    g.ww(0x2ac5, bx);
    const di = g.rw(0x2a86 + bx);
    g.c(4);
    if (di === 0) return;
    drawWindowColumn(g, di);
    bx = (g.rw(0x2ac5) + 2) & 0xffff;
  }
}

// CS:2b71 / CS:2b8b - rows of windows.
function drawWindowRow(g, di) {
  g.wb(0x2ac4, 4);
  do {
    copyRect(g, SEG_VRAM, di, 0x2680, 5, 0x10);
    di = (di + 0x14) & 0xffff;
    g.wb(0x2ac4, g.rb(0x2ac4) - 1);
    g.c(5);
  } while (g.rb(0x2ac4) !== 0);
}
function drawWindows(g) {
  drawWindowRow(g, 0x3c5);
  drawWindowRow(g, 0x8c5);
  drawWindowRow(g, 0xdc5);
}

// CS:2a00 - full alley background.
export function drawAlley(g) {
  fillScreen(g, 0xaaaa);
  drawWall(g);
  drawShapes(g, 0x28a0, 0);
  drawSkillMark(g);
  drawCans(g);
  drawWindows(g);
  linesInit(g);
}

// CS:2a30 - the alley as drawn behind the title (skill forced to 1, no lines/windows).
export function drawTitleAlley(g) {
  fillScreen(g, 0xaaaa);
  drawWall(g);
  drawShapes(g, 0x28a0, 0);
  drawSkillMark(g);
  const keep = g.rw(0x0008);
  g.ww(0x0008, 1);
  drawCans(g);
  g.ww(0x0008, keep);
  g.c(6);
}

// CS:5400 - random alley decorations for the skill level.
export function alleyDecorations(g) {
  let bx = (g.rw(0x0008) & 7) << 1;
  g.ww(0x5918, bx << 3);
  bx = g.rw(0x5908 + bx);
  g.c(10);
  for (;;) {
    const di = g.rw(bx);
    g.c(3);
    if (di === 0xffff) return;
    let si = ((random(g) & 0x0e) + g.rw(0x5918)) & 0xffff;
    si = g.rw(0x5888 + si);
    const cx = g.rw(0x5858 + si);
    si = g.rw(0x584c + si);
    copyRect(g, SEG_VRAM, di, si, cx & 0xff, cx >> 8);
    bx = (bx + 2) & 0xffff;
    g.c(10);
  }
}

// ---------------------------------------------------------------- clothes lines

// CS:06de - one random laundry item into the column buffer; AL=1 if drawn.
function laundryItem(g, di) {
  const dx = random(g) & 6;
  g.c(4);
  if (dx === 6) return { al: 0, di };
  let si = g.rw(0x4d0 + dx);
  for (let i = 0; i < 8; i++) {
    g.wb(di, g.rb(si));
    g.wb(di + 1, g.rb(si + 1));
    si += 2;
    di = (di + 4) & 0xffff;
  }
  g.c(8 * 4 + 4);
  return { al: 1, di };
}

// CS:067d - build the next 16x16 column of a clothes line into DS:04d7.
// BL/BH are skill thresholds. DS:0540 receives the walkability bits of the column.
function lineColumn(g, bl, bh) {
  g.df = 0; // CLD at CS:0682
  g.wb(0x540, 0);
  for (let i = 0; i < 0x40; i += 2) {
    g.wb(0x4d7 + i, 0xaa);
    g.wb(0x4d7 + i + 1, 0xaa);
  }
  g.ww(0x4d7 + 4, 0x4444);
  g.ww(0x4d7 + 6, 0x4444);
  g.c(0x20 + 12);
  let dx = random(g);
  g.c(3);
  if ((dx & 0xff) < bl || (dx >> 8) <= bh) return;
  dx = random(g);
  const dl = dx & 0xff;
  g.c(4);
  if (dl < 0x18 || dl < 0x60) {
    const [cx, src] = dl < 0x18 ? [0x20, 0x490] : [0x10, 0x460];
    for (let i = 0; i < 2 * cx; i++) g.wb(0x4d7 + i, g.rb(src + i));
    g.wb(0x540, 3);
    g.c(cx + 4);
    return;
  }
  const a = laundryItem(g, 0x4d7);
  g.wb(0x540, (a.al << 1) & 0xff);
  const b = laundryItem(g, 0x4d7 + 2);
  g.wb(0x540, g.rb(0x540) | b.al);
  g.c(8);
}

// CS:0633 - shift the line's walkability bitmap by one bit (RCR/RCL through carry).
function shiftLineBits(g, cf) {
  let bx = g.rb(0x541 + g.rw(0x52f));
  g.c(5);
  if (bx === 9) {
    for (let i = 0; i < 5; i++) {
      const v = g.rb(0x1016 + bx);
      g.wb(0x1016 + bx, ((v << 1) | cf) & 0xff);
      cf = v >> 7;
      bx--;
    }
  } else {
    for (let i = 0; i < 5; i++) {
      const v = g.rb(0x1016 + bx);
      g.wb(0x1016 + bx, (v >> 1) | (cf << 7));
      cf = v & 1;
      bx++;
    }
  }
  g.c(25);
}

// CS:0658 - is the cat in this line's band? Returns ZF (true = proceed with scrolling).
function lineBand(g, bx) {
  g.wb(0x4d6, 0);
  const al = g.rb(0x57c);
  g.c(5);
  if (al < g.rb(0x53d + bx) || al >= g.rb(0x53a + bx)) return true;
  if (g.rb(0x55c) < 1) return false;
  g.wb(0x4d6, 1);
  return true;
}

// CS:2ac6 - initial line contents (20 columns).
function lineFill(g, di, bh) {
  g.wb(0x2ac9, bh);
  g.wb(0x2ac4, 0);
  g.c(4);
  do {
    const bl = g.rb(0x2aba + g.rw(0x0008));
    lineColumn(g, bl, g.rb(0x2ac9));
    copyRect(g, SEG_VRAM, di, 0x4d7, 2, 0x10);
    const n = g.rb(0x2ac4);
    const shift = ((~n) & 3) << 1;
    const al = (g.rb(0x540) << shift) & 0xff;
    const idx = (n >> 2) + g.rw(0x2aca);
    g.wb(0x1016 + idx, g.rb(0x1016 + idx) | al);
    di = (di + 4) & 0xffff;
    g.wb(0x2ac4, n + 1);
    g.c(30);
  } while (g.rb(0x2ac4) < 0x14);
}

// CS:2a80
function linesInit(g) {
  for (let bx = 0x0f; bx >= 1; bx--) g.wb(0x1015 + bx, 0);
  g.ww(0x2aca, 0);
  lineFill(g, 0x140, 0x80);
  g.ww(0x2aca, 5);
  lineFill(g, 0x640, 0x30);
  g.ww(0x2aca, 0x0a);
  lineFill(g, 0xb40, 0);
  g.wb(0x525, 0x10);
  g.ww(0x52f, 0);
  g.wb(0x531, 1);
  g.c(40);
}

// CS:04a0 - scroll one clothes line by 4 pixels, carrying the cat if it rides it.
export function clothesline(g) {
  const n = (g.rb(0x531) - 1) & 0xff;
  g.wb(0x531, n);
  g.c(2);
  if (n !== 0) return;
  g.wb(0x531, 1);
  if (g.retrace()) return;
  g.c(6);
  if (g.rb(0x55a) !== 0 || g.rb(0x1673) !== 0) return;
  const dx = g.ticks();
  g.c(3);
  if (dx === g.rw(0x544)) return;
  g.ww(0x544, dx);
  let al = g.rb(0x532 + g.rw(0x0008));
  if (g.rb(0x57b) <= 0x60) al >>= 2;
  g.wb(0x531, al);
  let bx = g.rw(0x52f);
  g.c(10);
  let label;
  if (lineBand(g, bx)) {
    label = 'L050c';
  } else {
    const s = (g.rb(0x525) + g.rb(0x529 + bx)) & 0xff;
    g.c(4);
    if (s < 4) return;
    let dl;
    do {
      dl = random(g) & 3;
      g.c(5);
    } while (dl === g.rb(0x52f) || dl === 3);
    bx = dl;
    label = 'L0535';
  }
  if (label === 'L050c') {
    g.wb(0x525, g.rb(0x525) + g.rb(0x529 + bx));
    g.c(5);
    if (g.rb(0x525) < 4) label = 'L0583';
    else if ((random(g) & 0xff) > 0x40) label = 'L0539';
    else {
      for (;;) {
        const dl = random(g) & 3;
        g.c(5);
        if (dl === 3) continue;
        bx = dl;
        if (lineBand(g, bx)) break;
      }
      label = 'L0535';
    }
  }
  if (label === 'L0535') {
    g.ww(0x52f, bx);
    label = 'L0539';
  }
  if (label === 'L0539') {
    g.wb(0x525, g.rb(0x526 + bx));
    const ah = g.rb(0x52c + bx);
    const bl = g.rb(0x2aba + g.rw(0x0008));
    lineColumn(g, bl, ah);
    g.c(10);
    if (g.rw(0x52f) !== 1) {
      let v = g.rb(0x540);
      shiftLineBits(g, v & 1);
      v = g.rb(0x540) >> 1;
      g.wb(0x540, v);
      shiftLineBits(g, v & 1);
      g.wb(0x540, v >> 1);
    } else {
      const v = g.rb(0x540);
      shiftLineBits(g, (v >> 1) & 1);
      g.wb(0x540, v >> 1);
      shiftLineBits(g, v & 1);
    }
    bx = g.rw(0x52f);
  }
  // L0583: carry the cat along
  g.c(3);
  if (g.rb(0x4d6) !== 0) {
    let ax = g.rw(0x579);
    let fell = false;
    if ((bx & 0xff) === 1) {
      g.ww(0x55f, g.rw(0x55f) - 1);
      if (ax < 4) fell = true;
      else {
        ax -= 4;
        if (ax < 8) fell = true;
      }
    } else {
      g.ww(0x55f, g.rw(0x55f) + 1);
      ax += 4;
      if (ax >= 0x123) fell = true;
    }
    g.c(8);
    if (fell) {
      g.wb(0x55b, 0x11);
      g.wb(0x571, 1);
      g.wb(0x576, 1);
      g.wb(0x578, 0x18);
      g.wb(0x572, 1);
      g.wb(0x55c, 0);
      g.c(6);
    } else g.ww(0x579, ax);
  }
  // L05d0: scroll 8+8 scan lines by one byte
  const b2 = (bx << 1) & 0xffff;
  g.ww(0x523, g.rw(0x51d + b2));
  let si = g.rw(0x517 + b2);
  const v = g.mem;
  const left = b2 === 2;
  g.df = left ? 0 : 1; // CLD / STD at CS:05ec / CS:05f1 (left set on return)
  let di = left ? (si - 1) & 0xffff : (si + 1) & 0xffff;
  const move = (s, d, cnt) => {
    for (let i = 0; i < cnt; i++) {
      v.vwb(d, v.vrb(s));
      if (left) {
        s = (s + 1) & 0xffff;
        d = (d + 1) & 0xffff;
      } else {
        s = (s - 1) & 0xffff;
        d = (d - 1) & 0xffff;
      }
    }
  };
  move(si, di, 0x27f);
  move((si + 0x2000) & 0xffff, (di + 0x2000) & 0xffff, 0x280);
  g.c(0x27f + 0x280 + 20);
  // new column byte
  di = g.rw(0x523);
  let src = 0x4d7 + g.rb(0x525);
  for (let i = 0; i < 16; i++) {
    v.vwb(di, g.rb(src));
    src += 4;
    di ^= 0x2000;
    if (!(di & 0x2000)) di = (di + 0x50) & 0xffff;
  }
  g.c(16 * 8);
}

// ---------------------------------------------------------------- windows & thrown objects

// CS:1830
export function throwerInit(g) {
  g.wb(0x1665, 0);
  g.wb(0x1673, 0);
  g.wb(0x1677, 0);
  g.wb(0x1678, 0);
  g.ww(0x166c, 9);
  g.c(5);
}

// CS:1aea - window number -> (x, y).
function windowPos(g, dl) {
  const cx = g.rw(0x1658 + ((dl & 3) << 1));
  const y = g.rb(0x1660 + ((dl >> 2) & 3));
  g.c(12);
  return { cx, dl: y };
}

// CS:1b05 - cat touching the open window: falling cat enters it. Returns CF.
function windowTouch(g) {
  const hit = overlap(g, g.rw(0x1666), 0x20, g.rw(0x579), 0x18, g.rb(0x1668), 0x0f, g.rb(0x57b), 0x0e);
  g.c(8);
  if (!hit) return false;
  if (g.rb(0x571) === 1 && g.rb(0x55a) === 0 && g.rb(0x57b) < 0x60 &&
      g.rb(0x1665) >= 5 && g.rb(0x1665) < 0x19) {
    g.wb(0x551, 1);
  }
  g.c(10);
  return true;
}

// CS:1b4c - is a mouse below this window? Returns CF.
function mouseBelowWindow(g) {
  const al = g.rb(0x1669);
  g.c(3);
  if (al >= 8) return false;
  const bx = al & 4 ? 4 : 2;
  let ax = (g.rw(0x1f30 + bx) + 0x10) & 0xffff;
  g.c(8);
  if (ax < g.rw(0x1666)) return false;
  ax = ax < 0x30 ? 0 : ax - 0x30;
  return ax <= g.rw(0x1666);
}

// CS:1936 - open/close windows; a person may throw something at the cat.
export function windowsUpdate(g) {
  const n = (g.rb(0x166a) - 1) & 0xff;
  g.wb(0x166a, n);
  g.c(2);
  if (n !== 0) return;
  g.wb(0x166a, 0x0d);
  if (g.retrace()) return;
  g.c(2);
  if (g.rb(0x1665) !== 0) windowTouch(g);
  g.c(2);
  if (g.rb(0x1673) !== 0) return;
  if (g.rb(0x1665) === 0) {
    g.c(2);
    if (g.rb(0x57b) > 0x60) return;
    g.wb(0x1677, 0);
    if (g.rb(0x550) === 1 && g.rb(0x418) === 0) {
      if (((g.ticks() - g.rw(0x556)) & 0xffff) >= 0x48) g.wb(0x1677, g.rb(0x1677) + 1);
    }
    g.c(8);
    for (;;) {
      let dl = random(g) & 0xff;
      g.c(3);
      if (g.rb(0x1677) !== 0) dl &= 3;
      else {
        dl &= 0x0f;
        if (dl >= 0x0c) return;
      }
      g.wb(0x1669, dl);
      const p = windowPos(g, dl);
      g.ww(0x1666, p.cx);
      g.wb(0x1668, p.dl);
      if (windowTouch(g)) continue;
      break;
    }
    g.wb(0x1665, 0x1d);
    g.ww(0x166c, g.rw(0x181e + ((g.rw(0x0008) << 1) & 0xff)));
    g.wb(0x1670, 1);
    g.c(8);
  }
  // L19cd
  if (windowTouch(g)) return;
  g.wb(0x1664, 0);
  if (mouseBelowWindow(g)) {
    g.wb(0x1664, g.rb(0x1664) + 1);
    return;
  }
  g.c(3);
  if (g.rb(0x1665) === 0x10) g.ww(0x166e, g.ticks());
  if (g.rb(0x1665) === 0x0f) {
    g.c(4);
    if (((g.ticks() - g.rw(0x166e)) & 0xffff) < g.rw(0x166c)) {
      if (g.rb(0x1670) !== 0 && g.rb(0x1673) === 0 && g.rb(0x418) === 0) {
        g.wb(0x1670, g.rb(0x1670) - 1);
        g.wb(0x1678, 1);
        g.wb(0x1673, g.rb(0x1668));
        const x = ((random(g) & 0x0f) + g.rw(0x1666)) & 0xffff;
        g.ww(0x1671, x);
        g.wb(0x1674, x >= g.rw(0x579) ? 0xff : 1);
        const bx = random(g) & 6;
        g.ww(0x17dd, g.rw(0x17c9 + bx));
        g.ww(0x17df, g.rw(0x17d1 + bx));
        g.wb(0x1676, g.rb(0x17d9 + (bx >> 1)));
        g.ww(0x17ea, 0x20);
        g.wb(0x17e9, 1);
        g.wb(0x1675, 0);
        g.c(30);
      }
      return;
    }
  }
  // L1a76: animate the window opening (state > 0Eh) or closing
  const st = (g.rb(0x1665) - 1) & 0xff;
  g.wb(0x1665, st);
  const cx = g.rw(0x1666);
  let dl = g.rb(0x1668);
  dl = st > 0x0e ? (dl + st - 0x0e) & 0xff : (dl + 0x0e - st) & 0xff;
  g.wb(0x166b, dl);
  let di = xyAddr(g, cx, dl);
  g.c(12);
  g.df = 0; // CLD at CS:1aa8
  const rowIdx = (g.rb(0x166b) - g.rb(0x1668)) & 0xff;
  let si;
  if (st > 0x0e) {
    if (g.rb(0x418) === 0) {
      for (let i = 0; i < 8; i++) g.mem.vwb(di + i, 0);
      g.c(8);
      return;
    }
    si = (0x15e0 + (rowIdx << 3)) & 0xffff;
  } else {
    si = (0x2681 + ((rowIdx * 10) & 0xffff)) & 0xffff;
  }
  for (let i = 0; i < 8; i++) g.mem.vwb(di + i, g.rb(si + i));
  g.c(8);
}

// CS:1922
function eraseThrown(g) {
  const cx = g.rw(0x17e3);
  copyRect(g, SEG_VRAM, g.rw(0x17e5), 0x17ee, cx & 0xff, cx >> 8);
}

// CS:1b7a - thrown object hits the cat. Returns CF.
export function* thrownHitsCat(g) {
  g.c(3);
  if (g.rw(0x0004) !== 0) return false;
  const dl = g.rb(0x1673);
  g.c(3);
  if (dl === 0) return false;
  const size = g.rw(0x17df);
  if (!overlap(g, g.rw(0x1671), 0x10, g.rw(0x579), 0x18, dl, size >> 8, g.rb(0x57b), 0x0e)) {
    g.c(10);
    return false;
  }
  eraseCat(g);
  eraseThrown(g);
  startFall(g);
  g.c(3);
  if (g.rb(0x1675) === 0) {
    g.wb(0x1675, 1);
    yield* catHit(g);
    g.wb(0x1674, g.rb(0x1674) === 0xff ? 1 : 0xff);
    g.ww(0x17ea, 0x60);
    g.wb(0x17e9, 1);
    g.wb(0x55c, 0);
    g.c(8);
  }
  return true;
}

// CS:184b - fly the thrown object.
export function* thrownUpdate(g) {
  g.c(3);
  if (g.rb(0x1673) === 0) return;
  const t = g.ticks();
  g.c(3);
  if (t === g.rw(0x17ec)) return;
  g.ww(0x17ec, t);
  if (g.rb(0x1677) !== 0 && (g.rw(0x1671) & 0xfff8) === (g.rw(0x579) & 0xfff8)) g.wb(0x1674, 0);
  g.wb(0x17e9, g.rb(0x17e9) + 1);
  if (g.rw(0x17ea) <= 1) g.ww(0x17ea, g.rw(0x17ea) - 1);
  let ax = g.rw(0x1671);
  const d = g.rw(0x17ea);
  const dx = (d & 0xff00) | ((d & 0xff) >> 3);
  const dir = g.rb(0x1674);
  g.c(16);
  if (dir === 1) {
    ax = (ax + dx) & 0xffff;
    if (ax >= 0x12f) ax = 0x12e;
  } else if (dir !== 0) {
    ax = ax < dx ? 0 : ax - dx;
  }
  g.ww(0x1671, ax);
  let bx = g.rw(0x17df);
  const dl = ((g.rb(0x17e9) >> 1) + g.rb(0x1673)) & 0xff;
  const al = dl - g.rb(0x1676);
  g.c(10);
  if (al >= 0) {
    const bh = (bx >> 8) - al;
    if (bh <= 0) {
      g.wb(0x1673, 0);
      g.wb(0x1678, 0);
      eraseThrown(g);
      return;
    }
    bx = ((bh & 0xff) << 8) | (bx & 0xff);
  }
  g.wb(0x1673, dl);
  g.ww(0x17e1, bx);
  g.ww(0x17e7, xyAddr(g, g.rw(0x1671), dl));
  g.c(6);
  if (g.rb(0x17e9) !== 2) eraseThrown(g);
  if (yield* thrownHitsCat(g)) return;
  const di = g.rw(0x17e7);
  g.ww(0x17e5, di);
  const cx = g.rw(0x17e1);
  g.ww(0x17e3, cx);
  blitOver(g, SEG_VRAM, di, g.rw(0x17dd), 0x17ee, cx & 0xff, cx >> 8);
}

// ---------------------------------------------------------------- the dog

// CS:1e40
export function dogInit(g) {
  g.wb(0x1cbf, 0);
  g.ww(0x1ce1, 0);
  g.wb(0x1cc0, 0);
  g.wb(0x1cc1, 0);
  g.wb(0x1cb8, 0);
  g.wb(0x1cc8, 0xb1);
  S.chaseSoundInit(g);
  g.c(8);
}

// CS:2022 - pick the dog frame.
function dogFrame(g) {
  let bl;
  if (g.rb(0x1cb8) !== 0) {
    g.wb(0x1ccf, g.rb(0x1ccf) + 1);
    bl = (g.rb(0x1ccf) & 6) | 8;
  } else {
    g.wb(0x1ccf, g.rb(0x1ccf) + 2);
    bl = g.rb(0x1ccf) & 2;
    if (g.rb(0x1cd0) === 1) bl |= 4;
  }
  g.ww(0x1cbb, g.rw(0x15c8 + bl));
  g.c(12);
}

// CS:2059 - partial dog while it squeezes in from a screen edge.
function dogEdgeFrame(g, al, ah) {
  g.ww(0x1cc4, 0x0f04 - al);
  if (ah === 0xff) {
    g.ww(0x1cc6, ((al << 3) & 0xff) + 0x120);
  } else {
    g.ww(0x1cbb, g.rw(0x1cbb) + ((al << 1) & 0xff));
    g.ww(0x1cc6, 0);
  }
  const cx = g.rw(0x1cc4);
  copyStride(g, SEG_DS, 0x0e, g.rw(0x1cbb), cx & 0xff, cx >> 8, 4);
  g.ww(0x1cbb, 0x0e);
  g.c(14);
}

// CS:209b - draw the dog (transparent; opaque while fighting).
function drawDog(g) {
  const cx = g.rw(0x1cc4);
  g.ww(0x1cc2, cx);
  g.c(5);
  if (g.rb(0x1cb8) === 0) {
    blitOver(g, SEG_VRAM, g.rw(0x1cbd), g.rw(0x1cbb), 0x1c40, cx & 0xff, cx >> 8);
    return;
  }
  saveRect(g, 0x1c40, g.rw(0x1cbd), cx & 0xff, cx >> 8);
  copyRect(g, SEG_VRAM, g.rw(0x1cbd), g.rw(0x1cbb), cx & 0xff, cx >> 8);
  g.c(10);
}

// CS:20e1
function eraseDog(g) {
  const cx = g.rw(0x1cc2);
  copyRect(g, SEG_VRAM, g.rw(0x1cbd), 0x1c40, cx & 0xff, cx >> 8);
}

// CS:2136 - the dog catches the cat: fight, cat thrown to the far side.
export function dogGrabsCat(g) {
  if (g.rw(0x0004) === 6) {
    g.wb(0x1cc8, g.rb(0x57b));
    g.ww(0x1cc6, g.rw(0x579));
  }
  let ax = ((g.rw(0x1cc6) + g.rw(0x579)) & 0xffff) >> 1;
  if (ax >= 0x118) ax = 0x117;
  g.ww(0x1cc6, ax);
  let bl;
  let dx;
  if (ax > 0xa0) {
    bl = 1;
    dx = ax - 0x9f;
  } else {
    bl = 0xff;
    dx = 0xa1 - ax;
  }
  g.wb(0x1cb8, bl);
  g.wb(0x1cbf, 1);
  g.wb(0x1cc1, 0);
  g.ww(0x1cb9, dx >> 3);
  g.c(24);
  if (g.rw(0x0004) === 6) {
    eraseCat(g);
    const keep = g.rb(0x1cb8);
    g.wb(0x1cb8, 0);
    g.ww(0x1cc4, 0x0f04);
    g.ww(0x1cbb, g.rw(0x15c8));
    g.ww(0x1cbd, xyAddr(g, g.rw(0x1cc6), g.rb(0x1cc8)));
    drawDog(g);
    g.wb(0x1cb8, keep);
    g.c(10);
  }
  eraseDog(g);
  eraseCat(g);
  g.ww(0x579, g.rw(0x579) < 0xa0 ? 0x122 : 0);
  g.c(5);
  if (g.rw(0x0004) === 0) placeCatInAlley(g);
  return true;
}

// CS:20f5 - dog reaches the cat on the ground. Returns CF.
export function dogMeetsCat(g) {
  g.c(3);
  if (g.rb(0x1cb8) !== 0) return false;
  if ((g.rb(0x1cbf) | g.rb(0x1cc0) | g.rb(0x1cc1)) === 0) return false;
  g.c(4);
  if (g.rb(0x57b) < 0xa3 || g.rb(0x558) !== 0) return false;
  let ax = (g.rw(0x1cc6) + 0x20) & 0xffff;
  g.c(6);
  if (ax < g.rw(0x579)) return false;
  ax = ax < 0x38 ? 0 : ax - 0x38;
  if (ax > g.rw(0x579)) return false;
  return dogGrabsCat(g);
}

// CS:1e63 - dog: appear from an edge, patrol, chase, fight.
export function dogUpdate(g) {
  const cx = g.ticks();
  const d = (cx - g.rw(0x1cc9)) & 0xffff;
  g.c(9); // SUB AH,AH / MOV / SUB / MOV / AND / ADD / CMP / JNC / RET
  if (d < (g.rw(0x1ce1) & 1) + 1) return;
  g.c(2); // JZ / RET after CALL 13d8
  if (!g.retrace()) return;
  g.ww(0x1cc9, cx);
  g.ww(0x1ce1, g.rw(0x1ce1) + 1);
  let ax;
  g.c(4);
  let label = 'L1fab';
  if (g.rb(0x1cc1) !== 0) {
    const n = (g.rb(0x1cc1) - 1) & 0xff;
    g.wb(0x1cc1, n);
    if (n === 0) {
      speakerOff(g);
      if (g.rb(0x1cb8) !== 0) {
        if (g.rw(0x0004) !== 0) {
          g.wb(0x552, 0xdd);
          g.ww(0x579, 0xa0);
          g.wb(0x57b, 0x60);
          return;
        }
        if (g.rb(0x1f80) !== 0) g.wb(0x1f80, g.rb(0x1f80) - 1);
      }
      eraseDog(g);
      dogInit(g);
      return;
    }
    dogFrame(g);
    const al = (4 - g.rb(0x1cc1)) & 0xff;
    const ah = g.rb(0x1cd0) !== 0xff ? 0xff : 1;
    dogEdgeFrame(g, al, ah);
    label = 'L1ffb';
  } else if (g.rb(0x1cb8) !== 0) {
    let dl = g.rb(0x1cb8);
    if (g.rw(0x1cb9) !== 0) {
      g.ww(0x1cb9, g.rw(0x1cb9) - 1);
      dl = random(g) & 1 ? 1 : 0xff;
    }
    g.wb(0x1cd0, dl);
    ax = g.rw(0x1cc6);
    g.c(8);
  } else {
    let toPatrol = g.rb(0x1cbf) !== 0;
    if (!toPatrol) {
      if (g.rb(0x1cc0) === 0) {
        g.c(3);
        if (g.rb(0x1d58) === 0) {
          if (g.rb(0x57b) < 0xb4 || g.rb(0x558) !== 0) return;
          if ((random(g) & 0xff) >= g.rb(0x1cd1 + g.rw(0x0008))) return;
        }
        g.ww(0x59ba, 0);
        g.wb(0x1cd0, g.rw(0x579) < 0xa0 ? 0xff : 1);
        g.wb(0x1cc0, 4);
        g.c(8);
      }
      const n = (g.rb(0x1cc0) - 1) & 0xff;
      g.wb(0x1cc0, n);
      if (n === 0) {
        g.wb(0x1cbf, 1);
        toPatrol = true;
      } else {
        dogFrame(g);
        dogEdgeFrame(g, g.rb(0x1cc0), g.rb(0x1cd0));
        label = 'L1ffb';
      }
    }
    if (toPatrol) {
      // L1f75
      g.wb(0x1d58, 0);
      ax = g.rw(0x1cc6);
      g.c(4);
      if (g.rb(0x57b) >= 0xb4 && g.rb(0x558) === 0) {
        if ((random(g) & 0xff) <= g.rb(0x1cd9 + g.rw(0x0008))) {
          g.wb(0x1cd0, ax > g.rw(0x579) ? 0xff : 1);
        }
      }
    }
  }
  if (label === 'L1fab') {
    const dir = g.rb(0x1cd0);
    g.c(3);
    let edge = false;
    if (dir === 1) {
      ax = (ax + 8) & 0xffff;
      if (ax >= 0x11e) {
        ax = 0x11e;
        edge = true;
      }
    } else if (dir !== 0) {
      if (ax < 8) {
        ax = 0;
        edge = true;
      } else ax -= 8;
    }
    if (edge) {
      // L1fbb: the dog leaves at the edge unless it is still chasing
      let leave;
      if (g.rb(0x1cb8) !== 0) leave = g.rw(0x1cb9) === 0;
      else leave = !(g.rb(0x57b) >= 0xb4 && g.rb(0x558) === 0);
      if (leave) g.wb(0x1cc1, 4);
      g.c(6);
    }
    g.ww(0x1cc6, ax);
    dogFrame(g);
    g.ww(0x1cc4, 0x0f04);
  }
  // L1ffb
  g.ww(0x1ccd, xyAddr(g, g.rw(0x1cc6), g.rb(0x1cc8)));
  if (g.rb(0x1cc0) !== 3) eraseDog(g);
  if (dogMeetsCat(g)) return;
  g.ww(0x1cbd, g.rw(0x1ccd));
  drawDog(g);
}

// ---------------------------------------------------------------- critter in the cans

// CS:2210
export function critterInit(g) {
  g.wb(0x1d59, 0);
  g.c(1);
}

// CS:15d0 - random can for the critter: returns {cx, dl}.
function randomCan(g) {
  const cl = g.rb(0x100e + g.rw(0x0008));
  let dl;
  g.c(4);
  for (;;) {
    do {
      dl = random(g) & 7;
      g.c(3);
    } while (dl > cl);
    dl = (dl + g.rb(0x1006 + g.rw(0x0008))) & 0xff;
    g.c(3);
    if (dl !== g.rb(0x1028)) break;
  }
  g.wb(0x1028, dl);
  const c = g.rb(0xff0 + dl);
  g.c(10);
  return { cx: (c & 0x7f) << 2, dl: c & 0x80 ? 0x88 : 0x90 };
}

// CS:22f7 - critter touches the cat. Returns CF (also sets DS:1d58 for the dog).
export function critterTouches(g) {
  g.c(3);
  if (g.rb(0x1d59) === 0) return false;
  const rows = g.rb(0x1d65);
  const hit = overlap(g, g.rw(0x1d5c), 0x10, g.rw(0x579), 0x18, g.rb(0x1d5f), rows, g.rb(0x57b), 0x0e);
  g.c(10);
  if (hit) g.wb(0x1d58, 1);
  return hit;
}

// CS:22dc
function eraseCritter(g) {
  g.c(3);
  if (g.rb(0x1d59) === 0x1a) return;
  const cx = g.rw(0x1d66);
  copyRect(g, SEG_VRAM, g.rw(0x1d60), 0x1d24, cx & 0xff, cx >> 8);
}

// CS:2216 - the critter pops up from a can, then sinks back.
export function critterUpdate(g) {
  const dx = g.ticks();
  g.c(3);
  if (dx === g.rw(0x1d5a)) return;
  if (!g.retrace()) return;
  g.ww(0x1d5a, dx);
  if (critterTouches(g)) return;
  g.c(3);
  if (g.rb(0x1d59) === 0) {
    const y = g.rb(0x57b);
    if (y !== 0x86 && y !== 0x8e) {
      if ((random(g) & 0xff) > 5) return;
    }
    const p = randomCan(g);
    g.wb(0x1d5e, p.dl + 3);
    const cx = (p.cx + (random(g) & 7) + 6) & 0xffff;
    g.ww(0x1d5c, cx);
    g.wb(0x1d59, 0x1b);
    g.c(10);
  }
  const n = (g.rb(0x1d59) - 1) & 0xff;
  g.wb(0x1d59, n);
  const cx = g.rw(0x1d5c);
  let dl = g.rb(0x1d5e);
  let bx;
  if (n > 0x0d) {
    dl = (dl + n - 0x0f) & 0xff;
    bx = (((0x1b - n) & 0xff) << 8) | 0x02;
  } else {
    dl = (dl + 0x0c - n) & 0xff;
    bx = ((n & 0xff) << 8) | 0x02;
  }
  g.ww(0x1d64, bx);
  g.wb(0x1d5f, dl);
  g.ww(0x1d62, xyAddr(g, cx, dl));
  g.c(16);
  eraseCritter(g);
  if (critterTouches(g)) return;
  g.c(3);
  if (g.rb(0x1d59) === 0) return;
  const di = g.rw(0x1d62);
  g.ww(0x1d60, di);
  const c = g.rw(0x1d64);
  g.ww(0x1d66, c);
  blitOver(g, SEG_VRAM, di, 0x1cf0, 0x1d24, c & 0xff, c >> 8);
}

// ---------------------------------------------------------------- mice

// CS:2330
export function miceInit(g) {
  g.ww(0x1f6c, 0);
  let ax = 0;
  let dl = 1;
  if (g.rw(0x579) <= 0xa0) {
    ax = 0x12c;
    dl = 0xff;
  }
  for (let i = 0; i < 3; i++) {
    g.ww(0x1f30 + 2 * i, ax);
    g.wb(0x1f3c + i, dl);
    g.wb(0x1f48 + i, 1);
    g.wb(0x1f50 + i, 0);
  }
  g.c(20);
}

// CS:265e - thrown object over this mouse. Returns CF.
function mouseUnderThrown(g) {
  g.c(3);
  if (g.rb(0x1673) === 0) return false;
  const i = g.rw(0x1f6c);
  return overlap(g, g.rw(0x1f30 + 2 * i), 0x10, g.rw(0x1671), 0x10, g.rb(0x1f36 + i), 8, g.rb(0x1673), 0x0c);
}

// CS:254d
function eraseMouse(g) {
  const b = g.rw(0x1f6c) << 1;
  copyRect(g, SEG_VRAM, g.rw(0x1f42 + b), g.rw(0x1f59 + b), 2, 8);
}

// CS:2567 - cat and mouse meet: catch it (points) or get knocked off the line.
function* mouseMeetsCat(g) {
  let i = g.rw(0x1f6c);
  const hit = overlap(g, g.rw(0x1f30 + 2 * i), 0x10, g.rw(0x579), 0x18, g.rb(0x1f36 + i), 8, g.rb(0x57b), 0x0e);
  g.c(10);
  if (!hit) return false;
  if (g.rb(0x1f50 + i) !== 0) return true;
  if (g.rb(0x57c) < 0x26) return true;
  g.c(3);
  if (g.rb(0x55c) !== 0) {
    g.wb(0x55c, 0);
    g.wb(0x55b, 0x11);
    g.wb(0x571, 1);
    g.wb(0x56e, 0);
    let di = g.rw(0x1f42 + 2 * i);
    if (g.rw(0x1f30 + 2 * i) >= 0x10) di = (di - 4) & 0xffff;
    g.ww(0x1f67, di);
    blitOver(g, SEG_VRAM, di, 0x1d70, 0x0e, 6, 8);
    g.ww(0x1f65, g.ticks());
    g.c(14);
    do {
      S.noiseNote(g); // CS:5a90
      yield;
      g.c(3);
    } while (((g.ticks() - g.rw(0x1f65)) & 0xffff) < 8);
    speakerOff(g);
    copyRect(g, SEG_VRAM, g.rw(0x1f67), 0x0e, 6, 8);
    return true;
  }
  // caught!
  const dx = g.ticks();
  g.wb(0x1f50 + i, 1);
  g.wb(0x1f3c + i, 1);
  g.ww(0x1f53 + 2 * i, dx);
  eraseCat(g);
  i = g.rw(0x1f6c);
  blitOver(g, SEG_VRAM, g.rw(0x1f42 + 2 * i), g.rw(0x1f5f + 2 * i), 0x0e, 2, 8);
  saveUnderCat(g);
  addScore(g, g.rb(0x1f39 + i));
  S.effect(g, 0x3e8, 0x2ee);
  g.c(16);
  return true;
}

// CS:237b - one of the three mice moves each tick.
export function* miceUpdate(g) {
  const dx = g.ticks();
  g.c(3);
  if (dx === g.rw(0x1f65)) return;
  g.ww(0x1f65, dx);
  g.c(3);
  if (g.rb(0x55a) !== 0) return;
  let bx = g.rw(0x1f6c) + 1;
  if (bx >= 3) bx = 0;
  g.ww(0x1f6c, bx);
  g.c(6);
  if (mouseUnderThrown(g)) return;
  if (yield* mouseMeetsCat(g)) return;
  bx = g.rw(0x1f6c);
  g.c(3);
  if (g.rb(0x1f50 + bx) !== 0) {
    const t = (g.ticks() - g.rw(0x1f53 + 2 * bx)) & 0xffff;
    g.c(4);
    if (t < 0x36) return;
    let dl = 1;
    let ax = 0;
    if (g.rw(0x579) <= 0xa0) {
      ax = 0x12c;
      dl = 0xff;
    }
    g.ww(0x1f30 + 2 * bx, ax);
    g.wb(0x1f50 + bx, 0);
    g.wb(0x1f3c + bx, dl);
    g.c(8);
  }
  // L23eb
  g.wb(0x1f3f + bx, g.rb(0x1f3c + bx));
  let label;
  g.c(4);
  if (g.rb(0x1664) !== 0) {
    g.ww(0x1f69, 0x0c);
    label = 'L2418';
  } else {
    g.ww(0x1f69, g.rb(0x57b) > 0x60 ? 4 : 8);
    label = bx === g.rw(0x52f) ? 'L2418' : 'L2425';
    g.c(6);
  }
  let al = null;
  let dl;
  if (label === 'L2418') {
    if (g.rb(0x1f3c + bx) === 0) {
      dl = random(g) & 0xff;
      al = dl & 1 ? 1 : 0xff;
    } else label = 'L2425';
  }
  if (label === 'L2425') {
    let chase = false;
    if (g.rb(0x55c) !== 0) {
      const my = g.rb(0x1f36 + bx);
      const cy = g.rb(0x57b);
      if (my <= cy && ((my + 0x10) & 0xff) >= cy) {
        if ((random(g) & 0xff) <= g.rb(0x1f6e + g.rw(0x0008))) {
          g.ww(0x1f69, 0x0c);
          al = g.rw(0x1f30 + 2 * bx) >= g.rw(0x579) ? 0xff : 1;
          chase = true;
        }
      }
      g.c(10);
    }
    if (!chase) {
      let cl = 0x18;
      if (g.rb(0x57b) > 0x60) {
        cl = 0x28;
        if (g.rb(0x1f3c + bx) === 0) cl = 0x10;
      }
      dl = random(g) & 0xff;
      g.c(6);
      if (dl <= cl) {
        if (g.rb(0x1f3c + bx) !== 0) al = 0;
        else al = dl & 1 ? 1 : 0xff;
      }
    }
  }
  if (al !== null) g.wb(0x1f3c + bx, al);
  // L2496: move
  dl = g.rb(0x1f3c + bx);
  let ax = g.rw(0x1f30 + 2 * bx);
  g.c(6);
  if (dl === 1) {
    ax = (ax + g.rw(0x1f69)) & 0xffff;
    if (ax >= 0x12f) {
      ax = 0x12e;
      dl = 0xff;
    }
  } else if (dl !== 0) {
    const sp = g.rw(0x1f69);
    if (ax < sp) {
      ax = 0;
      dl = 1;
    } else ax -= sp;
  }
  g.ww(0x1f30 + 2 * bx, ax);
  g.wb(0x1f3c + bx, dl);
  g.ww(0x1f4b, xyAddr(g, ax, g.rb(0x1f36 + bx)));
  bx = g.rw(0x1f6c);
  g.c(8);
  if (g.rb(0x1f48 + bx) === 0 && (g.rb(0x1f3c + bx) | g.rb(0x1f3f + bx)) !== 0) eraseMouse(g);
  if (mouseUnderThrown(g)) return;
  if (yield* mouseMeetsCat(g)) return;
  bx = g.rw(0x1f6c);
  g.wb(0x1f48 + bx, 0);
  let si;
  g.c(4);
  if (g.rb(0x1f3c + bx) === 0) {
    if (g.rb(0x1f3f + bx) === 0) return;
    si = 0x1e30;
  } else {
    si = 0x1e50;
    g.wb(0x1f4d + bx, g.rb(0x1f4d + bx) + 1);
    if (!(g.rb(0x1f4d + bx) & 1)) si += 0x20;
    if (g.rb(0x1f3c + bx) !== 1) si += 0x40;
    g.c(8);
  }
  const b2 = bx << 1;
  const di = g.rw(0x1f4b);
  g.ww(0x1f42 + b2, di);
  blitAnd(g, SEG_VRAM, di, si, g.rw(0x1f59 + b2), 2, 8);
}

// CS:26b3 - lives counter (one digit), redrawn when it changes.
export function livesDraw(g) {
  const al = g.rb(0x1f80);
  g.c(3);
  if (al === g.rb(0x1f81)) return;
  g.wb(0x1f81, al);
  copyRect(g, SEG_VRAM, 0x1260, (0x2720 + (al << 4)) & 0xffff, 1, 8);
}
